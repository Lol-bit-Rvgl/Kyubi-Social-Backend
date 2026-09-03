import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { canAccessPost } from '@/lib/posts';
import { roleSlotInclude, serializeRoleSlot } from '@/lib/role-slots';

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    requirements: z.string().trim().max(1000).nullable().optional(),
    isOpen: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debes enviar al menos un campo a actualizar',
  });

/**
 * GET /posts/slots/[slotId]
 *
 * Devuelve una vacante de rol con su personaje/usuario asignado. Solo accesible
 * si el usuario autenticado puede ver la publicación asociada.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ slotId: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { slotId } = await params;

    const slot = await prisma.roleSlot.findUnique({
      where: { id: slotId },
      include: roleSlotInclude,
    });
    if (!slot) return fail('Vacante no encontrada', 404);

    const access = await canAccessPost(slot.postId, session.userId);
    if (access === null) return fail('Publicación no encontrada', 404);
    if (access === false) return fail('No tienes acceso a esta publicación', 403);

    return ok(serializeRoleSlot(slot));
  }
);

/**
 * PATCH /posts/slots/[slotId]
 *
 * Actualiza título/descripción/requisitos/estado. Solo el autor de la
 * publicación.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ slotId: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { slotId } = await params;

    const slot = await prisma.roleSlot.findUnique({
      where: { id: slotId },
      select: { postId: true },
    });
    if (!slot) return fail('Vacante no encontrada', 404);

    const post = await prisma.post.findUnique({
      where: { id: slot.postId },
      select: { authorId: true },
    });
    if (!post) return fail('Publicación no encontrada', 404);
    if (post.authorId !== session.userId) return fail('Solo el autor puede editar la vacante', 403);

    const body = updateSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Datos inválidos', 400);

    const updated = await prisma.roleSlot.update({
      where: { id: slotId },
      data: body.data,
      include: roleSlotInclude,
    });

    return ok(serializeRoleSlot(updated));
  }
);

/**
 * DELETE /posts/slots/[slotId]
 *
 * Elimina la vacante de rol. Solo el autor de la publicación.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ slotId: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { slotId } = await params;

    const slot = await prisma.roleSlot.findUnique({
      where: { id: slotId },
      select: { postId: true },
    });
    if (!slot) return fail('Vacante no encontrada', 404);

    const post = await prisma.post.findUnique({
      where: { id: slot.postId },
      select: { authorId: true },
    });
    if (!post) return fail('Publicación no encontrada', 404);
    if (post.authorId !== session.userId) return fail('Solo el autor puede eliminar la vacante', 403);

    await prisma.roleSlot.delete({ where: { id: slotId } });
    return ok({ deleted: true, slotId });
  }
);
