import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;
  const target = username === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(username);
  if (!target) return fail('Usuario no encontrado', 404);

  const rows = await prisma.profileVisit.findMany({
    where: { visitedId: target.id },
    orderBy: { visitedAt: 'desc' },
    take: 100,
    select: {
      visitedAt: true,
      visitor: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          usernameColor: true,
          avatarFrame: true,
          level: true,
          isOnline: true,
        },
      },
    },
  });

  return ok(rows.map((row) => ({
    id: row.visitor.id,
    username: row.visitor.username,
    displayName: row.visitor.displayName ?? row.visitor.username,
    avatarUrl: row.visitor.avatarUrl,
    usernameColor: row.visitor.usernameColor,
    avatarFrame: row.visitor.avatarFrame,
    level: row.visitor.level ?? 1,
    isOnline: row.visitor.isOnline ?? false,
    visitedAt: row.visitedAt.toISOString(),
  })));
});
