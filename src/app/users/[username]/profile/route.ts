import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;
  if (username === 'me') {
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      include: { _count: { select: { followers: true, following: true, posts: true } } },
    });
    if (!me) return fail('Usuario no encontrado', 404);
    const meId = me.id;
    const isFollowing = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: session.userId, followingId: meId } },
      select: { id: true },
    });
    return ok(serializeUser(me, { isMe: true, isFollowing: !!isFollowing }));
  }
  const user = await findUserByIdOrUsername(username);
  if (!user) return fail('Usuario no encontrado', 404);
  const isFollowing = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: session.userId, followingId: user.id } },
    select: { id: true },
  });
  return ok(serializeUser(user, { isFollowing: !!isFollowing }));
});
