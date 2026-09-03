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

  const existing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: session.userId, followingId: id } },
    select: { id: true },
  });
  if (existing) {
    return ok({ isFollowing: true, pendingFollow: false });
  }

  await prisma.followRequest.upsert({
    where: { requesterId_targetId: { requesterId: session.userId, targetId: id } },
    create: { requesterId: session.userId, targetId: id, status: FollowRequestStatus.PENDING },
    update: { status: FollowRequestStatus.PENDING, respondedAt: null },
  });

  const followersCount = await prisma.follow.count({ where: { followingId: id } });
  const followingCount = await prisma.follow.count({ where: { followerId: session.userId } });
  return ok({ isFollowing: false, pendingFollow: true, followersCount, followingCount });
});
