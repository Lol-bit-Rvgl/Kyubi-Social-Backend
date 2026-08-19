import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { conversationInclude, serializeConversation } from '@/lib/chat';
import { emitToConversation, emitToUser } from '@/lib/socketio';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));

  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: session.userId } } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: conversationInclude,
  });

  const myMemberships = await prisma.conversationMember.findMany({
    where: { userId: session.userId, conversationId: { in: conversations.map((c) => c.id) } },
    select: { conversationId: true, lastReadAt: true, lastReadMessageId: true },
  });
  const byId = new Map(myMemberships.map((m) => [m.conversationId, m]));

  const data = await Promise.all(
    conversations.map(async (conversation) => {
      const membership = byId.get(conversation.id);
      let unreadCount = 0;
      if (membership) {
        const since = membership.lastReadMessageId
          ? await prisma.message.findUnique({
              where: { id: membership.lastReadMessageId },
              select: { createdAt: true },
            })
          : null;
        const threshold = since?.createdAt ?? membership.lastReadAt;
        if (threshold) {
          unreadCount = await prisma.message.count({
            where: {
              conversationId: conversation.id,
              senderId: { not: session.userId },
              createdAt: { gt: threshold },
            },
          });
        } else {
          unreadCount = await prisma.message.count({
            where: { conversationId: conversation.id, senderId: { not: session.userId } },
          });
        }
      }
      return serializeConversation(conversation, session.userId, unreadCount);
    })
  );

  return ok({ data, total: data.length });
});

const createSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  let targetId = body.data.userId;
  if (!targetId && body.data.username) {
    const target = await findUserByIdOrUsername(body.data.username);
    if (!target) return fail('Usuario no encontrado', 404);
    targetId = target.id;
  }
  if (!targetId) return fail('userId o username requerido');
  if (targetId === session.userId) return fail('No puedes chatear contigo mismo');

  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'DIRECT',
      members: { every: { userId: { in: [session.userId, targetId] } } },
    },
    include: conversationInclude,
  });
  if (existing) return ok(serializeConversation(existing, session.userId, 0));

  const conversation = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      members: {
        create: [
          { userId: session.userId },
          { userId: targetId },
        ],
      },
    },
    include: conversationInclude,
  });

  emitToConversation(conversation.id, 'conversation:new', {
    conversation: serializeConversation(conversation, session.userId, 0),
  });
  // El destinatario aún no se ha unido al canal `conversation:<id>` (solo
  // se une al abrir el chat). Le empujamos el evento a su sala personal para
  // que la nueva conversación le aparezca en la bandeja en tiempo real.
  emitToUser(targetId, 'conversation:new', {
    conversation: serializeConversation(conversation, targetId, 0),
  });

  return ok(serializeConversation(conversation, session.userId, 0), 201);
});
