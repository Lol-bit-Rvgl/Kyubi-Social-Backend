import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { meSelect, serializeMe } from '@/lib/me';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: meSelect });
  return user ? ok(serializeMe(user)) : fail('Usuario no encontrado', 404);
});
