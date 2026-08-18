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
    select: { id: true },
  });
  if (!circle) return fail('Círculo no encontrado', 404);

  const existing = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId: session.userId } },
    select: { role: true },
  });
  if (!existing) {
    const current = await prisma.circle.findUnique({
      where: { id: circleId },
      include: circleInclude,
    });
    if (!current) return fail('Círculo no encontrado', 404);
    return ok(serializeCircle(current, { myUserId: session.userId, role: null }));
  }

  if (existing.role === 'OWNER') {
    return fail('El creador no puede salir del círculo; puedes transferirlo o eliminarlo', 400);
  }

  await prisma.circleMember.delete({
    where: { circleId_userId: { circleId, userId: session.userId } },
  });

  const updated = await prisma.circle.findUnique({
    where: { id: circleId },
    include: circleInclude,
  });
  if (!updated) return fail('Círculo no encontrado', 404);
  return ok(serializeCircle(updated, { myUserId: session.userId, role: null }));
});
