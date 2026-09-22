import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';
import { serializeAuthor } from '@/lib/serialize';
import { optionalSafeHttpUrl, optionalSafeMediaUrl, safeHttpUrl } from '@/lib/validation';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, hostId: true, status: true, access: true, circleId: true },
  });
  if (!room) return fail('Sala no encontrada', 404);

  const isHost = room.hostId === session.userId;
  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!isHost && room.access === 'PRIVATE' && !participant) {
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

  const serialized = filteredMessages.map((m) => serializeRoomMessage(m, session.userId));
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

function serializeRoomMessage(
  message: {
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
  },
  currentUserId?: string
) {
  const senderName = message.sender.displayName ?? message.sender.username;
  const ext = ((message.extensions ?? {}) as Record<string, any>) || {};
  const roleColor = (ext.roleColor || ext.roleColorHex || ext.colorHex || ext.characterColor || null) as string | null;
  const clientTempId = (ext.clientTempId || null) as string | null;
  const mediaUrl = (ext.mediaUrl || ext.imageUrl || (message.type === 'IMAGE' || message.type === 'VOICE' ? message.body : null)) as string | null;
  const attachments = (Array.isArray(ext.attachments) ? ext.attachments : (mediaUrl ? [mediaUrl] : [])) as string[];
  const diceResult = (ext.diceResult || null) as string | null;
  const diceEmoji = (ext.diceEmoji || null) as string | null;
  const diceName = (ext.diceName || null) as string | null;

  let pollMetadata = ext;
  let userVotedOptionId: string | null = null;
  let userVotedOptionIndex: number | null = null;
  let totalVotes: number | undefined = undefined;
  let voteCounts: number[] | undefined = undefined;

  if (message.type === 'POLL') {
    const rawOptions = Array.isArray(ext.options) ? ext.options : [];
    const votes: Record<string, string> =
      typeof ext.votes === 'object' && ext.votes !== null ? ext.votes : {};

    const options = rawOptions.map((opt: any, idx: number) => {
      if (typeof opt === 'string') {
        return { id: String(idx), text: opt, votes: 0 };
      }
      return {
        id: String(opt?.id ?? idx),
        text: String(opt?.text ?? ''),
        votes: Number(opt?.votes ?? 0),
      };
    });

    if (Object.keys(votes).length > 0) {
      const counts: number[] = new Array(options.length).fill(0);
      let calculatedTotal = 0;
      for (const [, votedOptId] of Object.entries(votes)) {
        const optIdx = options.findIndex((o) => o.id === votedOptId || o.text === votedOptId);
        if (optIdx !== -1) {
          counts[optIdx]++;
          calculatedTotal++;
        }
      }
      voteCounts = counts;
      totalVotes = calculatedTotal;
      for (let i = 0; i < options.length; i++) {
        options[i].votes = counts[i];
      }
    } else {
      voteCounts = options.map((o) => o.votes);
      totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
    }

    if (currentUserId && votes[currentUserId]) {
      const votedOptId = votes[currentUserId];
      const optIdx = options.findIndex((o) => o.id === votedOptId || o.text === votedOptId);
      userVotedOptionId = votedOptId;
      userVotedOptionIndex = optIdx !== -1 ? optIdx : null;
    } else if (ext.userVotedOptionId) {
      userVotedOptionId = String(ext.userVotedOptionId);
      userVotedOptionIndex =
        typeof ext.userVotedOptionIndex === 'number' ? ext.userVotedOptionIndex : null;
    }

    pollMetadata = {
      ...ext,
      options,
      totalVotes,
      voteCounts,
      userVotedOptionId,
      userVotedOptionIndex,
      hasVoted: userVotedOptionId !== null,
    };
  }

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
    metadata: pollMetadata as Prisma.JsonObject,

    // ── Reply & Edit fields ──
    replyToId: (ext.replyToId || ext.replyTo?.id || null) as string | null,
    replyToName: (ext.replyToName || ext.replyTo?.authorName || ext.replyTo?.username || null) as string | null,
    replyToBody: (ext.replyToBody || ext.replyTo?.content || null) as string | null,
    replyToMediaUrl: (ext.replyToMediaUrl || ext.replyTo?.mediaUrl || null) as string | null,
    replyToType: (ext.replyToType || ext.replyTo?.type || null) as string | null,
    replyTo: (ext.replyTo || (ext.replyToId ? { id: ext.replyToId, authorName: ext.replyToName, content: ext.replyToBody } : null)) as any,
    isEdited: Boolean(ext.isEdited),
    editedAt: (ext.editedAt || null) as string | null,
    editCount: Number(ext.editCount || 0),

    // ── Compatibilidad con el wire format existente ──
    body: message.body,
    characterId: message.characterId ?? null,
    characterName: message.characterName ?? null,
    characterAvatarUrl: message.characterAvatarUrl ?? null,
    userVotedOptionId,
    userVotedOptionIndex,
    totalVotes,
    voteCounts,
    role: message.characterName
      ? {
          id: message.characterId ?? message.senderId,
          name: message.characterName,
          avatarUrl: message.characterAvatarUrl ?? null,
          colorHex: roleColor || '#00E5FF',
          color: roleColor || '#00E5FF',
        }
      : null,
    extensions: pollMetadata as Prisma.JsonObject,

    createdAt: message.createdAt.toISOString(),
  };
}

