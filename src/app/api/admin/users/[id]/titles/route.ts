import { z } from 'zod';
import { requireStaffRole, assertCanTargetUser, writeModerationLog } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const titleSchema = z.object({
  titleText: z.string().trim().min(1).max(80),
  colorHex: z.string().regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, 'Color HEX inválido'),
  displayOrder: z.number().int().min(0).default(0),
});

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: targetUserId } = await context.params;
  const body = await request.json();
  const data = titleSchema.parse(body);

  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return fail('Usuario no encontrado', 404);

  const targetGuard = assertCanTargetUser(auth.role, targetUser.role);
  if (targetGuard) return targetGuard;

  const title = await prisma.userTitle.create({
    data: {
      userId: targetUserId,
      titleText: data.titleText,
      colorHex: data.colorHex.toUpperCase(),
      displayOrder: data.displayOrder,
    },
  });

  await writeModerationLog(prisma, {
    moderatorId: auth.userId,
    action: 'ASSIGN_TITLE',
    targetType: 'USER',
    targetId: targetUserId,
    targetUserId,
    metadata: {
      titleId: title.id,
      titleText: data.titleText,
      colorHex: data.colorHex,
      displayOrder: data.displayOrder,
    },
  });

  return ok({ success: true, title }, 201);
});
