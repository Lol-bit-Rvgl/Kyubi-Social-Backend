import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';
import { serializeRoom } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    include: {
      host: true,
      circle: { select: { id: true, name: true, avatarUrl: true } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
      _count: { select: { participants: true } },
    },
  });
  if (!room) return fail('Sala no encontrada', 404);

  return ok(serializeRoom(room, { myUserId: auth.userId, isParticipant: false, fullParticipants: room.participants }));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const room = await prisma.room.findUnique({ where: { id }, select: { id: true, hostId: true, name: true } });
  if (!room) return fail('Sala no encontrada', 404);

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason : null;

  await prisma.$transaction(async (tx) => {
    await tx.room.delete({ where: { id } });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'DELETE_SALA',
      targetType: 'ROOM',
      targetId: id,
      reason,
      metadata: { hostId: room.hostId, name: room.name },
    });
  });

  return ok({ success: true });
});
