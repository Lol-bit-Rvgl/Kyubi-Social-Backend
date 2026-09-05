import { requireStaffRole } from '@/lib/admin';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [pendingReports, activeSanctions, pinnedPosts, actionsToday, recent] =
    await Promise.all([
      // Reportes pendientes de revisión.
      prisma.report.count({
        where: { status: { in: ['OPEN', 'REVIEWING'] } },
      }),

      // Usuarios actualmente sancionados (suspendidos + mutes/bans activos).
      Promise.all([
        prisma.user.count({ where: { isSuspended: true } }),
        prisma.ban.count({
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        }),
        prisma.mute.count({
          where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        }),
      ]).then(([susp, bans, mutes]) => susp + bans + mutes),

      prisma.post.count({ where: { isPinned: true } }),
      prisma.moderationLog.count({ where: { createdAt: { gte: todayStart } } }),

      prisma.moderationLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          moderator: {
            select: { id: true, username: true, avatarUrl: true },
          },
        },
      }),
    ]);

  return ok({
    data: {
      pendingReports,
      activeSanctions,
      pinnedPosts,
      pinnedLimit: 3,
      actionsToday,
      recent,
    },
  });
});
