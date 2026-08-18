import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeCircle, serializeCircleMember } from '@/lib/social';

async function membershipFor(circleId: string, userId: string) {
  return prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    select: { role: true },
  });
}

async function getCircleOrFail(circleId: string) {
  return prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      creator: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 24 },
      _count: { select: { members: true, posts: true, rooms: true } },
    },
  });
}

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { circleId } = await params;

  const circle = await getCircleOrFail(circleId);
  if (!circle) return fail('Círculo no encontrado', 404);

  const membership = await membershipFor(circleId, session.userId);
  if (circle.isPrivate && !membership) return fail('Este círculo es privado', 403);

  return ok({
    ...serializeCircle(circle, { myUserId: session.userId, role: membership?.role ?? null }),
    members: circle.members.map(serializeCircleMember),
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(600).nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
});

export const PATCH = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { circleId } = await params;

  const membership = await membershipFor(circleId, session.userId);
  if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) return fail('No tienes permisos para editar este círculo', 403);

  const body = patchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Círculo inválido', 400);

  const circle = await prisma.circle.update({
    where: { id: circleId },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description } : {}),
      ...(body.data.avatarUrl !== undefined ? { avatarUrl: body.data.avatarUrl } : {}),
      ...(body.data.bannerUrl !== undefined ? { bannerUrl: body.data.bannerUrl } : {}),
      ...(body.data.isPrivate !== undefined ? { isPrivate: body.data.isPrivate } : {}),
    },
    include: {
      creator: true,
      _count: { select: { members: true, posts: true, rooms: true } },
    },
  });

  return ok(serializeCircle(circle, { myUserId: session.userId, role: membership.role }));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { circleId } = await params;

  const membership = await membershipFor(circleId, session.userId);
  if (!membership || membership.role !== 'OWNER') return fail('Solo el creador puede eliminar el círculo', 403);

  await prisma.circle.delete({ where: { id: circleId } });
  return ok({ success: true });
});
