import { z } from 'zod';
import { clientIp, requireSession, verifyPassword } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const input = z.object({ password: z.string().min(1).optional() });
// Operación destructiva e irreversible: límite estricto por IP.
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  // Tras autenticar: el límite es por IP y la operación es sensible.
  if (!limiter(clientIp(request))) return fail('Demasiadas peticiones, inténtalo más tarde', 429);

  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) return fail('Datos inválidos', 400);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return fail('Usuario no encontrado', 404);

  // Usuarios con password hash registrado (login con credenciales) deben
  // confirmar su contraseña. Un login social exclusivo (sin hash) puede
  // eliminar la cuenta sin contraseña.
  if (user.passwordHash) {
    if (!parsed.data.password) {
      return fail('Se requiere la contraseña para eliminar la cuenta', 400);
    }
    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) return fail('Contraseña incorrecta', 403);
  }

  // Borrado en cascada: el esquema define onDelete: Cascade en todas las
  // relaciones obligatorias del usuario (tokens de sesión, verificación,
  // device tokens, posts, comentarios, follows, membresías de círculos/salas,
  // conversaciones, notificaciones, etc.). Las FKs opcionales (informes,
  // logs de moderación, role slots) usan SetNull automáticamente.
  await prisma.user.delete({ where: { id: user.id } });

  return ok({ success: true, message: 'Cuenta eliminada correctamente' });
});