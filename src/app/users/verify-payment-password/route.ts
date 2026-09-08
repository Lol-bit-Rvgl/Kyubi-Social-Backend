import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const schema = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

// El PIN tiene poco espacio de búsqueda (4-6 dígitos): rate limit estricto por
// usuario para mitigar fuerza bruta.
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  if (!(await limiter(`verify-pin:${session.userId}`))) {
    return fail('Demasiados intentos, inténtalo más tarde', 429);
  }
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
