import { z } from 'zod';
import { requireStaffRole, assertCanTargetUser, writeModerationLog } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const unsanctionSchema = z.object({
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
});

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: targetUserId } = await context.params;
  const body = await request.json();
  const data = unsanctionSchema.parse(body);

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return fail('Usuario no encontrado', 404);

  const targetGuard = assertCanTargetUser(auth.role, targetUser.role);
  if (targetGuard) return targetGuard;

  await prisma.$transaction(async (tx) => {
    // Clear suspension fields
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        isSuspended: false,
        suspendedUntil: null,
      },
    });

    // Revoke active bans
    await tx.ban.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: auth.userId },
    });

    // Revoke active mutes
    await tx.mute.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: auth.userId },
    });

    await writeModerationLog(tx, {
      moderatorId: auth.userId,
      action: 'UNSUSPEND_USER', // Generic un-sanction
      targetType: 'USER',
      targetId: targetUserId,
      targetUserId,
      reason: data.reason,
      metadata: {
        previousStatus: {
          isSuspended: targetUser.isSuspended,
          suspendedUntil: targetUser.suspendedUntil,
        },
      },
    });
  });

  return ok({ success: true, action: 'unsanction', targetUserId });
});
