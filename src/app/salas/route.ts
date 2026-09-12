import { Prisma, RoomStatus } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { roomInclude, serializeRoom } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const circleId = url.searchParams.get('circleId');
  const q = (url.searchParams.get('q') ?? '').trim();

  const myCircleMemberships = circleId
    ? await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId, userId: session.userId } },
        select: { id: true },
      })
    : null;

  const myRooms = await prisma.roomParticipant.findMany({
    where: { userId: session.userId },
    select: { roomId: true },
  });
  const myRoomIds = new Set(myRooms.map((r) => r.roomId));

  const where: Prisma.RoomWhereInput = {
    status: RoomStatus.ACTIVE,
    ...(circleId ? { circleId } : {}),
    AND: [
      ...(q
        ? [{ OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }]
        : []),
      // Exploración general (sin círculo): solo salas públicas o privadas del
      // propio usuario (participante/host). Las salas privadas de terceros NO
      // aparecen en "Rooms"/"Recomendadas".
      circleId
        ? myCircleMemberships
          ? {}
          : { access: 'PUBLIC' }
        : {
            OR: [
              { access: 'PUBLIC' },
              { participants: { some: { userId: session.userId } } },
            ],
          },
    ],
  };

  const rooms = await prisma.room.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: roomInclude,
  });

  return ok({
    data: rooms.map((room) =>
      serializeRoom(room, { myUserId: session.userId, isParticipant: myRoomIds.has(room.id) })
    ),
    total: await prisma.room.count({ where }),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).optional(),
  imageUrl: z.string().nullable().optional(),
  capacity: z.number().int().min(2).max(500).nullable().optional(),
  access: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  circleId: z.string().nullable().optional(),
  rules: z.array(z.string().trim().min(1).max(140)).max(10).optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Sala inválida', 400);

  if (body.data.circleId) {
    const circle = await prisma.circle.findUnique({
      where: { id: body.data.circleId },
      select: { id: true, isPrivate: true },
    });
    if (!circle) return fail('Círculo no encontrado', 404);
    const membership = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: circle.id, userId: session.userId } },
      select: { id: true },
    });
    if (!membership) return fail('Debes ser miembro del círculo para abrir una sala en él', 403);
    if (body.data.access === 'PRIVATE' && !circle.isPrivate && !body.data.circleId) {
      return fail('Las salas privadas requieren un círculo', 400);
    }
  } else if (body.data.access === 'PRIVATE') {
    return fail('Las salas privadas deben pertenecer a un círculo', 400);
  }

  const room = await prisma.$transaction(async (tx) => {
    const created = await tx.room.create({
      data: {
        name: body.data.name,
        description: body.data.description ?? null,
        imageUrl: body.data.imageUrl ?? null,
        capacity: body.data.capacity ?? null,
        access: body.data.access ?? 'PUBLIC',
        circleId: body.data.circleId ?? null,
        rules: body.data.rules ?? [],
        hostId: session.userId,
        participants: { create: { userId: session.userId, role: 'HOST' } },
      },
      include: roomInclude,
    });
    return created;
  });

  return ok(serializeRoom(room, { myUserId: session.userId, isParticipant: true }), 201);
});
