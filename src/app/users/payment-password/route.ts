import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
  // Requerido si el usuario ya tiene un PIN configurado (ver `currentPinRequired`).
  currentPin: z.string().optional(),
});

const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  if (!limiter(`set-pin:${session.userId}`)) {
    return fail('Demasiados intentos, inténtalo más tarde', 429);
  }
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('PIN inválido (4-6 dígitos)');

  const existing = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { paymentPasswordHash: true },
  });

  // Si ya hay un PIN configurado, exigir el PIN actual antes de permitir cambiarlo
  // (evita que un access token robado fije un PIN propio).
  const currentPinRequired =
    existing?.paymentPasswordHash != null && !body.data.currentPin;
  if (currentPinRequired) return fail('Se requiere el PIN actual para cambiarlo', 400);

  if (existing?.paymentPasswordHash != null) {
    const currentValid = await bcrypt.compare(
      body.data.currentPin!,
      existing.paymentPasswordHash,
    );
    if (!currentValid) return fail('PIN actual incorrecto', 401);
  }

  const hash = await bcrypt.hash(body.data.pin, 12);
  await prisma.user.update({
    where: { id: session.userId },
    data: { paymentPasswordHash: hash, hasPaymentPassword: true },
  });
  return ok({ success: true });
});
