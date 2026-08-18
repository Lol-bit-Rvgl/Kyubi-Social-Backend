import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, hostId: true, status: true },
  });
  if (!room) return fail('Sala no encontrada', 404);

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true, role: true },
  });
  if (!participant) return ok({ success: true, alreadyLeft: true });

  await prisma.$transaction(async (tx) => {
    await tx.roomParticipant.delete({ where: { id: participant.id } });
    if (room.hostId === session.userId) {
      await tx.room.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } });
      await tx.roomParticipant.deleteMany({ where: { roomId: id } });
    }
  });

  return ok({
    success: true,
    ended: room.hostId === session.userId,
    status: room.hostId === session.userId ? 'ENDED' : room.status,
  });
});
