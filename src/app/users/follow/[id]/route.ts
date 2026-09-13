import { FollowRequestStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  if (id === session.userId) return fail('No puedes seguirte a ti mismo');

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return fail('Usuario no encontrado', 404);

  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: session.userId, followingId: id } },
    create: { followerId: session.userId, followingId: id },
    update: {},
  });

  await prisma.followRequest.deleteMany({
    where: { requesterId: session.userId, targetId: id },
  }).catch(() => {});

  const followersCount = await prisma.follow.count({ where: { followingId: id } });
  const followingCount = await prisma.follow.count({ where: { followerId: session.userId } });
  return ok({ isFollowing: true, pendingFollow: false, followersCount, followingCount });
});
