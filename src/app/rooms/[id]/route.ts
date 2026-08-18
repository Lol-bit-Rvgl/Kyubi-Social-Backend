import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { conversationInclude, serializeConversation } from '@/lib/chat';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

async function membershipFor(id: string, userId: string) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId } },
    select: { id: true, muted: true },
  });
  return membership;
}

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const membership = await membershipFor(id, session.userId);
  if (!membership) return fail('No autorizado', 403);

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: conversationInclude,
  });
  if (!conversation) return fail('Conversación no encontrada', 404);

  return ok(serializeConversation(conversation, session.userId));
});

const patchSchema = z.object({
  muted: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

export const PATCH = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const membership = await membershipFor(id, session.userId);
  if (!membership) return fail('No autorizado', 403);

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  await prisma.conversationMember.update({
    where: { id: membership.id },
    data: { muted: body.data.muted ?? undefined },
  });
  if (body.data.title !== undefined) {
    await prisma.conversation.update({
      where: { id },
      data: { title: body.data.title },
    });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: conversationInclude,
  });
  if (!conversation) return fail('Conversación no encontrada', 404);
  return ok(serializeConversation(conversation, session.userId));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const membership = await membershipFor(id, session.userId);
  if (!membership) return fail('No autorizado', 403);

  await prisma.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { id: membership.id } });
    const remaining = await tx.conversationMember.count({ where: { conversationId: id } });
    if (remaining === 0) {
      await tx.conversation.delete({ where: { id } });
    }
  });

  return ok({ success: true });
});
