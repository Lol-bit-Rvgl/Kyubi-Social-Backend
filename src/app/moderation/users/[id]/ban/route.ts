import { z } from 'zod';
import { requireAdmin, hasRoleAtLeast } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createBan, revokeBan, banInclude, serializeBan } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

const banSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  durationMs: z.number().int().min(60000).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return fail('Usuario no encontrado', 404);

  if (hasRoleAtLeast(target.role, 'ADMIN') && !hasRoleAtLeast(auth.role, 'OWNER')) {
    return fail('No puedes banear a un usuario con rol igual o superior', 403);
  }

  const body = banSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos', 400);

  const expiresAt = body.data.durationMs ? new Date(Date.now() + body.data.durationMs) : null;

  const ban = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return createBan(tx, { userId: id, moderatorId: auth.userId, reason: body.data.reason ?? null, expiresAt });
  });

  const full = await prisma.ban.findUnique({ where: { id: ban.id }, include: banInclude });
  return ok(serializeBan(full!), 201);
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return fail('Usuario no encontrado', 404);

  const body = banSchema.partial().safeParse(await request.json().catch(() => null));

  const revoked = await prisma.$transaction(async (tx) => {
    return revokeBan(tx, { userId: id, moderatorId: auth.userId, reason: body.data?.reason ?? null });
  });

  if (!revoked) return fail('El usuario no tiene un ban activo', 404);
  return ok({ success: true });
});
