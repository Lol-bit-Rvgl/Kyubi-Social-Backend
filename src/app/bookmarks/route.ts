import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { reactionKey, serializePost } from '@/lib/serialize';

/**
 * GET /bookmarks
 *
 * Devuelve las publicaciones guardadas por el usuario autenticado,
 * ordenadas de más reciente a más antigua. Soporta paginación por cursor.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const cursor = url.searchParams.get('cursor');

  const bookmarks = await prisma.bookmark.findMany({
    where: {
      userId: session.userId,
      post: {
        OR: [
          { isHidden: false },
          { authorId: session.userId },
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: cursor } } : {}),
    select: {
      id: true,
      createdAt: true,
      post: { include: postFullInclude },
    },
  });

  const hasMore = bookmarks.length > limit;
  const pageBookmarks = bookmarks.slice(0, limit);
  const nextCursor = hasMore && pageBookmarks.length > 0 ? pageBookmarks[pageBookmarks.length - 1].id : null;

  const postIds = pageBookmarks
    .map((b) => b.post.id)
    .filter((postId): postId is string => postId != null);

  const myReactions = await prisma.reaction.findMany({
    where: { userId: session.userId, postId: { in: postIds } },
    select: { postId: true, type: true },
  });
  const myReactionMap = new Map(myReactions.map((r) => [r.postId, r.type]));

  const posts = pageBookmarks
    .filter((b) => b.post != null)
    .map((b) =>
      serializePost(b.post!, {
        myReactionKey: myReactionMap.has(b.post!.id)
          ? reactionKey(myReactionMap.get(b.post!.id)!)
          : null,
      })
    );

  return ok({
    posts,
    savedAt: Object.fromEntries(
      pageBookmarks.filter((b) => b.post != null).map((b) => [b.post!.id, b.createdAt.toISOString()])
    ),
    nextCursor,
    total: postIds.length,
  });
});
