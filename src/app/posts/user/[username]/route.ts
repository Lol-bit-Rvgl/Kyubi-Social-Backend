import { PostVisibility } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { reactionKey, serializePost } from '@/lib/serialize';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;

  const target = username === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(username);
  if (!target) return fail('Usuario no encontrado', 404);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const cursor = url.searchParams.get('cursor');

  const isMe = target.id === session.userId;
  let isStaff = false;
  if (!isMe) {
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { role: true },
    });
    isStaff = me?.role === 'MODERATOR' || me?.role === 'ADMIN' || me?.role === 'OWNER';
  }
  const canSeeHidden = isMe || isStaff;

  const follows = isMe ? null : await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: session.userId, followingId: target.id } },
    select: { id: true },
  });
  const canSeePrivate = isMe || !!follows;

  const where = {
    authorId: target.id,
    ...(canSeeHidden ? {} : { isHidden: false }),
    // Control estricto de visibilidad:
    // - El propio autor ve TODO su muro (PUBLIC, FOLLOWERS, PRIVATE, CIRCLE).
    // - Sus seguidores ven PUBLIC + FOLLOWERS.
    // - Un tercero solo ve PUBLIC (PRIVATE nunca se filtra a terceros).
    ...(isMe
      ? {}
      : canSeePrivate
        ? { visibility: { in: [PostVisibility.PUBLIC, PostVisibility.FOLLOWERS] } }
        : { visibility: PostVisibility.PUBLIC }),
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
