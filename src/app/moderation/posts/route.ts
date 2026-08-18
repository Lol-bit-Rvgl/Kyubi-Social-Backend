import { Prisma } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { serializePost } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const q = (url.searchParams.get('q') ?? '').trim();
  const authorId = url.searchParams.get('authorId');

  const where: Prisma.PostWhereInput = {
    ...(q ? { content: { contains: q, mode: 'insensitive' as const } } : {}),
    ...(authorId ? { authorId } : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: postFullInclude,
  });

  return ok({
    data: posts.map((p) => serializePost(p, { myReactionKey: null })),
    total: await prisma.post.count({ where }),
  });
});
