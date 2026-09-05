import { requireStaffRole } from '@/lib/admin';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      isSuspended: true,
      suspendedUntil: true,
      isProfileHidden: true,
      level: true,
      createdAt: true,
      titles: {
        select: { id: true, titleText: true, colorHex: true, displayOrder: true },
        orderBy: { displayOrder: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  return ok({
    data: users,
    total: await prisma.user.count({ where }),
    page,
    limit,
  });
});
