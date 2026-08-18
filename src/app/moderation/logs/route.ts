import { Prisma, ModerationAction, ModerationTargetType } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { ok, withErrorHandling } from '@/lib/http';
import { moderationLogInclude, serializeModerationLog } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));
  const action = url.searchParams.get('action');
  const targetType = url.searchParams.get('targetType');
  const moderatorId = url.searchParams.get('moderatorId');

  const where: Prisma.ModerationLogWhereInput = {
    ...(action ? { action: action as ModerationAction } : {}),
    ...(targetType ? { targetType: targetType as ModerationTargetType } : {}),
    ...(moderatorId ? { moderatorId } : {}),
  };

  const logs = await prisma.moderationLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: moderationLogInclude,
  });

  return ok({
    data: logs.map((l) => serializeModerationLog(l)),
    total: await prisma.moderationLog.count({ where }),
  });
});