const sendSchema = z.object({
  body: z.string().trim().max(4000).optional().default(''),
  content: z.string().trim().max(4000).optional(),
  mediaUrl: optionalSafeMediaUrl,
  attachments: z.array(safeHttpUrl).max(5, 'Máximo 5 adjuntos por mensaje').optional(),

  // Tipo de contenido: texto por defecto; voz, imagen, encuesta, dados, rps o sistema.
  type: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['TEXT', 'VOICE', 'IMAGE', 'POLL', 'SYSTEM', 'DICE', 'RPS']).default('TEXT'),
  ),

  // ── Roleplay / OCs ──
  characterId: z.string().max(64).nullable().optional(),
  characterName: z.string().max(80).nullable().optional(),
  characterAvatarUrl: optionalSafeHttpUrl,
  replyToId: z.string().nullable().optional(),
  replyTo: z
    .object({
      id: z.string(),
      username: z.string().optional(),
      authorName: z.string().optional(),
      content: z.string().optional(),
      mediaUrl: optionalSafeMediaUrl,
      type: z.string().max(16).optional(),
    })
    .nullable()
    .optional(),
  extensions: z
    .record(z.string(), z.any())
    .nullable()
    .optional()
    .refine(
      (val) => !val || JSON.stringify(val).length <= 16384,
      { message: 'El payload de metadatos/extensiones excede el límite seguro de 16KB' },
    ),
  metadata: z
    .record(z.string(), z.any())
    .nullable()
    .optional()
    .refine(
      (val) => !val || JSON.stringify(val).length <= 16384,
      { message: 'El payload de metadatos/extensiones excede el límite seguro de 16KB' },
    ),
});

const restRoomChatRateLimits = new Map<string, { timestamps: number[]; lastSent: number }>();

