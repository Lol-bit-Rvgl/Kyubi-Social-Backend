import { z } from 'zod';
import { clientIp } from '@/lib/auth';
import { withErrorHandling, fail, ok } from '@/lib/http';
import { createRateLimiter } from '@/lib/rate-limit';
import { resetPassword } from '@/lib/verification';

const input = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!limiter(clientIp(request))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Token o contraseña inválidos', 400);

  const reset = await resetPassword(body.data.token, body.data.password);
  return reset ? ok({ success: true }) : fail('Token inválido o expirado', 400);
});
