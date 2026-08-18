import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const publicUserSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { username } = await params;
  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) return fail('Usuario no encontrado', 404);

  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20;
  const cursor = searchParams.get('cursor');

  const rows = await prisma.follow.findMany({
    where: { followerId: target.id },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    select: { id: true, following: { select: publicUserSelect } },
  });

  const nextCursor = rows.length > limit ? rows.pop()!.id : null;
  return ok({ items: rows.map((r) => r.following), nextCursor });
});
