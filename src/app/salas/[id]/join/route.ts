import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeRoom } from '@/lib/social';

async function roomDetail(roomId: string) {
  return prisma.room.findUnique({
    where: { id: roomId },
    include: {
      host: true,
      circle: { select: { id: true, name: true, avatarUrl: true } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
      _count: { select: { participants: true } },
    },
  });
}

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({
    where: { id },
    select: { id: true, status: true, access: true, capacity: true, circleId: true },
  });
  if (!room) return fail('Sala no encontrada', 404);
  if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

  const existing = await prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId: id, userId: session.userId } },
    select: { id: true },
  });
  if (existing) {
    const current = await roomDetail(id);
    if (!current) return fail('Sala no encontrada', 404);
    return ok(serializeRoom(current, { myUserId: session.userId, isParticipant: true, fullParticipants: current.participants }));
  }

  if (room.access === 'PRIVATE') {
    if (room.circleId) {
      const membership = await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId: room.circleId, userId: session.userId } },
        select: { id: true },
      });
      if (!membership) return fail('Solo los miembros del círculo pueden entrar a esta sala', 403);
    } else {
      return fail('No tienes acceso a esta sala', 403);
    }
  }

  if (room.capacity != null) {
    const current = await prisma.roomParticipant.count({ where: { roomId: id } });
    if (current >= room.capacity) return fail('La sala está llena', 400);
  }

  await prisma.roomParticipant.create({
    data: { roomId: id, userId: session.userId, role: 'PARTICIPANT' },
  });

  const updated = await roomDetail(id);
  if (!updated) return fail('Sala no encontrada', 404);
  return ok(serializeRoom(updated, { myUserId: session.userId, isParticipant: true, fullParticipants: updated.participants }));
});
