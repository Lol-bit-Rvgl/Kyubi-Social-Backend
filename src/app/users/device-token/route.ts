import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

/**
 * Registro de tokens FCM por dispositivo.
 * POST   /users/device-token  → asocia (o reemplaza) el token al usuario.
 * DELETE /users/device-token  → elimina el token (logout del dispositivo).
 */

const registerSchema = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: z.enum(['android', 'ios', 'web']).optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const body = registerSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  // Upsert: soporta múltiples dispositivos por usuario (tokens únicos) y
  // reemplazo del mismo token si se re-registra.
  await prisma.deviceToken.upsert({
    where: { token: body.data.token },
    create: {
      token: body.data.token,
      userId: session.userId,
      platform: body.data.platform ?? 'unknown',
    },
    update: { userId: session.userId, platform: body.data.platform ?? 'unknown' },
  });

  return ok({ registered: true });
});

export const DELETE = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const body = registerSchema
    .pick({ token: true })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  await prisma.deviceToken.deleteMany({
    where: { token: body.data.token, userId: session.userId },
  });
  return ok({ deleted: true });
});
