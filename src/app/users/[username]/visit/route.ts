import { requireSession } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return ok({ success: false, message: 'No autorizado' }, 401);
  const { username } = await params;
  const target = username === 'me' ? null : await findUserByIdOrUsername(username);
  if (!target) return ok({ success: false, message: 'Usuario no encontrado' }, 404);

  if (target.id !== session.userId) {
    const existing = await prisma.profileVisit.findUnique({
      where: { visitorId_visitedId: { visitorId: session.userId, visitedId: target.id } },
      select: { visitedAt: true },
    });
    const now = new Date();
    const recent = existing && now.getTime() - existing.visitedAt.getTime() < 60 * 60 * 1000;
    if (!recent) {
      await prisma.profileVisit.upsert({
        where: { visitorId_visitedId: { visitorId: session.userId, visitedId: target.id } },
        create: { visitorId: session.userId, visitedId: target.id },
        update: { visitedAt: now },
      });
    }
  }
  return ok({ success: true });
});
