import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeRoom } from '@/lib/social';

async function participantFor(roomId: string, userId: string) {
  return prisma.roomParticipant.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { id: true, role: true },
  });
}

async function getRoomOrFail(roomId: string) {
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

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await getRoomOrFail(id);
  if (!room) return fail('Sala no encontrada', 404);

  const participant = await participantFor(id, session.userId);
  if (room.access === 'PRIVATE' && !participant) {
    if (room.circleId) {
      const membership = await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId: room.circleId, userId: session.userId } },
        select: { id: true },
      });
      if (!membership) return fail('No tienes acceso a esta sala', 403);
    } else {
      return fail('No tienes acceso a esta sala', 403);
    }
  }

  return ok(serializeRoom(room, { myUserId: session.userId, isParticipant: participant != null, fullParticipants: room.participants }));
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  capacity: z.number().int().min(2).max(500).nullable().optional(),
  access: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

export const PATCH = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({ where: { id }, select: { id: true, hostId: true } });
  if (!room) return fail('Sala no encontrada', 404);
  if (room.hostId !== session.userId) return fail('Solo el anfitrión puede modificar la sala', 403);

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Sala inválida', 400);

  if (body.data.access === 'PRIVATE') {
    const full = await prisma.room.findUnique({ where: { id }, select: { circleId: true } });
    if (!full?.circleId) return fail('Las salas privadas deben pertenecer a un círculo', 400);
  }

  const updated = await prisma.room.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description } : {}),
      ...(body.data.imageUrl !== undefined ? { imageUrl: body.data.imageUrl } : {}),
      ...(body.data.capacity !== undefined ? { capacity: body.data.capacity } : {}),
      ...(body.data.access !== undefined ? { access: body.data.access } : {}),
      ...(body.data.status !== undefined
        ? { status: body.data.status, endedAt: body.data.status === 'ENDED' ? new Date() : null }
        : {}),
    },
    include: {
      host: true,
      circle: { select: { id: true, name: true, avatarUrl: true } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
      _count: { select: { participants: true } },
    },
  });

  return ok(serializeRoom(updated, { myUserId: session.userId, isParticipant: updated.hostId === session.userId, fullParticipants: updated.participants }));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const room = await prisma.room.findUnique({ where: { id }, select: { id: true, hostId: true } });
  if (!room) return fail('Sala no encontrada', 404);
  if (room.hostId !== session.userId) return fail('Solo el anfitrión puede cerrar la sala', 403);

  await prisma.room.delete({ where: { id } });
  return ok({ success: true });
});
