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
    where: { followerId: target.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      createdAt: true,
      following: {
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
    const isFollowing = row.following.id === session.userId
      ? false
      : !!(await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: session.userId, followingId: row.following.id } },
          select: { id: true },
        }));
    items.push({
      id: row.following.id,
      username: row.following.username,
      displayName: row.following.displayName ?? row.following.username,
      avatarUrl: row.following.avatarUrl,
      bio: row.following.bio,
      usernameColor: row.following.usernameColor,
      avatarFrame: row.following.avatarFrame,
      level: row.following.level ?? 1,
      isOnline: row.following.isOnline ?? false,
      isFollowing,
      followedAt: row.createdAt.toISOString(),
    });
  }
  return ok(items);
});
