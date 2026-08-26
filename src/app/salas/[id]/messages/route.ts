import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';
import { serializeAuthor } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, status: true, access: true, circleId: true },
  });
  if (!room) return fail('Sala no encontrada', 404);

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true },
  });
  if (room.access === 'PRIVATE' && !participant) {
    if (room.circleId) {
      const membership = await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId: room.circleId, userId: session.userId } },
        select: { id: true },
      });
      if (!membership) return fail('No tienes acceso a esta sala', 403);
    } else {
      return fail('No tienes acceso a esta sala', 403);
    }
  }

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const before = url.searchParams.get('before');

  const where: Prisma.RoomMessageWhereInput = { roomId: id };
  if (before) {
    const cursor = await prisma.roomMessage.findUnique({
      where: { id: before },
      select: { createdAt: true, id: true },
    });
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
  }

  const messages = await prisma.roomMessage.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { sender: true },
  });

  const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
  let hasMore = false;
  if (oldest) {
    hasMore = (await prisma.roomMessage.count({
      where: {
        roomId: id,
        OR: [
          { createdAt: { lt: oldest.createdAt } },
          { createdAt: oldest.createdAt, id: { lt: oldest.id } },
        ],
      },
    })) > 0;
  }

  return ok({
    data: messages.map(serializeRoomMessage),
    hasMore,
    total: await prisma.roomMessage.count({ where: { roomId: id } }),
  });
});

type SenderPayload = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  usernameColor?: string | null;
  avatarFrame?: string | null;
  level?: number | null;
  isOnline?: boolean | null;
  gender?: string | null;
  showGender?: boolean | null;
};

function serializeRoomMessage(message: {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatarUrl?: string | null;
  extensions?: Prisma.JsonValue | null;
  createdAt: Date;
  sender: SenderPayload;
}) {
  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    sender: serializeAuthor(message.sender),
    body: message.body,

    // ── Roleplay / OCs ──
    characterId: message.characterId ?? null,
    characterName: message.characterName ?? null,
    characterAvatarUrl: message.characterAvatarUrl ?? null,
    extensions: (message.extensions ?? {}) as Prisma.JsonObject,

    createdAt: message.createdAt.toISOString(),
  };
}

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),

  // ── Roleplay / OCs ──
  characterId: z.string().max(64).nullable().optional(),
  characterName: z.string().max(80).nullable().optional(),
  characterAvatarUrl: z.string().max(2048).nullable().optional(),
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, status: true, access: true, circleId: true },
  });
  if (!room) return fail('Sala no encontrada', 404);
  if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!participant) return fail('Debes entrar a la sala para enviar mensajes', 403);

  const body = sendSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Mensaje inválido', 400);

  const message = await prisma.roomMessage.create({
    data: {
      roomId: id,
      senderId: session.userId,
      body: body.data.body,

      characterId: body.data.characterId ?? null,
      characterName: body.data.characterName ?? null,
      characterAvatarUrl: body.data.characterAvatarUrl ?? null,
      extensions: (body.data.extensions ?? {}) as Prisma.InputJsonValue,
    },
    include: { sender: true },
  });

  emitToSala(id, 'room:message', serializeRoomMessage(message));

  return ok(serializeRoomMessage(message), 201);
});