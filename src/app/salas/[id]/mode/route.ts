import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeRoom } from '@/lib/social';
import { emitToSala } from '@/lib/socketio';

/** Cooldown mínimo entre cambios de modo (ms). Evita ráfagas de peticiones. */
const MODE_COOLDOWN_MS = 3_000;

/**
 * Mapa en memoria: roomId → timestamp (ms) del último cambio de modo exitoso.
 * Se limpia automáticamente al inicio de cada petición si el cooldown ya expiró.
 */
const lastModeChangeMap = new Map<string, number>();

const MANAGEABLE_ROLES = new Set([
  'HOST',
  'CO_HOST',
  'ADMIN',
  'OWNER',
  'CO_ADMIN',
  'COADMIN',
  'MODERATOR',
]);

const ACTIVE_MODES = new Set(['voice', 'screening', 'roleplay']);

const MODE_SYSTEM_TEXT: Record<string, string> = {
  voice: '[Sistema]: Chat de voz iniciado.',
  screening: '[Sistema]: Sala de cine iniciada.',
  roleplay: '[Sistema]: Sesión de roleplay iniciada.',
};

const MODE_SYSTEM_TEXT_END: Record<string, string> = {
  voice: '[Sistema]: Chat de voz finalizado.',
  screening: '[Sistema]: Sala de cine finalizada.',
  roleplay: '[Sistema]: Sesión de roleplay finalizada.',
};

function normalizeRoomMode(mode?: string | null): 'standard' | 'voice' | 'roleplay' | 'screening' {
  if (!mode || typeof mode !== 'string') return 'standard';
  const m = mode.trim().toLowerCase();
  if (m === 'cinema' || m === 'screening' || m === 'cine' || m === 'movie') return 'screening';
  if (m === 'voice' || m === 'voz' || m === 'audio') return 'voice';
  if (m === 'roleplay' || m === 'rp' || m === 'rol') return 'roleplay';
  return 'standard';
}

async function canManageRoom(roomId: string, userId: string) {
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
  return Boolean(participant && MANAGEABLE_ROLES.has(participant.role.toUpperCase()));
}

const modeSchema = z.object({
  mode: z.string().trim().min(1),
  videoId: z.string().trim().max(128).nullable().optional(),
  cinemaState: z.string().trim().max(32).nullable().optional(),
  currentTime: z.number().min(0).nullable().optional(),
});

