import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

/**
 * POST /posts/[id]/bookmark
 *
 * Alterna el guardado (bookmark) de una publicación para el usuario
 * autenticado. Devuelve el nuevo estado (`saved`).
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const access = await canAccessPost(id, session.userId);
    if (access === null) return fail('Publicación no encontrada', 404);
    if (access === false) return fail('No tienes acceso a esta publicación', 403);

    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: session.userId, postId: id } },
      select: { id: true },
    });

    let saved: boolean;
    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } });
      saved = false;
    } else {
      await prisma.bookmark.create({
        data: { userId: session.userId, postId: id },
      });
      saved = true;
    }

    return ok({ saved, postId: id });
  }
);

/**
 * GET /posts/[id]/bookmark
 *
 * Devuelve si la publicación está guardada por el usuario autenticado.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const access = await canAccessPost(id, session.userId);
    if (access === null) return fail('Publicación no encontrada', 404);
    if (access === false) return fail('No tienes acceso a esta publicación', 403);

    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: session.userId, postId: id } },
      select: { id: true },
    });

    return ok({ saved: !!existing, postId: id });
  }
);
