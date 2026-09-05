import { requireStaffRole } from '@/lib/admin';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all'; // all | hidden | pinned
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

  let where: Prisma.PostWhereInput = {};
  if (filter === 'hidden') {
    where = { isHidden: true };
  } else if (filter === 'pinned') {
    where = { isPinned: true };
  }

  const posts = await prisma.post.findMany({
    where,
    select: {
      id: true,
      content: true,
      title: true,
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      authorId: true,
      isPinned: true,
      pinnedAt: true,
      isHidden: true,
      hiddenReason: true,
      hiddenByUserId: true,
      featuredUntil: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
  });

  // Count pinned posts for banner
  const pinnedCount = await prisma.post.count({ where: { isPinned: true } });

  return ok({
    data: posts,
    total: await prisma.post.count({ where }),
    pinnedCount,
    page,
    limit,
  });
});
