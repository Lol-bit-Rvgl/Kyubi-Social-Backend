import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  availability: z.object({
    status: z.string().optional(),
    message: z.string().nullable().optional(),
    minutes: z.number().int().min(0).max(10080).nullable().optional(),
  }),
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Disponibilidad inválida');
  const availability = (body.data.availability ?? {}) as Prisma.InputJsonValue;
  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { availability },
    select: { id: true, availability: true },
  });
  return ok({ id: user.id, availability: user.availability });
});
