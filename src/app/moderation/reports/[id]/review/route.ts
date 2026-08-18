import { ReportStatus } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction, reportDetailInclude, serializeReportDetail } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!report) return fail('Reporte no encontrado', 404);
  if (report.status !== 'OPEN') return fail('El reporte ya está siendo revisado o resuelto', 409);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.report.update({
      where: { id },
      data: { status: ReportStatus.REVIEWING, handledById: auth.userId },
      include: reportDetailInclude,
    });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'REVIEW_REPORT',
      targetType: 'REPORT',
      targetId: id,
      reason: null,
      metadata: { reportStatus: 'REVIEWING' },
    });
    return r;
  });

  return ok(serializeReportDetail(updated));
});
