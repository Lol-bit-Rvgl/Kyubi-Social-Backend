import { z } from 'zod';
import { NextResponse } from 'next/server';
import { requireStaffRole, assertCanTargetUser, emitUserSanctioned } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { createBan, createMute } from '@/lib/moderation';
import { notifyModerationWarning } from '@/lib/notifications';

const sanctionSchema = z.object({
  action: z.enum(['WARN', 'MUTE', 'SUSPEND', 'BAN', 'SUSPEND_USER', 'BAN_USER']),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
  // Tope de 1 año para evitar duraciones absurdas (p.ej. 10^9 horas).
  durationHours: z.number().int().positive().max(24 * 365).optional(),
  notes: z.string().trim().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: targetUserId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = sanctionSchema.safeParse(body);
  if (!parsed.success) return fail('Datos de sanción inválidos', 400);
  const data = parsed.data;

  // Check if target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return fail('Usuario no encontrado', 404);

  // Jerarquía: no se puede sancionar a alguien de rango igual o superior.
  const targetGuard = assertCanTargetUser(auth.role, targetUser.role);
  if (targetGuard) return targetGuard;

  // Normalizar acción
  const rawAction = data.action;
  const normalizedAction: 'WARN' | 'MUTE' | 'SUSPEND' | 'BAN' =
    rawAction === 'SUSPEND_USER' ? 'SUSPEND' : rawAction === 'BAN_USER' ? 'BAN' : rawAction;

  // Jerarquía de permisos por acción: MODERATOR no puede aplicar BAN ni suspensiones permanentes.
  if (
    auth.role === 'MODERATOR' &&
    (rawAction === 'BAN' ||
      rawAction === 'BAN_USER' ||
      rawAction === 'SUSPEND_USER' ||
      (rawAction === 'SUSPEND' && !data.durationHours))
  ) {
    return NextResponse.json(
      {
        error: 'Permisos insuficientes. Solo administradores y owners pueden aplicar baneos.',
        message: 'Permisos insuficientes. Solo administradores y owners pueden aplicar baneos.',
      },
      { status: 403 }
    );
  }

  const now = new Date();
  let expiresAt: Date | null = null;

  if (data.durationHours && ['MUTE', 'SUSPEND', 'BAN'].includes(normalizedAction)) {
    expiresAt = new Date(now.getTime() + data.durationHours * 60 * 60 * 1000);
  }

  const auditMetadata = {
    ...data.notes ? { adminNotes: data.notes } : {},
    durationHours: data.durationHours ?? null,
    previousRole: targetUser.role,
    targetUserId,
  };

  await prisma.$transaction(async (tx) => {
    switch (normalizedAction) {
      case 'WARN': {
        // Just log the warning
        await tx.moderationLog.create({
          data: {
            moderatorId: auth.userId,
            action: 'WARN',
            targetType: 'USER',
            targetId: targetUserId,
            targetUserId,
            reason: data.reason,
            metadata: auditMetadata,
          },
        });
        break;
      }

      case 'MUTE': {
        // Reusa createMute: revoca mutes activos previos + crea el nuevo + log.
        await createMute(tx, {
          userId: targetUserId,
          moderatorId: auth.userId,
          reason: data.reason,
          expiresAt,
          metadata: auditMetadata,
        });
        break;
      }

      case 'SUSPEND': {
        // Update user suspension
        await tx.user.update({
          where: { id: targetUserId },
          data: {
            isSuspended: true,
            suspendedUntil: expiresAt,
          },
        });
        await tx.moderationLog.create({
          data: {
            moderatorId: auth.userId,
            action: 'SUSPEND_USER',
            targetType: 'USER',
            targetId: targetUserId,
            targetUserId,
            reason: data.reason,
            metadata: { ...auditMetadata, expiresAt: expiresAt?.toISOString() ?? null },
          },
        });
        break;
      }

      case 'BAN': {
        // Reusa createBan: revoca bans activos previos + crea el nuevo + log.
        const ban = await createBan(tx, {
          userId: targetUserId,
          moderatorId: auth.userId,
          reason: data.reason,
          expiresAt,
          metadata: { ...auditMetadata, permanent: !expiresAt },
        });
        // Mark as suspended if permanent ban
        if (!expiresAt) {
          await tx.user.update({
            where: { id: targetUserId },
            data: { isSuspended: true },
          });
        }
        void ban;
        break;
      }
    }
  });

  // Emitir SOLO tras commit exitoso: si la tx falla, no se notifica una
  // sanción que no existe.
  emitUserSanctioned(targetUserId, {
    action: normalizedAction,
    reason: data.reason,
    expiresAt,
    moderatorId: auth.userId,
  });

  // Notificación en el centro de notificaciones del usuario sancionado.
  // Para WARN se crea MODERATION_WARNING; el resto se cubre con user:sanctioned.
  if (normalizedAction === 'WARN') {
    await notifyModerationWarning({
      userId: targetUserId,
      reason: data.reason,
      target: { type: 'USER', id: targetUserId },
    });
  }

  return ok({ success: true, action: normalizedAction, targetUserId });
});
