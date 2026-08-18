import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, serializeCircle } from '@/lib/social';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { circleId } = await params;

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, isPrivate: true },
  });
  if (!circle) return fail('Círculo no encontrado', 404);

  const existing = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId: session.userId } },
    select: { role: true },
  });
  if (existing) {
    const current = await prisma.circle.findUnique({
      where: { id: circleId },
      include: circleInclude,
    });
    if (!current) return fail('Círculo no encontrado', 404);
    return ok(serializeCircle(current, { myUserId: session.userId, role: existing.role }));
  }

  if (circle.isPrivate) return fail('No puedes unirte a un círculo privado sin invitación', 403);

  await prisma.circleMember.create({
    data: { circleId, userId: session.userId, role: 'MEMBER' },
  });

  const updated = await prisma.circle.findUnique({
    where: { id: circleId },
    include: circleInclude,
  });
  if (!updated) return fail('Círculo no encontrado', 404);
  return ok(serializeCircle(updated, { myUserId: session.userId, role: 'MEMBER' }));
});
