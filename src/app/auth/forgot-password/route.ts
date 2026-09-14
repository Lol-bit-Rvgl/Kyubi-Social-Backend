import { z } from 'zod';
import { clientIp } from '@/lib/auth';
import { withErrorHandling, fail, ok } from '@/lib/http';
import { createRateLimiter } from '@/lib/rate-limit';
import { sendPasswordResetOtp } from '@/lib/verification';

const input = z.object({ email: z.string().email() });
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return ok({
      success: true,
      message: 'Si el correo está registrado, recibirás un código de recuperación.',
    });
  }

  await sendPasswordResetOtp(body.data.email);
  return ok({
    success: true,
    message: 'Si el correo está registrado, recibirás un código de recuperación.',
  });
});

