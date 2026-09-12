import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';
import { serializeAuthor } from '@/lib/serialize';
import { optionalSafeHttpUrl } from '@/lib/validation';

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
  // `sort=asc` devuelve los últimos `limit` mensajes ordenados cronológicamente
  // (ascendente), pensado para clientes que consumen el historial como lista.
  // El resto de clientes conservan el orden descendente (hay paginación con `before`).
  const sortAsc = url.searchParams.get('sort') === 'asc';

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

  // Deduplicación estricta de mensajes de inicio / creación de sala (ROOM_CREATED / "Sala iniciada")
  let hasCreation = false;
  const filteredMessages = messages.filter((m) => {
    const isCreation =
      (m.type as string) === 'ROOM_CREATED' ||
      ((m.extensions as any)?.subType === 'ROOM_CREATED') ||
      m.body?.toLowerCase().includes('sala iniciada') ||
      m.body?.toLowerCase().includes('sala creada');
    if (isCreation) {
      if (hasCreation) return false;
      hasCreation = true;
    }
    return true;
  });

  const serialized = filteredMessages.map(serializeRoomMessage);
  if (sortAsc) serialized.reverse();

  return ok({
    data: serialized,
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
  type: string;
  body: string;
  characterId?: string | null;
  characterName?: string | null;
  characterAvatarUrl?: string | null;
  extensions?: Prisma.JsonValue | null;
  createdAt: Date;
  sender: SenderPayload;
}) {
  const senderName = message.sender.displayName ?? message.sender.username;
  const ext = ((message.extensions ?? {}) as Record<string, any>) || {};
  const roleColor = (ext.roleColor || ext.roleColorHex || ext.colorHex || ext.characterColor || null) as string | null;
  const clientTempId = (ext.clientTempId || null) as string | null;
  const mediaUrl = (ext.mediaUrl || ext.imageUrl || (message.type === 'IMAGE' || message.type === 'VOICE' ? message.body : null)) as string | null;
  const attachments = (Array.isArray(ext.attachments) ? ext.attachments : (mediaUrl ? [mediaUrl] : [])) as string[];
  const diceResult = (ext.diceResult || null) as string | null;
  const diceEmoji = (ext.diceEmoji || null) as string | null;
  const diceName = (ext.diceName || null) as string | null;

  return {
    id: message.id,
    roomId: message.roomId,
    senderId: message.senderId,
    sender: serializeAuthor(message.sender),

    // ── Payload estructurado (cliente genérico) ──
    senderName,
    username: message.sender.username,
    roleId: message.characterId ?? null,
    roleName: message.characterName ?? null,
    roleColor,
    characterColor: roleColor,
    clientTempId,
    type: message.type,
    content: message.body,
    mediaUrl,
    attachments,
    diceResult,
    diceEmoji,
    diceName,
    metadata: ext as Prisma.JsonObject,

    // ── Compatibilidad con el wire format existente ──
    body: message.body,
    characterId: message.characterId ?? null,
    characterName: message.characterName ?? null,
    characterAvatarUrl: message.characterAvatarUrl ?? null,
    role: message.characterName
      ? {
          id: message.characterId ?? message.senderId,
          name: message.characterName,
          avatarUrl: message.characterAvatarUrl ?? null,
          colorHex: roleColor || '#00E5FF',
          color: roleColor || '#00E5FF',
        }
      : null,
    extensions: ext as Prisma.JsonObject,

    createdAt: message.createdAt.toISOString(),
  };
}

const sendSchema = z.object({
  body: z.string().trim().max(4000).optional().default(''),
  content: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().trim().max(2048).optional(),
  attachments: z.array(z.string()).optional(),

  // Tipo de contenido: texto por defecto; voz, imagen, encuesta, dados, rps o sistema.
  type: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['TEXT', 'VOICE', 'IMAGE', 'POLL', 'SYSTEM', 'DICE', 'RPS']).default('TEXT'),
  ),

  // ── Roleplay / OCs ──
  characterId: z.string().max(64).nullable().optional(),
  characterName: z.string().max(80).nullable().optional(),
  characterAvatarUrl: optionalSafeHttpUrl,
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados/silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
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

  const rawBody =
    body.data.body ||
    body.data.content ||
    body.data.mediaUrl ||
    ((body.data.metadata?.mediaUrl ?? body.data.extensions?.mediaUrl) as string) ||
    '';

  if (!rawBody && body.data.type === 'TEXT') {
    return fail('El contenido del mensaje no puede estar vacío', 400);
  }

  const finalBody =
    rawBody ||
    (body.data.type === 'IMAGE' ? '[Imagen]' : body.data.type === 'VOICE' ? '[Audio]' : '[Multimedia]');

  const mergedExtensions = {
    ...(body.data.extensions || {}),
    ...(body.data.metadata || {}),
    ...(body.data.mediaUrl ? { mediaUrl: body.data.mediaUrl } : {}),
    ...(body.data.attachments ? { attachments: body.data.attachments } : {}),
  };

  const isCreationMessage =
    (body.data.type as string) === 'ROOM_CREATED' ||
    finalBody.toLowerCase().includes('sala iniciada') ||
    finalBody.toLowerCase().includes('sala creada') ||
    ((mergedExtensions as any)?.subType === 'ROOM_CREATED');

  if (isCreationMessage) {
    const existing = await prisma.roomMessage.findFirst({
      where: {
        roomId: id,
        OR: [
          { body: { contains: 'Sala iniciada', mode: 'insensitive' } },
          { body: { contains: 'Sala creada', mode: 'insensitive' } },
        ],
      },
      include: { sender: true },
    });
    if (existing && existing.sender) {
      return ok(serializeRoomMessage(existing as any), 200);
    }
  }

  const message = await prisma.roomMessage.create({
    data: {
      roomId: id,
      senderId: session.userId,
      type: body.data.type as any,
      body: finalBody,

      characterId: body.data.characterId ?? null,
      characterName: body.data.characterName ?? null,
      characterAvatarUrl: body.data.characterAvatarUrl ?? null,
      extensions: mergedExtensions as Prisma.InputJsonValue,
    },
    include: { sender: true },
  });

  emitToSala(id, 'room:message', serializeRoomMessage(message));

  return ok(serializeRoomMessage(message), 201);
});