function checkRestRoomChatRateLimit(userId: string): { limited: boolean; retryAfterMs: number } {
  const now = Date.now();
  const record = restRoomChatRateLimits.get(userId) || { timestamps: [], lastSent: 0 };

  // 1. Mínimo 0.8 segundos entre mensajes consecutivos. Alineado con el
  //    debounce de 800 ms del frontend: tiradas de dados / minijuegos
  //    consecutivas quedan fluidas sin 429.
  if (now - record.lastSent < 800) {
    return { limited: true, retryAfterMs: 800 - (now - record.lastSent) };
  }

  // 2. Máximo 8 mensajes por cada 5 segundos (~1.6 msg/s sostenido; permite
  //    ráfagas de 2-3 acciones por segundo por usuario sin bloquear).
  const windowMs = 5000;
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
  if (record.timestamps.length >= 8) {
    const oldest = record.timestamps[0];
    return { limited: true, retryAfterMs: windowMs - (now - oldest) };
  }

  record.lastSent = now;
  record.timestamps.push(now);
  restRoomChatRateLimits.set(userId, record);

  if (restRoomChatRateLimits.size > 5000) {
    for (const [uid, r] of restRoomChatRateLimits.entries()) {
      if (now - r.lastSent > 60000) {
        restRoomChatRateLimits.delete(uid);
      }
    }
  }

  return { limited: false, retryAfterMs: 0 };
}

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados/silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, hostId: true, status: true, access: true, circleId: true },
  });
  if (!room) return fail('Sala no encontrada', 404);
  if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

  const isHost = room.hostId === session.userId;
  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!participant && !isHost) return fail('Debes entrar a la sala para enviar mensajes', 403);

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

  if (body.data.type === 'POLL') {
    const pollMeta = (body.data.metadata || body.data.extensions || {}) as Record<string, any>;
    const pollQuestion = typeof pollMeta.question === 'string' ? pollMeta.question.trim() : rawBody;
    if (!pollQuestion || pollQuestion.length > 80) {
      return fail('La pregunta de la encuesta debe tener entre 1 y 80 caracteres', 400);
    }
    const pollOptions = Array.isArray(pollMeta.options) ? pollMeta.options : [];
    if (pollOptions.length < 2 || pollOptions.length > 6) {
      return fail('La encuesta debe tener entre 2 y 6 opciones', 400);
    }
    for (const opt of pollOptions) {
      const optText = typeof opt === 'string' ? opt.trim() : (typeof opt?.text === 'string' ? opt.text.trim() : '');
      if (!optText || optText.length > 20) {
        return fail('Cada opción de la encuesta debe tener entre 1 y 20 caracteres', 400);
      }
    }
  }

  // Omitir rate limit en tests o evaluar después de validar el esquema básico del mensaje
  if (process.env.NODE_ENV !== 'test') {
    const isLimited = checkRestRoomChatRateLimit(session.userId);
    if (isLimited.limited) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Estás enviando mensajes demasiado rápido.' },
        { status: 429 }
      );
    }
  }

  const finalBody =
    rawBody ||
    (body.data.type === 'IMAGE' ? '[Imagen]' : body.data.type === 'VOICE' ? '[Audio]' : '[Multimedia]');

  // Resolver mensaje citado si se envía replyToId o replyTo
  const targetReplyId = body.data.replyToId || body.data.replyTo?.id;
  let replyData: {
    id: string;
    authorName: string;
    content: string;
    mediaUrl?: string | null;
    type?: string | null;
  } | null = null;
  if (targetReplyId) {
    const quoted = await prisma.roomMessage.findUnique({
      where: { id: targetReplyId },
      include: { sender: true },
    });
    if (quoted) {
      const quotedExt = ((quoted.extensions ?? {}) as Record<string, any>) || {};
      const quotedMediaUrl =
        (typeof quotedExt.mediaUrl === 'string' && quotedExt.mediaUrl) ||
        (quoted.type === 'IMAGE' || quoted.type === 'VOICE'
          ? quoted.body.startsWith('http')
            ? quoted.body
            : null
          : null);
      replyData = {
        id: quoted.id,
        authorName:
          quoted.characterName ||
          quoted.sender.displayName ||
          quoted.sender.username,
        content: quoted.body,
        mediaUrl: quotedMediaUrl || null,
        type: quoted.type,
      };
    } else if (body.data.replyTo) {
      replyData = {
        id: body.data.replyTo.id,
        authorName:
          body.data.replyTo.authorName ||
          body.data.replyTo.username ||
          'Usuario',
        content: body.data.replyTo.content || '',
        mediaUrl: body.data.replyTo.mediaUrl ?? null,
        type: body.data.replyTo.type ?? null,
      };
    }
  }

  const mergedExtensions: Record<string, any> = {
    ...(body.data.extensions || {}),
    ...(body.data.metadata || {}),
    ...(body.data.mediaUrl ? { mediaUrl: body.data.mediaUrl } : {}),
    ...(body.data.attachments ? { attachments: body.data.attachments } : {}),
    ...(replyData
      ? {
          replyToId: replyData.id,
          replyTo: replyData,
          replyToName: replyData.authorName,
          replyToBody: replyData.content,
          ...(replyData.mediaUrl ? { replyToMediaUrl: replyData.mediaUrl } : {}),
          ...(replyData.type ? { replyToType: replyData.type } : {}),
        }
      : {}),
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
      return ok(serializeRoomMessage(existing as any, session.userId), 200);
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

  emitToSala(id, 'room:message', serializeRoomMessage(message, session.userId));

  return ok(serializeRoomMessage(message, session.userId), 201);
});