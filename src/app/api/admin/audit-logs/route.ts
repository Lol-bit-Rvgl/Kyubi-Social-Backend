import { Prisma, ModerationAction, ModerationTargetType } from '@prisma/client';
import { requireStaffRole } from '@/lib/admin';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { moderationLogInclude, serializeModerationLog } from '@/lib/moderation';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const moderatorId = url.searchParams.get('moderatorId');
  const targetUserId = url.searchParams.get('targetUserId');
  const targetPostId = url.searchParams.get('targetPostId');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10)));

  const where: Prisma.ModerationLogWhereInput = {
    ...(action ? { action: action as ModerationAction } : {}),
    ...(moderatorId ? { moderatorId } : {}),
    ...(targetUserId ? { targetUserId } : {}),
    ...(targetPostId ? { targetPostId } : {}),
  };

  const logs = await prisma.moderationLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: moderationLogInclude,
  });

  return ok({
    data: logs.map((l) => serializeModerationLog(l)),
    total: await prisma.moderationLog.count({ where }),
    page,
    limit,
  });
});
