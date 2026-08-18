import { Prisma } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { roomInclude, serializeRoom } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const q = (url.searchParams.get('q') ?? '').trim();

  const where: Prisma.RoomWhereInput = {
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  };

  const rooms = await prisma.room.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: roomInclude,
  });

  return ok({
    data: rooms.map((r) => serializeRoom(r, { myUserId: auth.userId, isParticipant: false })),
    total: await prisma.room.count({ where }),
  });
});
