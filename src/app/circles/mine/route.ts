import { Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, memberRoles, serializeCircle } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const q = (url.searchParams.get('q') ?? '').trim();

  const where: Prisma.CircleWhereInput = {
    OR: [
      { creatorId: session.userId },
      { members: { some: { userId: session.userId } } },
    ],
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const circles = await prisma.circle.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: circleInclude,
  });

  const roles = await memberRoles(prisma, circles.map((c) => c.id), session.userId);

  return ok({
    data: circles.map((circle) =>
      serializeCircle(circle, {
        myUserId: session.userId,
        role: roles.get(circle.id) ?? (circle.creatorId === session.userId ? 'OWNER' : 'MEMBER'),
      })
    ),
    total: await prisma.circle.count({ where }),
  });
});
