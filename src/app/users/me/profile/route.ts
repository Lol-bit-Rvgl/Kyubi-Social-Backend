import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { meSelect, serializeMe } from '@/lib/me';
import { prisma } from '@/lib/prisma';

const profile = z.object({
  displayName: z.string().min(1).max(30).optional(),
  bio: z.string().max(300).nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  usernameColor: z.string().nullable().optional(),
  avatarFrame: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  showGender: z.boolean().optional(),
  socialLinks: z.record(z.unknown()).optional(),
  voiceBioUrl: z.string().nullable().optional(),
});

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: meSelect });
  return user ? ok(serializeMe(user)) : fail('Usuario no encontrado', 404);
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = profile.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Perfil inválido');
  const data = { ...body.data } as Prisma.UserUpdateInput;
  delete (data as { socialLinks?: unknown }).socialLinks;
  const user = await prisma.user.update({
    where: { id: session.userId },
    data,
    select: meSelect,
  });
  return ok(serializeMe(user));
});
