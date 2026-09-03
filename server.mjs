import { createServer } from 'node:http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { jwtVerify } from 'jose';

try {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile();
  }
} catch {
  // .env opcional en producción
}

process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException:', err);
});

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const hostname = '0.0.0.0';

// ── CORS estricto ─────────────────────────────────────────────────────────────
// Producción: exige CORS_ORIGINS explícito y valida contra él (sin comodín `*`).
// Desarrollo: permite localhost y orígenes locales además de CORS_ORIGINS.
const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function resolveAllowedOrigins() {
  if (!dev) {
    return configuredOrigins.length ? configuredOrigins : [];
  }
  const local = ['http://localhost', 'http://localhost:3000', 'http://localhost:8080'];
  return Array.from(new Set([...local, ...configuredOrigins]));
}
const allowedOrigins = resolveAllowedOrigins();

function originIsAllowed(origin) {
  if (!origin) return true; // peticiones no-CORS (mismo servidor, curl, ...)
  return allowedOrigins.includes(origin);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret || rawSecret.trim().length < 32) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing or too short.');
}
const secret = new TextEncoder().encode(rawSecret);

try {
  await app.prepare();
} catch (err) {
  console.error('[server] app.prepare() failed:', err);
  process.exit(1);
}

const server = createServer((req, res) => {
  try {
    handle(req, res);
  } catch (err) {
    console.error('[server] request handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error interno del servidor' }));
    }
  }
});

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (originIsAllowed(origin)) callback(null, true);
      else callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Matchmaking aleatorio en tiempo real.
// Cola por categoría: cuando dos sockets en la misma categoría están esperando
// se emparejan al instante con `match:found`; si nadie llega dentro de
// MATCH_TIMEOUT_MS se envía `match:none` al aspirante solitario.
// ─────────────────────────────────────────────────────────────────────────────
const MATCH_TIMEOUT_MS = Number(process.env.MATCH_TIMEOUT_MS || 30000);
const matchQueue = new Map(); // category -> Map<userId, { socket, timer }>

function removeFromMatchQueue(userId) {
  for (const [category, waiters] of matchQueue) {
    if (waiters.has(userId)) {
      const entry = waiters.get(userId);
      clearTimeout(entry.timer);
      waiters.delete(userId);
      if (waiters.size === 0) matchQueue.delete(category);
    }
  }
}

// Limpieza periódica de entradas colgadas: si un socket murió sin emitir
// `disconnect`, su entrada en la cola se elimina para evitar matches fantasma.
const MATCH_SWEEP_INTERVAL_MS = 15000;
function sweepMatchQueue() {
  for (const [category, waiters] of matchQueue) {
    for (const [userId, entry] of waiters) {
      if (!entry.socket || !entry.socket.connected) {
        clearTimeout(entry.timer);
        waiters.delete(userId);
      }
    }
    if (waiters.size === 0) matchQueue.delete(category);
  }
}
setInterval(sweepMatchQueue, MATCH_SWEEP_INTERVAL_MS).unref();

async function matchPrisma() {
  if (!globalThis.__kyubiMatchPrisma) {
    const { PrismaClient } = await import('@prisma/client');
    const client = new PrismaClient({ log: ['error', 'warn'] });
    client.$on('error', (e) => {
      console.error('[matchmaking] prisma error:', e.message);
    });
    globalThis.__kyubiMatchPrisma = client;
  }
  return globalThis.__kyubiMatchPrisma;
}

function publicUserForMatch(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatarUrl: u.avatarUrl || null,
    level: u.level ?? 1,
    bio: u.bio || null,
    interests: Array.isArray(u.interests) ? u.interests : [],
  };
}

async function fetchPublicUser(userId, fallbackUsername) {
  try {
    const prisma = await matchPrisma();
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        bio: true,
        interests: true,
      },
    });
    if (u) return publicUserForMatch(u);
  } catch (err) {
    console.error('[matchmaking] fetch user failed:', err.message);
  }
  return {
    id: userId,
    username: fallbackUsername || '',
    displayName: fallbackUsername || '',
    avatarUrl: null,
    level: 1,
    bio: null,
    interests: [],
  };
}

