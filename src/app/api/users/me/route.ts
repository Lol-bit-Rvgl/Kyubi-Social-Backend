import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const editable = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  onboardingCompleted: z.boolean().optional(),
});

const meSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  emailVerifiedAt: true,
  onboardingCompleted: true,
  createdAt: true,
} as const;

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: meSelect });
  return user ? ok(user) : fail('Usuario no encontrado', 404);
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = editable.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Perfil inválido');
  return ok(
    await prisma.user.update({
      where: { id: session.userId },
      data: body.data,
      select: meSelect,
    })
  );
});
