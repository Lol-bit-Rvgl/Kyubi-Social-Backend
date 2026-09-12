import { PostVisibility, Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { reactionKey, serializePost } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const cursor = url.searchParams.get('cursor');
  const category = url.searchParams.get('category') ?? 'para_ti';
  const followingOnly = url.searchParams.get('followingOnly') === 'true';

  const myFollowing = await prisma.follow.findMany({
    where: { followerId: session.userId },
    select: { followingId: true },
  });
  const followingIds = myFollowing.map((f) => f.followingId);

  const where: Prisma.PostWhereInput = {
    isHidden: false,
    visibility: PostVisibility.PUBLIC,
    ...(followingOnly || category === 'siguiendo' || category === 'following'
      ? { authorId: { in: followingIds } }
      : category === 'tendencias' || category === 'trending'
        ? { views: { gt: 0 } }
        : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: cursor } } : {}),
    include: postFullInclude,
  });

  const hasMore = posts.length > limit;
  const pagePosts = posts.slice(0, limit);
  const nextCursor = hasMore && pagePosts.length > 0 ? pagePosts[pagePosts.length - 1].id : null;

  const myReactions = await prisma.reaction.findMany({
    where: { userId: session.userId, postId: { in: pagePosts.map((p) => p.id) } },
    select: { postId: true, type: true },
  });
  const myReactionMap = new Map(myReactions.map((r) => [r.postId, r.type]));

  const total = await prisma.post.count({ where });

  return ok({
    posts: pagePosts.map((post) =>
      serializePost(post, {
        myReactionKey: myReactionMap.has(post.id) ? reactionKey(myReactionMap.get(post.id)!) : null,
      })
    ),
    nextCursor,
    total,
    page,
  });
});
