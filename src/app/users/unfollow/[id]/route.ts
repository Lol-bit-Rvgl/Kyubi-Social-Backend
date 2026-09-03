import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  await prisma.follow.deleteMany({
    where: { followerId: session.userId, followingId: id },
  });
  await prisma.followRequest.deleteMany({
    where: { requesterId: session.userId, targetId: id },
  });
  const followersCount = await prisma.follow.count({ where: { followingId: id } });
  const followingCount = await prisma.follow.count({ where: { followerId: session.userId } });
  return ok({ isFollowing: false, pendingFollow: false, followersCount, followingCount });
});
