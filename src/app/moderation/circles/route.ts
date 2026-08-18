import { Prisma } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, serializeCircle } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const q = (url.searchParams.get('q') ?? '').trim();

  const where: Prisma.CircleWhereInput = {
    ...(q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  };

  const circles = await prisma.circle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: circleInclude,
  });

  return ok({
    data: circles.map((c) => serializeCircle(c, { myUserId: auth.userId, role: null })),
    total: await prisma.circle.count({ where }),
  });
});
