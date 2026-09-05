import { z } from 'zod';
import { requireStaffRole, assertCanTargetUser, writeModerationLog } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const visibilitySchema = z.object({
  isHidden: z.boolean(),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
});

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: targetUserId } = await context.params;
  const body = await request.json();
  const data = visibilitySchema.parse(body);

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return fail('Usuario no encontrado', 404);

  const targetGuard = assertCanTargetUser(auth.role, targetUser.role);
  if (targetGuard) return targetGuard;

  await prisma.user.update({
    where: { id: targetUserId },
    data: { isProfileHidden: data.isHidden },
  });

  await writeModerationLog(prisma, {
    moderatorId: auth.userId,
    action: data.isHidden ? 'HIDE_PROFILE' : 'UNHIDE_PROFILE',
    targetType: 'USER',
    targetId: targetUserId,
    targetUserId,
    reason: data.reason,
    metadata: { isHidden: data.isHidden },
  });

  return ok({ success: true, isHidden: data.isHidden });
});
