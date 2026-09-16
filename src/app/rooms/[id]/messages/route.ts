import { z } from 'zod';
import { FollowRequestStatus, Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { messageInclude, serializeMessage } from '@/lib/chat';
import { sendPushNotification } from '@/lib/fcm';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToConversation, emitToUser } from '@/lib/socketio';
import { optionalSafeHttpUrl } from '@/lib/validation';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!membership) return fail('No autorizado', 403);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const before = url.searchParams.get('before');
  const after = url.searchParams.get('after');

  const where: Record<string, unknown> = { conversationId: id };
  if (before) {
    const cursor = await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true, id: true } });
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
  }
  if (after) {
    const cursor = await prisma.message.findUnique({ where: { id: after }, select: { createdAt: true, id: true } });
    if (cursor) {
      where.OR = [
        { createdAt: { gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { gt: cursor.id } },
      ];
    }
  }

  // Cursor a cargo de la paginación: consultamos limit+1 para determinar hasMore
  // sin ejecutar un count() costoso en cada petición.
  const messages = await prisma.message.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageInclude,
  });

  const hasMore = messages.length > limit;
  const pageMessages = hasMore ? messages.slice(0, limit) : messages;

  return ok({
    data: pageMessages.map(serializeMessage),
    hasMore,
  });
});

const sendSchema = z.object({
  body: z.string().trim().max(4000).optional().default(''),
  content: z.string().trim().max(4000).optional(),
  mediaUrl: optionalSafeHttpUrl,
  mediaType: z.string().nullable().optional(),
  replyToId: z.string().nullable().optional(),

  // ── Roleplay / OCs ──
  characterId: z.string().max(64).nullable().optional(),
  characterName: z.string().max(80).nullable().optional(),
  characterAvatarUrl: optionalSafeHttpUrl,
  extensions: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados/silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { id } = await params;

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!membership) return fail('No autorizado', 403);

  const body = sendSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  const rawBody =
    body.data.body ||
    body.data.content ||
    (body.data.mediaUrl ? '[Imagen adjunta]' : '');

  if (!rawBody && !body.data.mediaUrl) {
    return fail('El contenido del mensaje no puede estar vacío', 400);
  }

  if (body.data.replyToId) {
    const reply = await prisma.message.findFirst({
      where: { id: body.data.replyToId, conversationId: id },
      select: { id: true },
    });
    if (!reply) return fail('Mensaje de referencia no encontrado', 404);
  }

  const effectiveBody = rawBody || '[Imagen adjunta]';
  const effectiveMediaType =
    body.data.mediaType ?? (body.data.mediaUrl ? 'image' : null);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: id,
        senderId: session.userId,
        body: effectiveBody,
        mediaUrl: body.data.mediaUrl ?? null,
        mediaType: effectiveMediaType,
        replyToId: body.data.replyToId ?? null,

        characterId: body.data.characterId ?? null,
        characterName: body.data.characterName ?? null,
        characterAvatarUrl: body.data.characterAvatarUrl ?? null,
        extensions: (body.data.extensions ?? {}) as Prisma.InputJsonValue,

      },
      include: messageInclude,
    });
    await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    await tx.conversationMember.update({
      where: { id: membership.id },
      data: { lastReadAt: new Date() },
    });

    // Si es un chat directo, marcar cualquier solicitud/invitación pendiente previa entre ambos como ACCEPTED
    const conv = await tx.conversation.findUnique({
      where: { id },
      select: {
        type: true,
        members: { select: { userId: true } },
      },
    });
    if (conv?.type === 'DIRECT') {
      const otherUserIds = conv.members
        .map((m) => m.userId)
        .filter((uid) => uid !== session.userId);
      if (otherUserIds.length > 0) {
        await tx.followRequest.updateMany({
          where: {
            OR: [
              { requesterId: session.userId, targetId: { in: otherUserIds } },
              { requesterId: { in: otherUserIds }, targetId: session.userId },
            ],
            status: FollowRequestStatus.PENDING,
          },
          data: {
            status: FollowRequestStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });
      }
    }

    return created;
  });

  emitToConversation(id, 'message:new', serializeMessage(message));
  // El receptor puede no estar unido al canal `conversation:<id>` (solo se une
  // al abrir el chat). Empujamos también a la sala personal de cada miembro
  // (salvo el emisor) para mantener la bandeja de conversaciones al día.
  const memberIds = await prisma.conversationMember.findMany({
    where: { conversationId: id, userId: { not: session.userId } },
    select: { userId: true },
  });
  for (const member of memberIds) {
    emitToUser(member.userId, 'message:new', serializeMessage(message));
  }

  // ── Push FCM para DMs ──
  // Notifica a los miembros OFFLINE (socket inactivo / sala sin foco) y que
  // no tienen la conversación silenciada. `emitToUser` sólo impacta si el
  // socket está vivo; FCM cubre el resto de casos.
  const offlineMembers = await prisma.conversationMember.findMany({
    where: {
      conversationId: id,
      userId: { not: session.userId },
      muted: false,
      user: { isOnline: false },
    },
    select: { userId: true },
  });
  if (offlineMembers.length > 0) {
    const senderName =
      message.characterName ?? message.sender.displayName ?? message.sender.username;
    for (const member of offlineMembers) {
      await sendPushNotification({
        userId: member.userId,
        title: `${senderName} te escribió 💬`,
        body: message.mediaUrl && !message.body
          ? '📎 Te ha enviado un archivo'
          : message.body.slice(0, 180),
        data: {
          type: 'message',
          conversationId: id,
          messageId: message.id,
          senderId: message.senderId,
        },
        imageUrl: message.characterAvatarUrl ?? message.sender.avatarUrl ?? null,
      });
    }
  }
  return ok(serializeMessage(message), 201);
});
