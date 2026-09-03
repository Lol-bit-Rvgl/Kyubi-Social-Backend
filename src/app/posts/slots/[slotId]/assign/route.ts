import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { roleSlotInclude, serializeRoleSlot } from '@/lib/role-slots';

const assignSchema = z.object({
  assignedUserId: z.string().min(1).optional(),
  assignedCharacterId: z.string().min(1).optional().nullable(),
});

/**
 * POST /posts/slots/[slotId]/assign
 *
 * Asigna un intérprete a una vacante abierta.
 *  - Si el solicitante es el autor de la publicación puede asignar a cualquier
 *    usuario (y oc opcional).
 *  - Si no, el solicitante solo puede reclamar la vacante para sí mismo.
 * Al asignar, la vacante pasa a `isOpen = false`. Devuelve 409 si ya está
 * asignada.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ slotId: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { slotId } = await params;

    const slot = await prisma.roleSlot.findUnique({
      where: { id: slotId },
      select: { id: true, postId: true, isOpen: true, assignedUserId: true },
    });
    if (!slot) return fail('Vacante no encontrada', 404);

    const post = await prisma.post.findUnique({
      where: { id: slot.postId },
      select: { authorId: true },
    });
    if (!post) return fail('Publicación no encontrada', 404);

    if (slot.assignedUserId) return fail('La vacante ya está asignada', 409);

    const isAuthor = post.authorId === session.userId;
    let targetUserId = session.userId;
    let assignedCharacterId: string | null = null;

    if (isAuthor) {
      const body = assignSchema.safeParse(await request.json().catch(() => null));
      if (!body.success) return fail('Datos inválidos', 400);
      targetUserId = body.data.assignedUserId || session.userId;
      assignedCharacterId = body.data.assignedCharacterId ?? null;
    } else {
      const raw = await request.json().catch(() => null);
      const body = assignSchema.safeParse(raw);
      if (body.success && body.data.assignedCharacterId) {
        assignedCharacterId = body.data.assignedCharacterId;
      }
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
    if (!targetUser) return fail('Usuario no encontrado', 404);

    if (assignedCharacterId) {
      const chr = await prisma.character.findUnique({
        where: { id: assignedCharacterId },
        select: { id: true, userId: true },
      });
      if (!chr) return fail('Personaje no encontrado', 404);
      if (chr.userId !== targetUserId) return fail('El personaje no pertenece a ese usuario', 400);
    }

    const updated = await prisma.roleSlot.update({
      where: { id: slot.id },
      data: {
        assignedUserId: targetUserId,
        assignedCharacterId,
        isOpen: false,
        updatedAt: new Date(),
      },
      include: roleSlotInclude,
    });

    return ok(serializeRoleSlot(updated));
  }
);

/**
 * DELETE /posts/slots/[slotId]/assign
 *
 * Libera la vacante: la deja asignable de nuevo (isOpen = true) y limpia el
 * intérprete. El autor puede liberarla siempre; un usuario no-autor solo puede
 * liberar su propio reclamación.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ slotId: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { slotId } = await params;

    const slot = await prisma.roleSlot.findUnique({
      where: { id: slotId },
      select: { id: true, postId: true, assignedUserId: true },
    });
    if (!slot) return fail('Vacante no encontrada', 404);

    const post = await prisma.post.findUnique({
      where: { id: slot.postId },
      select: { authorId: true },
    });

    const isAuthor = post?.authorId === session.userId;
    if (!isAuthor && slot.assignedUserId !== session.userId) {
      return fail('No tienes permiso para liberar esta vacante', 403);
    }

    const updated = await prisma.roleSlot.update({
      where: { id: slot.id },
      data: {
        assignedUserId: null,
        assignedCharacterId: null,
        isOpen: true,
        updatedAt: new Date(),
      },
      include: roleSlotInclude,
    });

    return ok(serializeRoleSlot(updated));
  }
);