io.use((socket, nextFn) => {
  const auth = socket.handshake.auth ?? {};
  const header = socket.handshake.headers?.authorization ?? '';
  const token =
    typeof auth.token === 'string' && auth.token
      ? auth.token
      : header.replace(/^Bearer\s+/i, '');
  if (!token || !secret.length) return nextFn(new Error('Unauthorized'));
  jwtVerify(token, secret)
    .then(({ payload }) => {
      if (!payload.sub) return nextFn(new Error('Unauthorized'));
      socket.data.userId = payload.sub;
      socket.data.username = String(payload.username ?? '');
      nextFn();
    })
    .catch(() => nextFn(new Error('Unauthorized')));
});

io.on('connection', (socket) => {
  // Join personal room for targeted notification push
  if (socket.data.userId) {
    socket.join(`user:${socket.data.userId}`);
  }

  socket.on('conversation:join', (conversationId) => {
    if (typeof conversationId === 'string' && conversationId) {
      socket.join(`conversation:${conversationId}`);
    }
  });
  socket.on('conversation:leave', (conversationId) => {
    if (typeof conversationId === 'string' && conversationId) {
      socket.leave(`conversation:${conversationId}`);
    }
  });
  socket.on('room:join', (roomId) => {
    if (typeof roomId === 'string' && roomId) {
      socket.join(`sala:${roomId}`);
    }
  });
  socket.on('room:leave', (roomId) => {
    if (typeof roomId === 'string' && roomId) {
      socket.leave(`sala:${roomId}`);
    }
  });
  socket.on('typing', (payload) => {
    const conversationId = payload?.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) return;
    socket.to(`conversation:${conversationId}`).emit('typing', {
      conversationId,
      userId: socket.data.userId,
      username: socket.data.username,
      isTyping: payload?.isTyping === true,
    });
  });
  socket.on('read', (payload) => {
    const conversationId = payload?.conversationId;
    if (typeof conversationId !== 'string' || !conversationId) return;
    socket.to(`conversation:${conversationId}`).emit('read', {
      conversationId,
      userId: socket.data.userId,
      lastReadMessageId: payload?.lastReadMessageId ?? null,
    });
  });

  // ── Matchmaking aleatorio ──────────────────────────────────────────────
  socket.on('match:start', async (payload) => {
    const myId = socket.data.userId;
    if (!myId) return;
    const category =
      payload && typeof payload.category === 'string' && payload.category
        ? payload.category
        : 'general';

    removeFromMatchQueue(myId);

    let waiters = matchQueue.get(category);
    // Solo empareja con otro usuario (nunca consigo mismo, aunque tenga
    // varias pestañas abiertas) cuyo socket siga vivo.
    const opponent = waiters
      ? [...waiters.entries()].find(
          ([id, entry]) => id !== myId && entry.socket && entry.socket.connected,
        )
      : undefined;

    if (opponent) {
      const [opponentId, opponentEntry] = opponent;
      clearTimeout(opponentEntry.timer);
      waiters.delete(opponentId);
      if (waiters.size === 0) matchQueue.delete(category);

      const [peerOfMine, peerOfOpponent] = await Promise.all([
        fetchPublicUser(opponentId, opponentEntry.socket.data.username),
        fetchPublicUser(myId, socket.data.username),
      ]);

      io.to(`user:${myId}`).emit('match:found', { peer: peerOfMine, category });
      io.to(`user:${opponentId}`).emit('match:found', { peer: peerOfOpponent, category });
      return;
    }

    const timer = setTimeout(() => {
      const current = matchQueue.get(category);
      if (!current || !current.has(myId)) return;
      current.delete(myId);
      if (current.size === 0) matchQueue.delete(category);
      io.to(`user:${myId}`).emit('match:none', { category, reason: 'timeout' });
    }, MATCH_TIMEOUT_MS);

    if (!waiters) {
      waiters = new Map();
      matchQueue.set(category, waiters);
    }
    waiters.set(myId, { socket, timer });
  });

  socket.on('match:cancel', () => {
    removeFromMatchQueue(socket.data.userId);
  });

  socket.on('disconnect', () => {
    removeFromMatchQueue(socket.data.userId);
  });
});

globalThis.__kyubiIo = io;

server.listen(port, hostname, () => {
  console.log(`> Kyubi server ready on http://${hostname}:${port} (dev: ${dev})`);
  console.log('> Socket.IO enabled');
});
