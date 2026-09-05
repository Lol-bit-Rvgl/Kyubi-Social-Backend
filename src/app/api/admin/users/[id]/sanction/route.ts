import { z } from 'zod';
import { requireStaffRole, assertCanTargetUser, writeModerationLog, emitUserSanctioned } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const sanctionSchema = z.object({
  action: z.enum(['WARN', 'MUTE', 'SUSPEND', 'BAN']),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
  durationHours: z.number().int().positive().optional(),
  notes: z.string().trim().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: targetUserId } = await context.params;
  const body = await request.json();
  const data = sanctionSchema.parse(body);

  // Check if target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return fail('Usuario no encontrado', 404);

  // Jerarquía: no se puede sancionar a alguien de rango igual o superior.
  const targetGuard = assertCanTargetUser(auth.role, targetUser.role);
  if (targetGuard) return targetGuard;

  // Jerarquía de permisos por acción: solo ADMIN+ puede aplicar ban.
  if (data.action === 'BAN' && auth.role === 'MODERATOR') {
    return fail('Se requiere rol ADMIN o superior para aplicar ban', 403);
  }

  const now = new Date();
  let expiresAt: Date | null = null;

  if (data.durationHours && ['MUTE', 'SUSPEND', 'BAN'].includes(data.action)) {
    expiresAt = new Date(now.getTime() + data.durationHours * 60 * 60 * 1000);
  }

  const finalMetadata = {
    ...data.notes ? { adminNotes: data.notes } : {},
    durationHours: data.durationHours,
    previousRole: targetUser.role,
  };

  await prisma.$transaction(async (tx) => {
    switch (data.action) {
      case 'WARN': {
        // Just log the warning
        await writeModerationLog(tx, {
          moderatorId: auth.userId,
          action: 'WARN',
          targetType: 'USER',
          targetId: targetUserId,
          targetUserId,
          reason: data.reason,
          metadata: finalMetadata,
        });
        break;
      }

      case 'MUTE': {
        // Create Mute record
        await tx.mute.create({
          data: {
            userId: targetUserId,
            moderatorId: auth.userId,
            reason: data.reason,
            expiresAt,
          },
        });
        await writeModerationLog(tx, {
          moderatorId: auth.userId,
          action: 'MUTE_USER',
          targetType: 'USER',
          targetId: targetUserId,
          targetUserId,
          reason: data.reason,
          metadata: { ...finalMetadata, expiresAt: expiresAt?.toISOString() },
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
        await writeModerationLog(tx, {
          moderatorId: auth.userId,
          action: 'SUSPEND_USER',
          targetType: 'USER',
          targetId: targetUserId,
          targetUserId,
          reason: data.reason,
          metadata: { ...finalMetadata, expiresAt: expiresAt?.toISOString() },
        });
        break;
      }

      case 'BAN': {
        // Create Ban record
        await tx.ban.create({
          data: {
            userId: targetUserId,
            moderatorId: auth.userId,
            reason: data.reason,
            expiresAt,
          },
        });
        // Mark as suspended if permanent ban
        if (!expiresAt) {
          await tx.user.update({
            where: { id: targetUserId },
            data: { isSuspended: true },
          });
        }
        await writeModerationLog(tx, {
          moderatorId: auth.userId,
          action: 'BAN_USER',
          targetType: 'USER',
          targetId: targetUserId,
          targetUserId,
          reason: data.reason,
          metadata: { ...finalMetadata, expiresAt: expiresAt?.toISOString(), permanent: !expiresAt },
        });
        break;
      }
    }

    // Emit Socket.IO event for real-time notification
    emitUserSanctioned(targetUserId, {
      action: data.action,
      reason: data.reason,
      expiresAt,
      moderatorId: auth.userId,
    });
  });

  return ok({ success: true, action: data.action, targetUserId });
});
