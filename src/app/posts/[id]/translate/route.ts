import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);
  const post = await prisma.post.findUnique({ where: { id }, select: { content: true } });
  return ok({ translatedBody: post?.content ?? '' });
});
