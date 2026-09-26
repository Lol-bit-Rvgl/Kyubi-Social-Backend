import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { messageInclude, serializeMessage } from '@/lib/chat';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToConversation, emitToUser } from '@/lib/socketio';

const editSchema = z.object({
  body: z.string().trim().min(1).max(4000, 'El mensaje no puede superar los 4000 caracteres').optional(),
  content: z.string().trim().min(1).max(4000, 'El mensaje no puede superar los 4000 caracteres').optional(),
});

export const PATCH = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: conversationId, messageId } = await params;

    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: session.userId },
      },
      select: { id: true },
    });
    if (!membership) return fail('No autorizado', 403);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    if (!message || message.conversationId !== conversationId) {
      return fail('Mensaje no encontrado', 404);
    }

    if (message.senderId !== session.userId) {
      return fail('Solo el autor puede editar su mensaje', 403);
    }

    if (message.deletedAt !== null) {
      return fail('No se puede editar un mensaje eliminado', 400);
    }

    const json = await request.json().catch(() => null);
    const parsed = editSchema.safeParse(json);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues?.[0]?.message || 'Contenido inválido';
      return fail(errorMsg, 400);
    }

    const newContent = parsed.data.body || parsed.data.content;
    if (!newContent) {
      return fail('El contenido no puede estar vacío', 400);
    }

    const now = new Date();
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        body: newContent,
        editedAt: now,
      },
      include: messageInclude,
    });

    const serialized = serializeMessage(updated);

    emitToConversation(conversationId, 'message:updated', serialized);
    emitToConversation(conversationId, 'chat:message_updated', serialized);

    const members = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: session.userId } },
      select: { userId: true },
    });
    for (const member of members) {
      emitToUser(member.userId, 'message:updated', serialized);
      emitToUser(member.userId, 'chat:message_updated', serialized);
    }

    return ok(serialized);
  }
);

export const DELETE = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: conversationId, messageId } = await params;

    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: session.userId },
      },
      select: { id: true },
    });
    if (!membership) return fail('No autorizado', 403);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, senderId: true, deletedAt: true },
    });
    if (!message || message.conversationId !== conversationId) {
      return fail('Mensaje no encontrado', 404);
    }

    if (message.senderId !== session.userId) {
      return fail('Solo el autor puede eliminar su mensaje', 403);
    }

    const now = new Date();
    await prisma.message.update({
      where: { id: messageId },
      data: {
        body: 'Mensaje eliminado',
        mediaUrl: null,
        deletedAt: now,
      },
    });

    const payload = {
      messageId,
      conversationId,
      deletedAt: now.toISOString(),
      body: 'Mensaje eliminado',
      isDeleted: true,
    };

    emitToConversation(conversationId, 'message:deleted', payload);
    emitToConversation(conversationId, 'chat:message_deleted', payload);

    const members = await prisma.conversationMember.findMany({
      where: { conversationId, userId: { not: session.userId } },
      select: { userId: true },
    });
    for (const member of members) {
      emitToUser(member.userId, 'message:deleted', payload);
      emitToUser(member.userId, 'chat:message_deleted', payload);
    }

    return ok({ success: true, messageId, deletedAt: now.toISOString() });
  }
);
