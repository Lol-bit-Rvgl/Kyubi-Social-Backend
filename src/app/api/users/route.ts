import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async () => {
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      take: 20,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        gender: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.user.count(),
  ]);

  return ok({
    data: users,
    total,
  });
});
