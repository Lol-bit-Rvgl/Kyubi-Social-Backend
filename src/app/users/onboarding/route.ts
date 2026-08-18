import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { meSelect, serializeMe } from '@/lib/me';

const schema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/).optional(),
  displayName: z.string().min(1).max(80).optional(),
  gender: z.string().nullable().optional(),
  interests: z.array(z.string()).optional(),
  onboardingCompleted: z.literal(true).optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos de onboarding inválidos');
  const data: Record<string, unknown> = { ...body.data };
  if (data.username) {
    const existing = await prisma.user.findUnique({
      where: { username: String(data.username) },
      select: { id: true },
    });
    if (existing && existing.id !== session.userId) {
      return fail('Este nombre de usuario no está disponible', 409);
    }
  }
  const user = await prisma.user.update({
    where: { id: session.userId },
    data,
    select: meSelect,
  });
  return ok(serializeMe(user));
});
