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
  if (!body.success) return fail('PIN inválido');
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { paymentPasswordHash: true },
  });
  if (!user?.paymentPasswordHash) return fail('No se configuró PIN de pago', 404);
  const valid = await bcrypt.compare(body.data.pin, user.paymentPasswordHash);
  if (!valid) return fail('PIN incorrecto', 401);
  return ok({ success: true });
});
