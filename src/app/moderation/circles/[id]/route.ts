import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';
import { serializeCircle, serializeCircleMember } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const circle = await prisma.circle.findUnique({
    where: { id },
    include: {
      creator: true,
      members: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 24 },
      _count: { select: { members: true, posts: true, rooms: true } },
    },
  });
  if (!circle) return fail('Círculo no encontrado', 404);

  return ok({
    ...serializeCircle(circle, { myUserId: auth.userId, role: null }),
    members: circle.members.map(serializeCircleMember),
  });
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const circle = await prisma.circle.findUnique({ where: { id }, select: { id: true, creatorId: true, name: true } });
  if (!circle) return fail('Círculo no encontrado', 404);

  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason : null;

  await prisma.$transaction(async (tx) => {
    await tx.circle.delete({ where: { id } });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'DELETE_CIRCLE',
      targetType: 'CIRCLE',
      targetId: id,
      reason,
      metadata: { creatorId: circle.creatorId, name: circle.name },
    });
  });

  return ok({ success: true });
});
