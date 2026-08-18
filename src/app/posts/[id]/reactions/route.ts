import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emptyReactionCounts, reactionKey } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const rows = await prisma.reaction.findMany({
    where: { postId: id },
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
  });

  const counts = emptyReactionCounts();
  for (const r of rows) {
    counts[reactionKey(r.type)] += 1;
  }

  const myReaction = rows.find((r) => r.userId === session.userId);
  return ok({
    counts,
    total: rows.length,
    myReaction: myReaction ? reactionKey(myReaction.type) : null,
    reactions: rows.map((r) => ({
      type: reactionKey(r.type),
      user: {
        id: r.user.id,
        username: r.user.username,
        displayName: r.user.displayName ?? r.user.username,
        avatarUrl: r.user.avatarUrl,
      },
    })),
  });
});
