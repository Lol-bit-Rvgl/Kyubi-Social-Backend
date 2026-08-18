import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, memberRoles, serializeCircle } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  if (!q) return ok({ data: [], query: '', total: 0 });

  const circles = await prisma.circle.findMany({
    where: {
      isPrivate: false,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }],
    },
    orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: limit,
    include: circleInclude,
  });

  const roles = await memberRoles(prisma, circles.map((c) => c.id), session.userId);

  return ok({
    data: circles.map((circle) => serializeCircle(circle, { myUserId: session.userId, role: roles.get(circle.id) ?? null })),
    query: q,
    total: circles.length,
  });
});
