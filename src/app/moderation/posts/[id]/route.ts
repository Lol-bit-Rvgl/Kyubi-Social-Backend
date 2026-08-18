import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction } from '@/lib/moderation';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { serializePost } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id }, include: postFullInclude });
  if (!post) return fail('Publicación no encontrada', 404);

  return ok(serializePost(post, { myReactionKey: null }));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true } });
  if (!post) return fail('Publicación no encontrada', 404);

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason : null;

  await prisma.$transaction(async (tx) => {
    await tx.post.delete({ where: { id } });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'DELETE_POST',
      targetType: 'POST',
      targetId: id,
      reason,
      metadata: { authorId: post.authorId },
    });
  });

  return ok({ success: true });
});
