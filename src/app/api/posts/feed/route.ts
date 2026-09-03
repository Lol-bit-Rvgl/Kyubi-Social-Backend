import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20;
  const cursor = searchParams.get('cursor');

  const posts = await prisma.post.findMany({
    where: {
      OR: [
        // Publicaciones públicas de cualquier usuario (feed abierto).
        { visibility: 'PUBLIC' },
        // Posts FOLLOWERS del propio usuario + de usuarios a los que sigue
        // (subconsulta relacional directa, sin materializar follows en memoria).
        {
          visibility: 'FOLLOWERS',
          OR: [
            { authorId: session.userId },
            { author: { followers: { some: { followerId: session.userId } } } },
          ],
        },
        // Posts privados (solo el autor).
        { visibility: 'PRIVATE', authorId: session.userId },
      ],
    },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      _count: { select: { reactions: true } },
      reactions: { where: { userId: session.userId }, select: { type: true } },
    },
  });

  const nextCursor = posts.length > limit ? posts.pop()!.id : null;

  return ok({
    items: posts.map((post) => {
      const { reactions, ...rest } = post;
      return { ...rest, myReaction: reactions[0]?.type ?? null };
    }),
    nextCursor,
  });
});
