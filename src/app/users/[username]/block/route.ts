import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

const schema = z.object({ reason: z.string().max(300).optional() });

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;
  const target = username === 'me' ? null : await findUserByIdOrUsername(username);
  if (!target) return fail('Usuario no encontrado', 404);
  const body = schema.safeParse(await request.json().catch(() => null));
  const reason = body.success ? body.data.reason : undefined;

  await prisma.follow.deleteMany({
    where: { OR: [{ followerId: session.userId, followingId: target.id }, { followerId: target.id, followingId: session.userId }] },
  });
  return ok({ success: true, blockedUserId: target.id, reason: reason ?? null });
});
