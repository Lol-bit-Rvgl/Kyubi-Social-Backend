import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { userId } = await params;
  const target = userId === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(userId);
  if (!target) return fail('Usuario no encontrado', 404);
  return ok({ subscribed: false });
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { userId } = await params;
  const target = userId === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(userId);
  if (!target) return fail('Usuario no encontrado', 404);
  return ok({ subscribed: false });
});
