import { z } from 'zod';
import { requireStaffRole, writeModerationLog } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const updateReportSchema = z.object({
  status: z.enum(['REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolutionNotes: z.string().trim().max(2000).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: reportId } = await context.params;
  const body = await request.json();
  const data = updateReportSchema.parse(body);

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return fail('Reporte no encontrado', 404);

  const updatedReport = await prisma.report.update({
    where: { id: reportId },
    data: {
      status: data.status,
      resolutionNotes: data.resolutionNotes,
      handledById: auth.userId,
      resolvedAt: data.status === 'RESOLVED' || data.status === 'DISMISSED' ? new Date() : null,
    },
    include: {
      reportedUser: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
      },
    },
  });

  await writeModerationLog(prisma, {
    moderatorId: auth.userId,
    action: data.status === 'RESOLVED' ? 'RESOLVE_REPORT' : 'DISMISS_REPORT',
    targetType: 'REPORT',
    targetId: reportId,
    reason: data.resolutionNotes,
    metadata: {
      previousStatus: report.status,
      newStatus: data.status,
      resolutionNotes: data.resolutionNotes,
    },
  });

  return ok({ success: true, report: updatedReport });
});
