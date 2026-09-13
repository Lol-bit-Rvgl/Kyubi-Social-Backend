import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { jwtVerify } from 'jose';
import { RoomServiceClient } from 'livekit-server-sdk';

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
  console.error('[server][FATAL] uncaughtException:', err);
  process.exit(1);
});

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const hostname = '0.0.0.0';

// ── CORS estricto (incrustado en server.mjs) ──────────────────────────────────
// Antes vivía en src/lib/cors.mjs, pero server.mjs corre directo en Node ESM y
// en el contenedor de producción solo se copian archivos raíz (server.mjs),
// por lo que importar './src/lib/cors.mjs' fallaba con ERR_MODULE_NOT_FOUND.
// Reglas:
//  - Producción: SOLO los orígenes de CORS_ORIGINS (sin comodín `*`).
//  - Desarrollo: CORS_ORIGINS + orígenes locales estándar.
//  - Peticiones sin cabecera `Origin` (curl, same-origin, móvil) se permiten:
//    CORS solo regula el acceso entre orígenes del navegador.
const LOCAL_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:8080',
];

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isDevEnv = process.env.NODE_ENV !== 'production';
const allowedOrigins = Array.from(
  new Set([...(isDevEnv ? LOCAL_ORIGINS : []), ...configuredOrigins]),
);

function originIsAllowed(origin) {
  if (!origin) return true; // peticiones no-CORS (mismo servidor, curl, apps nativas)
  return allowedOrigins.includes(origin);
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rawSecret = process.env.JWT_SECRET;
const JWT_PLACEHOLDERS = ['replace-with-a-random-32-byte-secret', 'build-time-placeholder-do-not-use-in-production'];
if (!rawSecret || rawSecret.trim().length < 32) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing or too short.');
}
if (!dev && JWT_PLACEHOLDERS.includes(rawSecret.trim())) {
  console.error('FATAL: JWT_SECRET sigue teniendo el valor placeholder. Genera un secreto real antes de arrancar en producción.');
  process.exit(1);
}
const secret = new TextEncoder().encode(rawSecret);

