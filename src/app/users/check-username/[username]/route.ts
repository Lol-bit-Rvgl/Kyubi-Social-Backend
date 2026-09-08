import { clientIp } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { createRateLimiter } from '@/lib/rate-limit';

// Endpoint PÚBLICO a propósito: comprobar si un nombre de usuario está
// disponible es información no sensible (los perfiles son públicos y
// /auth/register ya devuelve 409 si el nombre existe). Se usa ANTES de
// iniciar sesión durante el registro. Las demás rutas siguen protegidas.
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 60 });

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  if (!(await limiter(clientIp(request)))) return fail('Demasiadas peticiones', 429);
  const { username } = await params;
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return ok({
    available: !existing,
    username,
    message: existing ? 'Este nombre de usuario no está disponible' : null,
  });
});
