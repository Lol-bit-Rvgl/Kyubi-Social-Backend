import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { meSelect, serializeMe } from '@/lib/me';

const schema = z.object({
  interests: z.array(z.string().min(1).max(40)).min(1).max(50),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Intereses inválidos');
  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { interests: body.data.interests, onboardingCompleted: true },
    select: meSelect,
  });
  return ok(serializeMe(user));
});
