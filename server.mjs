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

const server = createServer(async (req, res) => {
  // ───────────────────────────────────────────────────────────────────────────
  // CORS HTTP real (hasta ahora `originIsAllowed` solo se usaba en el
  // handshake de Socket.IO, dejando la API HTTP sin control de origen).
  // ───────────────────────────────────────────────────────────────────────────
  const origin = req.headers.origin;
  const allowed = Boolean(origin) && allowedOrigins.includes(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  // Pre-flight: se responde aquí mismo, sin delegar a Next.js.
  if (req.method === 'OPTIONS') {
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    const reqHeaders = req.headers['access-control-request-headers'];
    res.setHeader(
      'Access-Control-Allow-Headers',
      typeof reqHeaders === 'string'
        ? reqHeaders
        : Array.isArray(reqHeaders)
          ? reqHeaders.join(', ')
          : 'Content-Type, Authorization',
    );
    res.setHeader('Access-Control-Max-Age', '86400');
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    await handle(req, res);
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

// ─────────────────────────────────────────────────────────────────────────────
// Recolector de basura de refresh tokens: cada hora elimina los tokens
// expirados o revocados (misma condición que cleanupExpiredRefreshTokens()
// de src/lib/auth.ts — aquí se replica porque server.mjs es ESM puro y no
// puede importar el módulo TS sin compilación).
// El intervalo va `.unref()` para no bloquear la terminación del proceso.
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

async function cleanupExpiredRefreshTokensJob() {
  try {
    const prisma = await matchPrisma();
    const result = await prisma.refreshToken.deleteMany({
      where: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }] },
    });
    if (result.count > 0) {
      console.log(`[tokens] ${result.count} refresh token(s) expirados/revocados eliminados`);
    }
  } catch (err) {
    console.error('[tokens] sweep failed:', err.message);
  }
}

setInterval(cleanupExpiredRefreshTokensJob, TOKEN_SWEEP_INTERVAL_MS).unref();
// Primera ejecución al arrancar, con retardo para no competir con el boot.
setTimeout(cleanupExpiredRefreshTokensJob, 60_000).unref();

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

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes de salas: persistencia vía socket (`send_room_message`).
// Replica la semántica de POST /salas/:id/messages: ban/mute activos, sala
// activa, pertenencia y broadcasting con payload estructurado.
// ─────────────────────────────────────────────────────────────────────────────
const ROOM_MESSAGE_TYPES = new Set(['TEXT', 'VOICE', 'IMAGE', 'POLL']);

function normalizeRoomMessageType(type) {
  return typeof type === 'string' && ROOM_MESSAGE_TYPES.has(type) ? type : 'TEXT';
}

function s(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function publicRoomSender(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName || u.username,
    avatarUrl: u.avatarUrl || null,
    usernameColor: u.usernameColor || null,
    avatarFrame: u.avatarFrame || null,
    level: u.level ?? 1,
    showOnline: true,
    isOnline: u.isOnline ?? false,
    gender: u.gender || null,
    showGender: u.showGender ?? true,
  };
}

function roomMessagePayload(m) {
  const sender = publicRoomSender(m.sender);
  const metadata = objectOrEmpty(m.extensions);
  return {
    id: m.id,
    roomId: m.roomId,
    senderId: m.senderId,
    sender,
    // ── Payload estructurado ──
    senderName: sender.displayName || sender.username,
    username: sender.username,
    roleId: m.characterId || null,
    roleName: m.characterName || null,
    type: m.type || 'TEXT',
    content: m.body,
    metadata,
    // ── Compatibilidad con el wire format existente ──
    body: m.body,
    characterId: m.characterId || null,
    characterName: m.characterName || null,
    characterAvatarUrl: m.characterAvatarUrl || null,
    extensions: metadata,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

function activeWhere(userId) {
  return {
    userId,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

async function hasActiveSanction(prisma, userId) {
  const [ban, mute] = await Promise.all([
    prisma.ban.findFirst({
      where: activeWhere(userId),
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
    prisma.mute.findFirst({
      where: activeWhere(userId),
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ]);
  return Boolean(ban) || Boolean(mute);
}

async function handleSendRoomMessage(socket, payload) {
  const userId = socket.data.userId;
  if (!userId) return;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  if (!roomId) return;

  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content) return;
  const body = content.slice(0, 4000);

  const type = normalizeRoomMessageType(payload.type);
  // Acepta tanto roleId/roleName como characterId/characterName (alias).
  const roleId = s(payload.roleId ?? payload.characterId, 64);
  const roleName = s(payload.roleName ?? payload.characterName, 80);
  const roleAvatarUrl = s(payload.roleAvatarUrl ?? payload.characterAvatarUrl, 2048);
  const metadata = objectOrEmpty(payload.metadata ?? payload.extensions);

  let prisma;
  try {
    prisma = await matchPrisma();
  } catch (err) {
    console.error('[room] prisma init failed:', err.message);
    return;
  }

  try {
    if (await hasActiveSanction(prisma, userId)) return;

    const [room, participant] = await Promise.all([
      prisma.room.findUnique({
        where: { id: roomId },
        select: { id: true, status: true, hostId: true },
      }),
      prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { id: true },
      }),
    ]);

    if (!room || room.status !== 'ACTIVE') return;
    if (!participant && room.hostId !== userId) return;

    const message = await prisma.roomMessage.create({
      data: {
        roomId,
        senderId: userId,
        type,
        body,
        characterId: roleId,
        characterName: roleName,
        characterAvatarUrl: roleAvatarUrl,
        extensions: metadata,
      },
      include: { sender: true },
    });

    io.to(`sala:${roomId}`).emit('room:message', roomMessagePayload(message));
  } catch (err) {
    console.error('[room] send_room_message failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sala de Cine sincronizada (YouTube): solo el HOST de la sala puede emitir
// acciones. Se persiste estado en Room y se retransmite `cinema:sync` a la
// sala completa para que los espectadores (read-only) sigan el reproductor.
// ─────────────────────────────────────────────────────────────────────────────
const CINEMA_ACTIONS = new Set(['PLAY', 'PAUSE', 'SEEK', 'LOAD', 'STOP']);

async function handleCinemaAction(socket, payload) {
  const userId = socket.data.userId;
  if (!userId) return;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  if (!roomId) return;

  const action =
    typeof payload.action === 'string' ? payload.action.toUpperCase() : '';
  if (!CINEMA_ACTIONS.has(action)) return;

  const videoId = s(payload.videoId, 128);
  const currentTime =
    typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)
      ? Math.max(0, payload.currentTime)
      : null;

  let prisma;
  try {
    prisma = await matchPrisma();
  } catch (err) {
    console.error('[cinema] prisma init failed:', err.message);
    return;
  }

  try {
    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    });
    // Regla de permisos: solo el HOST de la sala controla el cine.
    if (!participant || participant.role !== 'HOST') return;

    const updateData = {};
    if (action === 'LOAD') {
      if (!videoId) return;
      updateData.cinemaVideoId = videoId;
      updateData.cinemaState = 'PLAYING';
      updateData.cinemaCurrentTime = currentTime ?? 0;
    } else if (action === 'PLAY') {
      updateData.cinemaState = 'PLAYING';
      if (currentTime !== null) updateData.cinemaCurrentTime = currentTime;
    } else if (action === 'PAUSE') {
      updateData.cinemaState = 'PAUSED';
      if (currentTime !== null) updateData.cinemaCurrentTime = currentTime;
    } else if (action === 'SEEK') {
      if (currentTime === null) return;
      updateData.cinemaCurrentTime = currentTime;
    } else if (action === 'STOP') {
      updateData.cinemaState = 'STOPPED';
      if (currentTime !== null) updateData.cinemaCurrentTime = currentTime;
    }
    updateData.cinemaUpdatedAt = new Date();

    await prisma.room.update({
      where: { id: roomId },
      data: updateData,
      select: { id: true },
    });

    io.to(`sala:${roomId}`).emit('cinema:sync', {
      roomId,
      action,
      videoId: videoId ?? null,
      currentTime: currentTime,
      updatedAt: updateData.cinemaUpdatedAt.toISOString(),
    });
  } catch (err) {
    console.error('[cinema] action failed:', err.message);
  }
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

  // Persistencia y broadcast de mensajes de sala vía Socket.IO.
  socket.on('send_room_message', (payload) => {
    handleSendRoomMessage(socket, payload);
  });

  // Sala de Cine sincronizada: acciones del host → persist + broadcast.
  socket.on('cinema:action', (payload) => {
    handleCinemaAction(socket, payload);
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
