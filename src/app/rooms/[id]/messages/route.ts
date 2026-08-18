import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { messageInclude, serializeMessage } from '@/lib/chat';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToConversation } from '@/lib/socketio';

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

  const messages = await prisma.message.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: messageInclude,
  });

  const oldest = messages.length > 0 ? messages[messages.length - 1] : null;
  let hasMore = false;
  if (oldest && !after) {
    hasMore = (await prisma.message.count({
      where: {
        conversationId: id,
        OR: [
          { createdAt: { lt: oldest.createdAt } },
          { createdAt: oldest.createdAt, id: { lt: oldest.id } },
        ],
      },
    })) > 0;
  }

  return ok({
    data: messages.map(serializeMessage),
    hasMore,
    total: await prisma.message.count({ where: { conversationId: id } }),
  });
});

const sendSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  mediaUrl: z.string().nullable().optional(),
  mediaType: z.string().nullable().optional(),
  replyToId: z.string().nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: session.userId } },
    select: { id: true },
  });
  if (!membership) return fail('No autorizado', 403);

  const body = sendSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');
  if (body.data.replyToId) {
    const reply = await prisma.message.findFirst({
      where: { id: body.data.replyToId, conversationId: id },
      select: { id: true },
    });
    if (!reply) return fail('Mensaje de referencia no encontrado', 404);
  }

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: id,
        senderId: session.userId,
        body: body.data.body,
        mediaUrl: body.data.mediaUrl ?? null,
        mediaType: body.data.mediaType ?? null,
        replyToId: body.data.replyToId ?? null,
      },
      include: messageInclude,
    });
    await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
    await tx.conversationMember.update({
      where: { id: membership.id },
      data: { lastReadAt: new Date() },
    });
    return created;
  });

  emitToConversation(id, 'message:new', serializeMessage(message));
  return ok(serializeMessage(message), 201);
});
