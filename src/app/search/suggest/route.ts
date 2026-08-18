import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20;

  const followed = await prisma.follow.findMany({
    where: { followerId: session.userId },
    select: { followingId: true },
  });
  const followedIds = new Set(followed.map((f) => f.followingId));
  followedIds.add(session.userId);

  const users = await prisma.user.findMany({
    where: { id: { notIn: [...followedIds] } },
    orderBy: [{ followers: { _count: 'desc' } }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      usernameColor: true,
      avatarFrame: true,
      level: true,
      isOnline: true,
    },
  });

  const items = users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    usernameColor: user.usernameColor,
    avatarFrame: user.avatarFrame,
    level: user.level ?? 1,
    isOnline: user.isOnline ?? false,
    isFollowing: false,
  }));

  return ok({ data: items, suggestions: items, results: items, query: '' });
});
