import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const MANAGEABLE_ROLES = new Set([
  'HOST',
  'CO_HOST',
  'ADMIN',
  'OWNER',
  'CO_ADMIN',
  'COADMIN',
  'MODERATOR',
]);

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

const editSchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
});

export const PATCH = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId, messageId } = await params;

    const message = await prisma.roomMessage.findUnique({
      where: { id: messageId },
      include: { sender: true },
    });
    if (!message || message.roomId !== roomId) {
      return fail('Mensaje no encontrado', 404);
    }

    if (message.senderId !== session.userId) {
      return fail('Solo el autor puede editar su mensaje', 403);
    }

    const messageAgeMs = Date.now() - new Date(message.createdAt).getTime();
    const MAX_EDIT_TIME_MS = 15 * 60 * 1000;
    if (messageAgeMs > MAX_EDIT_TIME_MS) {
      return fail('Solo puedes editar mensajes dentro de los primeros 15 minutos.', 400);
    }

    const ext = (message.extensions as Record<string, any>) || {};
    if (ext.isEdited || (ext.editCount && Number(ext.editCount) > 0)) {
      return fail('El mensaje ya ha sido editado previamente', 400);
    }

    const body = editSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Contenido inválido', 400);

    const newContent = body.data.content || body.data.body;
    if (!newContent) {
      return fail('El contenido no puede estar vacío', 400);
    }

    const now = new Date().toISOString();
    const updatedExtensions = {
      ...ext,
      isEdited: true,
      editedAt: now,
      editCount: (Number(ext.editCount) || 0) + 1,
    };

    const updated = await prisma.roomMessage.update({
      where: { id: messageId },
      data: {
        body: newContent,
        extensions: updatedExtensions as Prisma.InputJsonValue,
      },
      include: { sender: true },
    });

    emitToSala(roomId, 'room:message_updated', {
      messageId,
      roomId,
      content: newContent,
      body: newContent,
      isEdited: true,
      editedAt: now,
    });

    return ok({
      id: updated.id,
      roomId: updated.roomId,
      senderId: updated.senderId,
      body: updated.body,
      content: updated.body,
      isEdited: true,
      editedAt: now,
      editCount: 1,
      extensions: updatedExtensions,
      createdAt: updated.createdAt.toISOString(),
    });
  }
);

export const DELETE = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId, messageId } = await params;

    const message = await prisma.roomMessage.findUnique({
      where: { id: messageId },
      select: { id: true, roomId: true, senderId: true },
    });
    if (!message || message.roomId !== roomId) {
      return fail('Mensaje no encontrado', 404);
    }

    const isAuthor = message.senderId === session.userId;
    const canManage = await canManageRoom(roomId, session.userId);

    if (!isAuthor && !canManage) {
      return fail('No tienes permiso para eliminar este mensaje', 403);
    }

    await prisma.roomMessage.delete({
      where: { id: messageId },
    });

    emitToSala(roomId, 'room:message_deleted', {
      messageId,
      roomId,
    });

    return ok({ success: true, messageId, deletedMessageId: messageId });
  }
);
