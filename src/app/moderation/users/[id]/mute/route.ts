import { z } from 'zod';
import { requireModerator, hasRoleAtLeast } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createMute, revokeMute, muteInclude, serializeMute } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

const muteSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  durationMs: z.number().int().min(60000).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return fail('Usuario no encontrado', 404);

  if (hasRoleAtLeast(target.role, 'ADMIN') && !hasRoleAtLeast(auth.role, 'ADMIN')) {
    return fail('No puedes silenciar a un usuario con rol igual o superior', 403);
  }

  const body = muteSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos', 400);

  const expiresAt = body.data.durationMs ? new Date(Date.now() + body.data.durationMs) : null;

  const mute = await prisma.$transaction(async (tx) => {
    return createMute(tx, { userId: id, moderatorId: auth.userId, reason: body.data.reason ?? null, expiresAt });
  });

  const full = await prisma.mute.findUnique({ where: { id: mute.id }, include: muteInclude });
  return ok(serializeMute(full!), 201);
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return fail('Usuario no encontrado', 404);

  const body = muteSchema.partial().safeParse(await request.json().catch(() => null));

  const revoked = await prisma.$transaction(async (tx) => {
    return revokeMute(tx, { userId: id, moderatorId: auth.userId, reason: body.data?.reason ?? null });
  });

  if (!revoked) return fail('El usuario no tiene un silenciamiento activo', 404);
  return ok({ success: true });
});
