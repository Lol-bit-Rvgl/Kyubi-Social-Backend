import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const schema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('PIN inválido (4-6 dígitos)');
  const hash = await bcrypt.hash(body.data.pin, 10);
  await prisma.user.update({
    where: { id: session.userId },
    data: { paymentPasswordHash: hash, hasPaymentPassword: true },
  });
  return ok({ success: true });
});
