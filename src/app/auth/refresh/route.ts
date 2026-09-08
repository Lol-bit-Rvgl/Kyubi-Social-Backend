import { z } from 'zod';
import { clientIp, cleanupExpiredRefreshTokens, rotateRefreshToken } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';

const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 60 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!(await limiter(clientIp(request)))) return fail('Demasiadas peticiones', 429);

  const body = z.object({ refreshToken: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Refresh token inválido', 401);

  const tokens = await rotateRefreshToken(body.data.refreshToken);
  if (!tokens) return fail('Sesión expirada', 401);

  cleanupExpiredRefreshTokens().catch(() => {});
  return ok(tokens);
});
