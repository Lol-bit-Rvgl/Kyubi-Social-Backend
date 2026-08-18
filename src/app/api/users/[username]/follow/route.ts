import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { username } = await params;
  if (username.toLowerCase() === session.username.toLowerCase()) return fail('No puedes seguirte a ti mismo', 400);

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) return fail('Usuario no encontrado', 404);

  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: session.userId, followingId: target.id } },
    create: { followerId: session.userId, followingId: target.id },
    update: {},
  });
  return ok({ success: true });
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { username } = await params;
  const target = await prisma.user.findUnique({ where: { username } });
  if (!target) return fail('Usuario no encontrado', 404);

  await prisma.follow.deleteMany({ where: { followerId: session.userId, followingId: target.id } });
  return ok({ success: true });
});
