import { FollowRequestStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  let action: string;
  try {
    const body = await request.json();
    action = body?.action;
  } catch {
    return fail('Cuerpo de petición inválido', 400);
  }
  if (action !== 'accept' && action !== 'reject') {
    return fail('Acción inválida. Usa accept o reject', 400);
  }

  const req = await prisma.followRequest.findUnique({ where: { id } });
  if (!req || req.targetId !== session.userId) {
    return fail('Solicitud no encontrada', 404);
  }
  if (req.status !== FollowRequestStatus.PENDING) {
    return fail('La solicitud ya fue respondida', 409);
  }

  if (action === 'accept') {
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: req.requesterId, followingId: session.userId } },
      create: { followerId: req.requesterId, followingId: session.userId },
      update: {},
    });
    await prisma.followRequest.update({
      where: { id },
      data: { status: FollowRequestStatus.ACCEPTED, respondedAt: new Date() },
    });
    await notify({
      userId: req.requesterId,
      actorId: session.userId,
      type: 'FOLLOW',
      target: { type: 'USER', id: session.userId },
    });
  } else {
    await prisma.followRequest.update({
      where: { id },
      data: { status: FollowRequestStatus.REJECTED, respondedAt: new Date() },
    });
  }

  const followersCount = await prisma.follow.count({ where: { followingId: session.userId } });
  return ok({
    accepted: action === 'accept',
    status: action === 'accept' ? FollowRequestStatus.ACCEPTED : FollowRequestStatus.REJECTED,
    followersCount,
  });
});
