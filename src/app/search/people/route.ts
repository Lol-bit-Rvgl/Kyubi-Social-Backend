import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const requested = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20;

  if (q.length < 2) {
    return ok({ data: [], query: q, total: 0 });
  }

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { username: 'asc' },
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

  const items = [];
  for (const user of rows) {
    const me = user.id === session.userId;
    const isFollowing = me
      ? false
      : !!(await prisma.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: session.userId,
              followingId: user.id,
            },
          },
          select: { id: true },
        }));
    items.push({
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      usernameColor: user.usernameColor,
      avatarFrame: user.avatarFrame,
      level: user.level ?? 1,
      isOnline: user.isOnline ?? false,
      isFollowing,
    });
  }

  return ok({ data: items, query: q, total: items.length });
});
