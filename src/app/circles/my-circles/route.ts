import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, serializeCircle } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));

  const memberships = await prisma.circleMember.findMany({
    where: { userId: session.userId },
    orderBy: { joinedAt: 'desc' },
    take: limit,
    select: { circleId: true, role: true },
  });

  const circles = await prisma.circle.findMany({
    where: { id: { in: memberships.map((m) => m.circleId) } },
    include: circleInclude,
  });

  const byId = new Map(memberships.map((m) => [m.circleId, m.role]));

  return ok({
    data: circles.map((circle) => serializeCircle(circle, { myUserId: session.userId, role: byId.get(circle.id) ?? null })),
    total: circles.length,
  });
});