async function handleModeChange(request: Request, roomId: string) {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const canManage = await canManageRoom(roomId, session.userId);
  if (!canManage) return fail('No tienes permiso para cambiar el modo de la sala', 403);

  // Rate limiting por sala: rechazar si el último cambio de modo fue hace menos de MODE_COOLDOWN_MS.
  const now = Date.now();
  const lastChange = lastModeChangeMap.get(roomId);
  if (lastChange !== undefined && now - lastChange < MODE_COOLDOWN_MS) {
    const remainingMs = MODE_COOLDOWN_MS - (now - lastChange);
    const remainingSec = Math.ceil(remainingMs / 1_000);
    return fail(
      `Cambio de modo en cooldown. Espera ${remainingSec} s antes de volver a cambiar.`,
      429,
    );
  }

  const body = modeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos de modo inválidos', 400);

  const data = body.data;
  const targetMode = normalizeRoomMode(data.mode);

  const txResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.room.findUnique({
      where: { id: roomId },
      include: {
        host: true,
        circle: { select: { id: true, name: true, avatarUrl: true } },
        participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
        _count: { select: { participants: true } },
      },
    });
    if (!existing) return null;

    const previousMode = normalizeRoomMode(existing.currentMode);
    const systemMessagesToCreate: string[] = [];

    // Si había una actividad activa previa y cambia de modo:
    if (ACTIVE_MODES.has(previousMode) && targetMode !== previousMode) {
      systemMessagesToCreate.push(
        MODE_SYSTEM_TEXT_END[previousMode] ?? '[Sistema]: Actividad finalizada.'
      );
    }

    // Si la nueva actividad es activa y diferente a la previa:
    if (ACTIVE_MODES.has(targetMode) && targetMode !== previousMode) {
      systemMessagesToCreate.push(
        MODE_SYSTEM_TEXT[targetMode] ?? '[Sistema]: Actividad iniciada.'
      );
    }

    const now = Date.now();
    const createdMessages = [];
    for (let i = 0; i < systemMessagesToCreate.length; i++) {
      const msgBody = systemMessagesToCreate[i];
      const msg = await tx.roomMessage.create({
        data: {
          roomId,
          senderId: session.userId,
          type: 'SYSTEM',
          body: msgBody,
          extensions: { subType: 'MODE_CHANGE', previousMode, newMode: targetMode },
          createdAt: new Date(now + i * 10),
        },
        include: { sender: true },
      });
      createdMessages.push(msg);
    }

    const roomUpdateData: Record<string, unknown> = {
      currentMode: targetMode,
    };

    if (targetMode === 'screening') {
      if (data.videoId !== undefined) roomUpdateData.cinemaVideoId = data.videoId;
      if (data.cinemaState !== undefined) roomUpdateData.cinemaState = data.cinemaState ?? 'STOPPED';
      if (data.currentTime !== undefined && data.currentTime !== null) {
        roomUpdateData.cinemaCurrentTime = data.currentTime;
      }
      roomUpdateData.cinemaUpdatedAt = new Date();
    } else if (previousMode === 'screening') {
      // Limpieza atómica de sala de cine al salir de screening
      roomUpdateData.cinemaVideoId = null;
      roomUpdateData.cinemaState = 'STOPPED';
      roomUpdateData.cinemaCurrentTime = 0.0;
      roomUpdateData.cinemaUpdatedAt = new Date();
    }

    const updatedRoom = await tx.room.update({
      where: { id: roomId },
      data: roomUpdateData,
      include: {
        host: true,
        circle: { select: { id: true, name: true, avatarUrl: true } },
        participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
        _count: { select: { participants: true } },
      },
    });

    return { updatedRoom, previousMode, targetMode, createdMessages };
  });

  if (!txResult) return fail('Sala no encontrada', 404);

  const { updatedRoom, previousMode, createdMessages } = txResult;

  // Registrar timestamp del cambio exitoso para el rate limiting.
  lastModeChangeMap.set(roomId, Date.now());

  // 1. Si se cerró la sala de cine, emitir cinema:sync con CLEAR
  if (previousMode === 'screening' && targetMode !== 'screening') {
    emitToSala(roomId, 'cinema:sync', {
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
    emitToSala(roomId, 'room:message', {
      id: msg.id,
      roomId: msg.roomId,
      senderId: msg.senderId,
      type: msg.type,
      body: msg.body,
      extensions: msg.extensions,
      createdAt: msg.createdAt.toISOString(),
      sender: {
        id: msg.sender.id,
        username: msg.sender.username,
        displayName: msg.sender.displayName,
        avatarUrl: msg.sender.avatarUrl,
      },
    });
  }

  // 3. Emitir room:mode_changed
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, displayName: true },
  });
  const actorName = user?.displayName || user?.username || 'Moderador';

  emitToSala(roomId, 'room:mode_changed', {
    roomId,
    mode: targetMode,
    actorId: session.userId,
    actorName,
    cinemaVideoId: updatedRoom.cinemaVideoId ?? null,
    cinemaState: updatedRoom.cinemaState ?? 'STOPPED',
    cinemaCurrentTime: updatedRoom.cinemaCurrentTime ?? 0,
    cinemaUpdatedAt: updatedRoom.cinemaUpdatedAt
      ? updatedRoom.cinemaUpdatedAt.toISOString()
      : null,
    timestamp: new Date().toISOString(),
  });

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId: session.userId } },
  });

  return ok(
    serializeRoom(updatedRoom, {
      myUserId: session.userId,
      isParticipant: participant != null,
      fullParticipants: updatedRoom.participants,
    })
  );
}

export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    return handleModeChange(request, id);
  }
);

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    return handleModeChange(request, id);
  }
);

/**
 * Solo para tests: limpia el mapa de cooldown de modo para una sala específica.
 * No llamar en producción.
 */
export function _resetModeChangeCooldownForTesting(roomId?: string): void {
  if (roomId) {
    lastModeChangeMap.delete(roomId);
  } else {
    lastModeChangeMap.clear();
  }
}
