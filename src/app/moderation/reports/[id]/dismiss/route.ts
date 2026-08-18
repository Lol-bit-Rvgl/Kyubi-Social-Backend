import { z } from 'zod';
import { ReportStatus } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction, reportDetailInclude, serializeReportDetail } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  resolutionNote: z.string().trim().max(2000).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!report) return fail('Reporte no encontrado', 404);
  if (report.status === 'RESOLVED' || report.status === 'DISMISSED') {
    return fail('El reporte ya ha sido cerrado', 409);
  }

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos', 400);

  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.report.update({
      where: { id },
      data: {
        status: ReportStatus.DISMISSED,
        handledById: auth.userId,
        resolvedAt: new Date(),
        resolutionNote: body.data.resolutionNote ?? null,
      },
      include: reportDetailInclude,
    });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'DISMISS_REPORT',
      targetType: 'REPORT',
      targetId: id,
      reason: body.data.resolutionNote ?? null,
      metadata: { reportStatus: 'DISMISSED' },
    });
    return r;
  });

  return ok(serializeReportDetail(updated));
});
