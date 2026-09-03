import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { canAccessPost } from '@/lib/posts';
import { roleSlotInclude, serializeRoleSlot } from '@/lib/role-slots';

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  requirements: z.string().trim().max(1000).optional().nullable(),
  isOpen: z.boolean().optional().default(true),
});

/**
 * GET /posts/[id]/slots
 *
 * Lista las vacantes de rol de una publicación (solo si el usuario puede
 * verla). Devuelve `{ slots, total }`.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const access = await canAccessPost(id, session.userId);
    if (access === null) return fail('Publicación no encontrada', 404);
    if (access === false) return fail('No tienes acceso a esta publicación', 403);

    const slots = await prisma.roleSlot.findMany({
      where: { postId: id },
      orderBy: { createdAt: 'asc' },
      include: roleSlotInclude,
    });

    return ok({ slots: slots.map(serializeRoleSlot), total: slots.length });
  }
);

/**
 * POST /posts/[id]/slots
 *
 * Crea una vacante de rol. Solo el autor de la publicación puede añadir
 * vacantes.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
    if (!post) return fail('Publicación no encontrada', 404);
    if (post.authorId !== session.userId) return fail('Solo el autor puede crear vacantes', 403);

    const body = createSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Datos inválidos', 400);

    const slot = await prisma.roleSlot.create({
      data: {
        postId: id,
        title: body.data.title,
        description: body.data.description ?? null,
        requirements: body.data.requirements ?? null,
        isOpen: body.data.isOpen ?? true,
      },
      include: roleSlotInclude,
    });

    return ok(serializeRoleSlot(slot), 201);
  }
);
