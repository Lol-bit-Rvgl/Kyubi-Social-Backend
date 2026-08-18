import { Prisma } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const q = (url.searchParams.get('q') ?? '').trim();
  const role = url.searchParams.get('role');

  const where: Prisma.UserWhereInput = {
    ...(q
      ? { OR: [{ username: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }, { displayName: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
    ...(role ? { role: role as Prisma.UserWhereInput['role'] } : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      role: true,
      isOnline: true,
      createdAt: true,
      _count: { select: { followers: true, following: true, posts: true } },
    },
  });

  return ok({
    data: users.map((u) => serializeUser(u, { isMe: false })),
    total: await prisma.user.count({ where }),
  });
});
