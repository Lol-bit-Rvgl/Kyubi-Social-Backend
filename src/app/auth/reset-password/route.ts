import { z } from 'zod';
import { clientIp } from '@/lib/auth';
import { withErrorHandling, fail, ok } from '@/lib/http';
import { createRateLimiter } from '@/lib/rate-limit';
import { resetPasswordWithOtpOrToken } from '@/lib/verification';

const input = z
  .object({
    email: z.string().email().optional(),
    code: z.string().min(6).max(6).optional(),
    token: z.string().min(1).optional(),
    newPassword: z.string().min(8).max(128).optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .refine((data) => Boolean(data.code || data.token), {
    message: 'Se requiere código de 6 dígitos o token de recuperación',
  })
  .refine((data) => Boolean(data.newPassword || data.password), {
    message: 'Se requiere una contraseña válida (mínimo 8 caracteres)',
  });

const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const issue = body.error.issues[0]?.message ?? 'Datos de restablecimiento inválidos';
    return fail(issue, 400);
  }

  const newPassword = body.data.newPassword ?? body.data.password!;
  const result = await resetPasswordWithOtpOrToken({
    email: body.data.email,
    code: body.data.code,
    token: body.data.token,
    newPassword,
  });

  if (!result.success) {
    return fail(result.error ?? 'Código o token inválido o expirado', 400);
  }

  return ok({
    success: true,
    message: 'Contraseña actualizada correctamente',
  });
});

