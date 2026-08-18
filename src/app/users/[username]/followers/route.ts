import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;
  const target = username === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(username);
  if (!target) return fail('Usuario no encontrado', 404);

  const rows = await prisma.follow.findMany({
    where: { followingId: target.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      createdAt: true,
      follower: {
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
      },
    },
  });

  const items = [];
  for (const row of rows) {
    const me = row.follower.id === session.userId;
    const isFollowing = me
      ? false
      : !!(await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: session.userId, followingId: row.follower.id } },
          select: { id: true },
        }));
    items.push({
      id: row.follower.id,
      username: row.follower.username,
      displayName: row.follower.displayName ?? row.follower.username,
      avatarUrl: row.follower.avatarUrl,
      bio: row.follower.bio,
      usernameColor: row.follower.usernameColor,
      avatarFrame: row.follower.avatarFrame,
      level: row.follower.level ?? 1,
      isOnline: row.follower.isOnline ?? false,
      isFollowing,
      followedAt: row.createdAt.toISOString(),
    });
  }
  return ok(items);
});
