import { z } from 'zod';
import { clientIp, revokeRefreshToken } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';

const limiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!limiter(clientIp(request))) return fail('Demasiadas peticiones', 429);
  const body = z.object({ refreshToken: z.string().min(1).optional() }).safeParse(await request.json().catch(() => null));
  if (body.success && body.data.refreshToken) await revokeRefreshToken(body.data.refreshToken);
  return ok({ success: true });
});