try {
  await app.prepare();
} catch (err) {
  console.error('[server] app.prepare() failed:', err);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  // ── Request tracking ────────────────────────────────────────────────────────
  // Reutiliza `x-request-id` entrante (proxy de confianza) o genera uno nuevo.
  // Va de vuelta al cliente en todas las respuestas y en los logs de error.
  const requestId =
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
    randomUUID();
  res.setHeader('x-request-id', requestId);

  // ───────────────────────────────────────────────────────────────────────────
  // CORS HTTP real (lógica incrustada arriba en server.mjs; aquí se aplica a
  // nivel de servidor para API HTTP y el handshake de Socket.IO).
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
    console.error(
      `[ERROR] [requestId: ${requestId}] [${req.method} ${req.url}]: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', requestId }));
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
const ROOM_MESSAGE_TYPES = new Set(['TEXT', 'VOICE', 'IMAGE', 'POLL', 'SYSTEM', 'DICE', 'RPS']);

function normalizeRoomMessageType(type) {
  if (typeof type !== 'string') return 'TEXT';
  const upper = type.trim().toUpperCase();
  return ROOM_MESSAGE_TYPES.has(upper) ? upper : 'TEXT';
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
  const roleColor = metadata.roleColor || metadata.roleColorHex || metadata.colorHex || metadata.characterColor || null;
  const clientTempId = metadata.clientTempId || null;
  const mediaUrl = metadata.mediaUrl || metadata.imageUrl || (m.type === 'IMAGE' || m.type === 'VOICE' ? m.body : null);
  const attachments = Array.isArray(metadata.attachments) ? metadata.attachments : (mediaUrl ? [mediaUrl] : []);
  const diceResult = metadata.diceResult || null;
  const diceEmoji = metadata.diceEmoji || null;
  const diceName = metadata.diceName || null;
  const replyToId = metadata.replyToId || (metadata.replyTo && metadata.replyTo.id) || null;
  const replyToName = metadata.replyToName || (metadata.replyTo && (metadata.replyTo.authorName || metadata.replyTo.senderName || metadata.replyTo.username)) || null;
  const replyToBody = metadata.replyToBody || (metadata.replyTo && (metadata.replyTo.content || metadata.replyTo.body)) || null;
  const replyTo = metadata.replyTo || (replyToId ? { id: replyToId, authorName: replyToName, content: replyToBody } : null);
  const isEdited = Boolean(metadata.isEdited);
  const editedAt = metadata.editedAt || null;
  const editCount = typeof metadata.editCount === 'number' ? metadata.editCount : (isEdited ? 1 : 0);

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
    roleColor,
    characterColor: roleColor,
    clientTempId,
    type: m.type || 'TEXT',
    content: m.body,
    mediaUrl,
    attachments,
    diceResult,
    diceEmoji,
    diceName,
    replyToId,
    replyToName,
    replyToBody,
    replyTo,
    isEdited,
    editedAt,
    editCount,
    metadata,
    // ── Compatibilidad con el wire format existente ──
    body: m.body,
    characterId: m.characterId || null,
    characterName: m.characterName || null,
    characterAvatarUrl: m.characterAvatarUrl || null,
    role: m.characterName
      ? {
          id: m.characterId || m.senderId,
          name: m.characterName,
          avatarUrl: m.characterAvatarUrl || null,
          colorHex: roleColor || '#00E5FF',
          color: roleColor || '#00E5FF',
        }
      : null,
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

async function checkUserSanction(prisma, userId) {
  if (!userId) return null;

  const now = new Date();

  // 1. Comprobar si está suspendido en el modelo User
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuspended: true, suspendedUntil: true },
  });

  const isSuspended = Boolean(
    user?.isSuspended && (!user.suspendedUntil || new Date(user.suspendedUntil) > now)
  );

  // 2. Comprobar si tiene ban o mute activo en tablas dedicadas
  const [activeBan, activeMute] = await Promise.all([
    prisma.ban.findFirst({
      where: activeWhere(userId),
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, expiresAt: true },
    }),
    prisma.mute.findFirst({
      where: activeWhere(userId),
      orderBy: { createdAt: 'desc' },
      select: { id: true, reason: true, expiresAt: true },
    }),
  ]);

  const isBanned = Boolean(activeBan);
  const isMuted = Boolean(activeMute);

  if (isBanned || isSuspended || isMuted) {
    const until = user?.suspendedUntil || activeBan?.expiresAt || activeMute?.expiresAt || null;
    return {
      isSanctioned: true,
      isBanned,
      isSuspended,
      isMuted,
      suspendedUntil: until ? (until instanceof Date ? until.toISOString() : String(until)) : null,
    };
  }

  return null;
}

async function handleSendRoomMessage(socket, payload) {
  const userId = socket.userId || socket.data?.userId;
  if (!userId) return;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  if (!roomId) return;

  const type = normalizeRoomMessageType(payload.type);
  const rawContent = typeof payload.content === 'string' ? payload.content.trim() : (typeof payload.body === 'string' ? payload.body.trim() : '');
  const mediaUrl = typeof payload.mediaUrl === 'string' ? payload.mediaUrl.trim() : (typeof payload.contentUrl === 'string' ? payload.contentUrl.trim() : null);
  const content = rawContent || mediaUrl || (type === 'IMAGE' ? '[Imagen]' : type === 'VOICE' ? '[Audio]' : '');
  if (!content && type === 'TEXT') return;
  if (rawContent.length > 4000) {
    socket.emit('error', { message: 'El mensaje no puede superar los 4000 caracteres' });
    return;
  }
  const body = (content || '[Multimedia]').slice(0, 4000);

  // Acepta tanto roleId/roleName como characterId/characterName (alias).
  const roleId = s(payload.roleId ?? payload.characterId, 64);
  const roleName = s(payload.roleName ?? payload.characterName, 80);
  const roleAvatarUrl = s(payload.roleAvatarUrl ?? payload.characterAvatarUrl, 2048);
  const metadata = objectOrEmpty(payload.metadata ?? payload.extensions);
  if (mediaUrl && !metadata.mediaUrl) metadata.mediaUrl = mediaUrl;
  if (Array.isArray(payload.attachments) && !metadata.attachments) metadata.attachments = payload.attachments;
  if (payload.diceResult && !metadata.diceResult) metadata.diceResult = payload.diceResult;
  if (payload.diceEmoji && !metadata.diceEmoji) metadata.diceEmoji = payload.diceEmoji;
  if (payload.diceName && !metadata.diceName) metadata.diceName = payload.diceName;
  if (payload.replyToId && !metadata.replyToId) metadata.replyToId = payload.replyToId;
  if (payload.replyToName && !metadata.replyToName) metadata.replyToName = payload.replyToName;
  if (payload.replyToBody && !metadata.replyToBody) metadata.replyToBody = payload.replyToBody;
  if (payload.replyTo && !metadata.replyTo) metadata.replyTo = payload.replyTo;

  if (type === 'POLL') {
    const pollQuestion = typeof metadata.question === 'string' ? metadata.question.trim() : rawContent;
    if (pollQuestion.length > 80) {
      metadata.question = pollQuestion.slice(0, 80);
    }
    if (Array.isArray(metadata.options)) {
      metadata.options = metadata.options.slice(0, 6).map((opt) => {
        if (typeof opt === 'string') return opt.trim().slice(0, 20);
        if (opt && typeof opt === 'object') {
          return {
            ...opt,
            text: typeof opt.text === 'string' ? opt.text.trim().slice(0, 20) : '',
          };
        }
        return opt;
      });
    }
  }

  let prisma;
  try {
    prisma = await matchPrisma();
  } catch (err) {
    console.error('[room] prisma init failed:', err.message);
    return;
  }

  try {
    // Comprobar si está suspendido o silenciado
    const sanction = await checkUserSanction(prisma, userId);
    if (sanction) {
      // Rechazar mensaje y notificar únicamente al emisor
      socket.emit('error:sanctioned', {
        message: 'Tu cuenta se encuentra suspendida o silenciada temporalmente.',
        suspendedUntil: sanction.suspendedUntil,
      });
      return; // Bloquear emisión al resto de la sala
    }

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

    if (metadata.replyToId && (!metadata.replyToName || !metadata.replyToBody)) {
      try {
        const quoted = await prisma.roomMessage.findUnique({
          where: { id: metadata.replyToId },
          select: {
            id: true,
            body: true,
            characterName: true,
            sender: { select: { displayName: true, username: true } },
          },
        });
        if (quoted) {
          metadata.replyToName = metadata.replyToName || quoted.characterName || quoted.sender?.displayName || quoted.sender?.username || 'Usuario';
          metadata.replyToBody = metadata.replyToBody || quoted.body;
          metadata.replyTo = {
            id: quoted.id,
            authorName: metadata.replyToName,
            content: metadata.replyToBody,
          };
        }
      } catch (quoteErr) {
        console.warn('[room] Quoted lookup failed:', quoteErr.message);
      }
    }

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
    console.log(`[SOCKET_SERVER] Mensaje emitido a sala:${roomId}: ${body}`);
  } catch (err) {
    console.error('[room] send_room_message failed:', err.message);
  }
}

async function handleEditRoomMessage(socket, payload) {
  const userId = socket.userId || socket.data?.userId;
  if (!userId) return;
  if (!payload || typeof payload !== 'object') return;

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  const messageId = typeof payload.messageId === 'string' ? payload.messageId : (typeof payload.id === 'string' ? payload.id : '');
  const rawBody = typeof payload.content === 'string' ? payload.content.trim() : (typeof payload.body === 'string' ? payload.body.trim() : '');

  if (!roomId || !messageId || !rawBody) return;
  if (rawBody.length > 4000) {
    socket.emit('error', { message: 'El mensaje no puede superar los 4000 caracteres' });
    return;
  }

  let prisma;
  try {
    prisma = await matchPrisma();
  } catch (err) {
    console.error('[room] prisma init failed:', err.message);
    return;
  }

  try {
    const existing = await prisma.roomMessage.findUnique({
      where: { id: messageId },
      include: { sender: true },
    });

    if (!existing || existing.roomId !== roomId) {
      socket.emit('error', { message: 'Mensaje no encontrado' });
      return;
    }

    if (existing.senderId !== userId) {
      socket.emit('error', { message: 'No tienes permiso para editar este mensaje' });
      return;
    }

    const currentExt = objectOrEmpty(existing.extensions);
    if (currentExt.isEdited || (currentExt.editCount && currentExt.editCount > 0)) {
      socket.emit('error', { message: 'El mensaje ya ha sido editado previamente' });
      return;
    }

    const updatedExt = {
      ...currentExt,
      isEdited: true,
      editedAt: new Date().toISOString(),
      editCount: 1,
    };

    const updated = await prisma.roomMessage.update({
      where: { id: messageId },
      data: {
        body: rawBody.slice(0, 4000),
        extensions: updatedExt,
      },
      include: { sender: true },
    });

    const outPayload = roomMessagePayload(updated);
    io.to(`sala:${roomId}`).emit('room:message_updated', outPayload);
  } catch (err) {
    console.error('[room] handleEditRoomMessage failed:', err.message);
  }
}

async function handleDeleteRoomMessage(socket, payload) {
  const userId = socket.userId || socket.data?.userId;
  if (!userId) return;
  if (!payload || typeof payload !== 'object') return;

  const roomId = typeof payload.roomId === 'string' ? payload.roomId : '';
  const messageId = typeof payload.messageId === 'string' ? payload.messageId : (typeof payload.id === 'string' ? payload.id : '');
  if (!roomId || !messageId) return;

  let prisma;
  try {
    prisma = await matchPrisma();
  } catch (err) {
    console.error('[room] prisma init failed:', err.message);
    return;
  }

  try {
    const existing = await prisma.roomMessage.findUnique({
      where: { id: messageId },
      select: { id: true, roomId: true, senderId: true },
    });

    if (!existing || existing.roomId !== roomId) {
      socket.emit('error', { message: 'Mensaje no encontrado' });
      return;
    }

    const isAuthor = existing.senderId === userId;
    let allowed = isAuthor;
    if (!allowed) {
      allowed = await canManageSala(roomId, userId);
    }

    if (!allowed) {
      socket.emit('error', { message: 'No tienes permisos para eliminar este mensaje' });
      return;
    }

    await prisma.roomMessage.delete({
      where: { id: messageId },
    });

    io.to(`sala:${roomId}`).emit('room:message_deleted', {
      roomId,
      messageId,
      deletedBy: userId,
    });
  } catch (err) {
    console.error('[room] handleDeleteRoomMessage failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sala de Cine sincronizada (YouTube): solo el HOST de la sala puede emitir
// acciones. Se persiste estado en Room y se retransmite `cinema:sync` a la
// sala completa para que los espectadores (read-only) sigan el reproductor.
// ─────────────────────────────────────────────────────────────────────────────
const CINEMA_ACTIONS = new Set(['PLAY', 'PAUSE', 'SEEK', 'LOAD', 'STOP', 'CLEAR', 'REMOVE']);

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
    const canManage = await canManageSala(roomId, userId);
    if (!canManage) {
      console.log(`[CINEMA_SERVER] canManageSala=false para user=${userId} en sala=${roomId}`);
      return;
    }

    const updateData = {};
    if (action === 'LOAD') {
      if (!videoId) return;
      updateData.cinemaVideoId = videoId;
      updateData.cinemaState = 'PLAYING';
      updateData.cinemaCurrentTime = currentTime ?? 0;
    } else if (action === 'CLEAR' || action === 'REMOVE') {
      updateData.cinemaVideoId = null;
      updateData.cinemaState = 'STOPPED';
      updateData.cinemaCurrentTime = 0;
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

    const broadcastAction = action === 'REMOVE' ? 'CLEAR' : action;
    io.to(`sala:${roomId}`).emit('cinema:sync', {
      roomId,
      action: broadcastAction,
      videoId: broadcastAction === 'CLEAR' ? null : (videoId ?? null),
      state: broadcastAction === 'CLEAR' ? 'STOPPED' : (updateData.cinemaState ?? 'STOPPED'),
      currentTime: broadcastAction === 'CLEAR' ? 0 : currentTime,
      updatedAt: updateData.cinemaUpdatedAt.toISOString(),
    });
    console.log(`[CINEMA_SERVER] Broadcast cinema:sync emitido a sala:${roomId} -> action=${broadcastAction}`);
  } catch (err) {
    console.error('[cinema] action failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modos de sala y moderación de voz (Host / Co-Host).
// `room:mode-change`    → valida el rol, reenvía `room:mode_changed` a la sala
//                          para que los clientes muestren el toast en vivo.
// `room:voice-moderation`→ mute/unmute/kick sobre la sala LiveKit `sala_<id>`
//                          y reenvía `room:voice_moderated` a `sala:<id>`.
// ─────────────────────────────────────────────────────────────────────────────
const ROOM_MODES = new Set(['standard', 'voice', 'roleplay', 'screening']);
const VOICE_MOD_ACTIONS = new Set([
  'mute',
  'unmute',
  'kick',
  'staff_only',
  'allow_speaker',
  'revoke_speaker',
]);
const MANAGEABLE_ROLES = new Set([
  'HOST',
  'CO_HOST',
  'ADMIN',
  'OWNER',
  'CO_ADMIN',
  'COADMIN',
  'MODERATOR',
]);

function normalizeRoomMode(mode) {
  if (!mode || typeof mode !== 'string') return 'standard';
  const m = mode.trim().toLowerCase();
  if (m === 'cinema' || m === 'screening' || m === 'cine' || m === 'movie') return 'screening';
  if (m === 'voice' || m === 'voz' || m === 'audio') return 'voice';
  if (m === 'roleplay' || m === 'rp' || m === 'rol') return 'roleplay';
  if (m === 'standard' || m === 'none' || m === 'off' || m === 'chat' || m === 'default' || m === 'normal') return 'standard';
  return 'standard';
}

function getLiveKitRoomService() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  return new RoomServiceClient(url, key, secret);
}

async function canManageSala(roomId, userId) {
  const prisma = await matchPrisma();
  const [room, participant] = await Promise.all([
    prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, hostId: true },
    }),
    prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    }),
  ]);
  if (!room || room.status !== 'ACTIVE') return false;
  if (room.hostId === userId) return true;
  return Boolean(participant && MANAGEABLE_ROLES.has(participant.role));
}

const SOCKET_ROOM_MODES = ROOM_MODES;

/// Modos que representan una actividad en curso (distinta del chat base).
const ACTIVE_MODES = new Set(['voice', 'screening', 'roleplay']);

/// Texto del mensaje de sistema persistente según la transición de modo.
const MODE_SYSTEM_TEXT = {
  voice: '[Sistema]: Chat de voz iniciado.',
  screening: '[Sistema]: Sala de cine iniciada.',
  roleplay: '[Sistema]: Sesión de roleplay iniciada.',
};
const MODE_SYSTEM_TEXT_END = {
  voice: '[Sistema]: Chat de voz finalizado.',
  screening: '[Sistema]: Sala de cine finalizada.',
  roleplay: '[Sistema]: Sesión de roleplay finalizada.',
};

/// Crea y persiste un mensaje de sistema (tipo SYSTEM) en la sala y lo
/// retransmite por el canal habitual de mensajes para que aparezca en vivo y
/// quede en el historial para los que entren después.
async function createRoomSystemMessage(prisma, roomId, senderId, body, extensions = {}) {
  const isCreationMessage =
    extensions?.subType === 'ROOM_CREATED' ||
    (typeof body === 'string' && body.toLowerCase().includes('sala iniciada')) ||
    (typeof body === 'string' && body.toLowerCase().includes('sala creada'));

  if (isCreationMessage) {
    const existing = await prisma.roomMessage.findFirst({
      where: {
        roomId,
        OR: [
          { type: 'ROOM_CREATED' },
          { body: { contains: 'Sala iniciada', mode: 'insensitive' } },
          { body: { contains: 'Sala creada', mode: 'insensitive' } },
        ],
      },
      include: { sender: true },
    });
    if (existing) {
      console.log(`[MODE_DEBUG_SERVER] Mensaje de inicio/creación ya existe en sala:${roomId}. Se omite duplicado.`);
      return roomMessagePayload(existing);
    }
  }

  const message = await prisma.roomMessage.create({
    data: {
      roomId,
      senderId,
      type: 'SYSTEM',
      body,
      extensions,
    },
    include: { sender: true },
  });
  const payload = roomMessagePayload(message);
  io.to(`sala:${roomId}`).emit('room:message', payload);
  console.log(`[MODE_DEBUG_SERVER] Mensaje de sistema persistido en sala:${roomId}: ${body}`);
  return payload;
}

const roomJoinDebounce = new Map(); // key: `${roomId}:${userId}`, value: timestamp

async function handleUserJoinRoom(socket, roomId, userId) {
  // La conexión a nivel de socket es silenciosa (transporte).
  // Los mensajes de sistema por unión formal se gestionan exclusivamente en POST /api/salas/[id]/join.
}

async function handleRoomModeChange(socket, payload) {
  const userId = socket.data.userId;
  if (!userId || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.log('[MODE_DEBUG_SERVER] payload inválido o sin userId:', payload);
    return;
  }

  const roomId = s(payload.roomId, 100) ?? '';
  const rawMode = s(payload.mode, 32) ?? '';
  const mode = normalizeRoomMode(rawMode);
  if (!roomId || !SOCKET_ROOM_MODES.has(mode)) {
    console.log(`[MODE_DEBUG_SERVER] roomId="${roomId}" o modo="${mode}" inválido`);
    return;
  }

  try {
    const canManage = await canManageSala(roomId, userId);
    if (!canManage) {
      console.log(`[MODE_DEBUG_SERVER] canManageSala=false para user=${userId} en sala=${roomId}`);
      return;
    }
    const prisma = await matchPrisma();

    const txResult = await prisma.$transaction(async (tx) => {
      const current = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          id: true,
          currentMode: true,
          cinemaVideoId: true,
          cinemaState: true,
          cinemaCurrentTime: true,
        },
      });
      if (!current) return null;

      const previousMode = normalizeRoomMode(current.currentMode);
      const systemMessagesToCreate = [];

      // Mensaje de fin de actividad anterior si era activa y cambia el modo
      if (ACTIVE_MODES.has(previousMode) && mode !== previousMode) {
        systemMessagesToCreate.push(
          MODE_SYSTEM_TEXT_END[previousMode] ?? '[Sistema]: Actividad finalizada.'
        );
      }

      // Mensaje de inicio de nueva actividad si es activa y cambia el modo
      if (ACTIVE_MODES.has(mode) && mode !== previousMode) {
        systemMessagesToCreate.push(
          MODE_SYSTEM_TEXT[mode] ?? '[Sistema]: Actividad iniciada.'
        );
      }

      const createdMessages = [];
      for (const body of systemMessagesToCreate) {
        const msg = await tx.roomMessage.create({
          data: {
            roomId,
            senderId: userId,
            type: 'SYSTEM',
            body,
            extensions: { subType: 'MODE_CHANGE', previousMode, newMode: mode },
          },
          include: { sender: true },
        });
        createdMessages.push(msg);
      }

      const updateData = { currentMode: mode };
      if (mode === 'screening') {
        const videoId = s(payload.videoId, 128);
        if (videoId) updateData.cinemaVideoId = videoId;
        if (payload.cinemaState && typeof payload.cinemaState === 'string') {
          updateData.cinemaState = payload.cinemaState;
        }
        if (typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)) {
          updateData.cinemaCurrentTime = payload.currentTime;
        }
        updateData.cinemaUpdatedAt = new Date();
      } else if (previousMode === 'screening' && mode !== 'screening') {
        // Limpieza atómica de cine al salir de screening
        updateData.cinemaVideoId = null;
        updateData.cinemaState = 'STOPPED';
        updateData.cinemaCurrentTime = 0.0;
        updateData.cinemaUpdatedAt = new Date();
      }

      const updatedRoom = await tx.room.update({
        where: { id: roomId },
        data: updateData,
        select: {
          id: true,
          currentMode: true,
          cinemaVideoId: true,
          cinemaState: true,
          cinemaCurrentTime: true,
          cinemaUpdatedAt: true,
        },
      });

      return { updatedRoom, previousMode, createdMessages };
    });

    if (!txResult) return;

    const { updatedRoom, previousMode, createdMessages } = txResult;

    // 1. Si la actividad previa era screening y se cambió de modo, emitir cinema:sync CLEAR
    if (previousMode === 'screening' && mode !== 'screening') {
      io.to(`sala:${roomId}`).emit('cinema:sync', {
        roomId,
        action: 'CLEAR',
        videoId: null,
        state: 'STOPPED',
        currentTime: 0,
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. Emitir mensajes de sistema creados
    for (const msg of createdMessages) {
      const payloadMsg = roomMessagePayload(msg);
      io.to(`sala:${roomId}`).emit('room:message', payloadMsg);
    }

    // 3. Emitir room:mode_changed
    const actor = await fetchPublicUser(userId, socket.data.username || 'Moderador');
    io.to(`sala:${roomId}`).emit('room:mode_changed', {
      roomId,
      mode,
      actorId: userId,
      actorName: actor.displayName || actor.username || '',
      cinemaVideoId: updatedRoom.cinemaVideoId ?? null,
      cinemaState: updatedRoom.cinemaState ?? 'STOPPED',
      cinemaCurrentTime: updatedRoom.cinemaCurrentTime ?? 0,
      cinemaUpdatedAt: updatedRoom.cinemaUpdatedAt ? updatedRoom.cinemaUpdatedAt.toISOString() : null,
      timestamp: new Date().toISOString(),
    });

    console.log(`[MODE_DEBUG_SERVER] Broadcast atómico room:mode_changed emitido a sala:${roomId} -> ${mode}`);
  } catch (err) {
    console.error('[room:mode] change failed:', err.message);
  }
}

async function handleRoomVoiceModeration(socket, payload) {
  const userId = socket.data.userId;
  if (!userId || !payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const roomId = s(payload.roomId, 100) ?? '';
  const action = s(payload.action, 32) ?? '';
  const targetUserId = s(payload.targetUserId, 100) ?? '';
  if (!roomId || !VOICE_MOD_ACTIONS.has(action)) return;
  if (action !== 'staff_only' && !targetUserId) return;

  try {
    if (!(await canManageSala(roomId, userId))) {
      console.log(`[VOICE_MOD_SERVER] canManageSala=false para user=${userId} en sala=${roomId}`);
      return;
    }

    const actor = await fetchPublicUser(userId, socket.data.username || 'Moderador');

    if (action === 'staff_only') {
      const staffOnly = Boolean(payload.staffOnly);
      io.to(`sala:${roomId}`).emit('room:voice_moderated', {
        roomId,
        action: 'staff_only',
        staffOnly,
        actorId: userId,
        actorName: actor.displayName || actor.username || '',
        timestamp: new Date().toISOString(),
      });
      console.log(`[VOICE_MOD_SERVER] Staff only=${staffOnly} emitido en sala:${roomId}`);
      return;
    }

    if (action === 'allow_speaker' || action === 'revoke_speaker') {
      const target = await fetchPublicUser(targetUserId, payload.targetUsername || '');
      io.to(`sala:${roomId}`).emit('room:voice_moderated', {
        roomId,
        action,
        targetUserId,
        targetName: target.displayName || target.username || '',
        actorId: userId,
        actorName: actor.displayName || actor.username || '',
        timestamp: new Date().toISOString(),
      });
      console.log(`[VOICE_MOD_SERVER] ${action} emitido para ${targetUserId} en sala:${roomId}`);
      return;
    }

    if (action === 'kick' && targetUserId === userId) return;

    const target = await fetchPublicUser(targetUserId, payload.targetUsername || '');

    // Aplicación real sobre el canal LiveKit (best effort: si LiveKit no está
    // configurado, el evento se reenvía igualmente para que todos actualicen UI).
    const service = getLiveKitRoomService();
    if (service) {
      const lkRoom = `sala_${roomId}`;
      try {
        if (action === 'kick') {
          await service.removeParticipant(lkRoom, targetUserId);
        } else {
          await service.updateParticipant(lkRoom, targetUserId, undefined, {
            canPublish: action === 'unmute',
          });
        }
      } catch (err) {
        console.error('[room:voice] livekit moderation failed:', err.message);
      }
    }

    io.to(`sala:${roomId}`).emit('room:voice_moderated', {
      roomId,
      action,
      targetUserId,
      targetName: target.displayName || target.username || '',
      actorId: userId,
      actorName: actor.displayName || actor.username || '',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[room:voice] moderation failed:', err.message);
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
      socket.userId = payload.sub;
      socket.username = String(payload.username ?? '');
      nextFn();
    })
    .catch(() => nextFn(new Error('Unauthorized')));
});

io.on('connection', (socket) => {
  // Join personal room for targeted notification push
  if (socket.data.userId) {
    socket.join(`user:${socket.data.userId}`);
  }
  socket.join('moderation:feed');

  socket.on('conversation:join', async (data) => {
    const conversationId =
      typeof data === 'string' ? data : (typeof data === 'object' && data !== null ? data.conversationId : null);
    const userId = socket.userId || socket.data?.userId;

    if (!conversationId || typeof conversationId !== 'string' || !userId) {
      socket.emit('conversation:error', { error: 'No autorizado para unirse a esta conversación' });
      return;
    }

    try {
      const membership = await prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
      });

      if (!membership) {
        socket.emit('conversation:error', { error: 'No autorizado para unirse a esta conversación' });
        return;
      }

      socket.join(`conversation:${conversationId}`);
    } catch (err) {
      console.error('[conversation:join] error validating membership:', err.message);
      socket.emit('conversation:error', { error: 'Error al unirse a la conversación' });
    }
  });
  socket.on('conversation:leave', (data) => {
    const conversationId =
      typeof data === 'string' ? data : (typeof data === 'object' && data !== null ? data.conversationId : null);
    if (typeof conversationId === 'string' && conversationId) {
      socket.leave(`conversation:${conversationId}`);
    }
  });
  socket.on('room:join', (data) => {
    const parsedRoomId =
      typeof data === 'string' ? data : (data?.roomId || data?.id);
    if (typeof parsedRoomId === 'string' && parsedRoomId) {
      socket.join(`sala:${parsedRoomId}`);
      console.log(`[SOCKET_SERVER] Socket ${socket.id} (User: ${socket.data.userId}) suscrito a canal sala:${parsedRoomId} (silencioso)`);
    }
  });
  socket.on('room:leave', (data) => {
    const parsedRoomId =
      typeof data === 'string' ? data : (data?.roomId || data?.id);
    if (typeof parsedRoomId === 'string' && parsedRoomId) {
      socket.leave(`sala:${parsedRoomId}`);
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
  socket.on('room:message', (payload) => {
    handleSendRoomMessage(socket, payload);
  });
  socket.on('chat:message', (payload) => {
    handleSendRoomMessage(socket, payload);
  });
  socket.on('send_message', (payload) => {
    handleSendRoomMessage(socket, payload);
  });

  // Edición y eliminación de mensajes de sala vía Socket.IO
  socket.on('room:message_edit', (payload) => {
    handleEditRoomMessage(socket, payload);
  });
  socket.on('room:message:edit', (payload) => {
    handleEditRoomMessage(socket, payload);
  });
  socket.on('room:edit_message', (payload) => {
    handleEditRoomMessage(socket, payload);
  });
  socket.on('room:message_delete', (payload) => {
    handleDeleteRoomMessage(socket, payload);
  });
  socket.on('room:message:delete', (payload) => {
    handleDeleteRoomMessage(socket, payload);
  });
  socket.on('room:delete_message', (payload) => {
    handleDeleteRoomMessage(socket, payload);
  });

  // Sala de Cine sincronizada: acciones del host → persist + broadcast.
  socket.on('cinema:action', (payload) => {
    handleCinemaAction(socket, payload);
  });

  // Cambio de modo de sala (voice / roleplay / screening / standard) y
  // moderación del canal de voz (mute / unmute / kick) → broadcast en vivo.
  socket.on('room:mode-change', (payload) => {
    handleRoomModeChange(socket, payload);
  });
  socket.on('room:mode_change', (payload) => {
    handleRoomModeChange(socket, payload);
  });
  socket.on('room:change_mode', (payload) => {
    handleRoomModeChange(socket, payload);
  });
  socket.on('room:voice-moderation', (payload) => {
    handleRoomVoiceModeration(socket, payload);
  });
  socket.on('room:voice_moderation', (payload) => {
    handleRoomVoiceModeration(socket, payload);
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
