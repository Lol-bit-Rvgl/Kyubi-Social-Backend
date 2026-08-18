import { z } from 'zod';
import { clientIp } from '@/lib/auth';
import { withErrorHandling, fail, ok } from '@/lib/http';
import { createRateLimiter } from '@/lib/rate-limit';
import { verifyEmail } from '@/lib/verification';

const input = z.object({ token: z.string().min(1) });
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 20 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!limiter(clientIp(request))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Token de verificación inválido', 400);

  const verified = await verifyEmail(body.data.token);
  return verified ? ok({ success: true }) : fail('Token inválido o expirado', 400);
});
