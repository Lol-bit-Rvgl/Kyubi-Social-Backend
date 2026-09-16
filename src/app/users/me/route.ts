import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { meSelect, serializeMe } from '@/lib/me';
import { prisma } from '@/lib/prisma';
import { optionalSafeHttpUrl } from '@/lib/validation';

// `onboardingCompleted` NO es editable aquí: solo se completa vía
// POST /users/onboarding (server-driven). El cliente no puede forzarlo.
// Los campos URL usan `safeHttpUrl` para bloquear esquemas como
// `javascript:` o `data:` (XSS).
const themeSettingsSchema = z.object({
  primaryColor: z.string(),
  accentColor: z.string().optional(),
  glassStyle: z.enum(['frosted', 'transparent']).optional(),
});

const editable = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(1000).nullable().optional(),
  avatarUrl: optionalSafeHttpUrl,
  bannerUrl: optionalSafeHttpUrl,
  usernameColor: z.string().nullable().optional(),
  themeSettings: themeSettingsSchema.optional(),
  avatarFrame: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  showGender: z.boolean().optional(),
  stickers: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  socialLinks: z.record(z.unknown()).optional(),
  voiceBioUrl: optionalSafeHttpUrl,
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
  const body = editable.safeParse(await request.json().catch(() => null));
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
