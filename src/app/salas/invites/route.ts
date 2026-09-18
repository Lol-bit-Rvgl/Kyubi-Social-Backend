import { RoomStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { roomInclude, serializeRoom } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session?.userId) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));

  const invitedRooms = await prisma.room.findMany({
    where: {
      status: RoomStatus.ACTIVE,
      participants: {
        some: {
          userId: session.userId,
          role: 'INVITED',
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      ...roomInclude,
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
    },
  });

  return ok({
    data: (invitedRooms ?? []).map((room) =>
      serializeRoom(room, {
        myUserId: session.userId,
        isParticipant: false,
        fullParticipants: room.participants,
      })
    ),
    total: invitedRooms.length,
  });
});
