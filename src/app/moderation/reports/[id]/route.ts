import { requireModerator } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { reportDetailInclude, serializeReportDetail } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id }, include: reportDetailInclude });
  if (!report) return fail('Reporte no encontrado', 404);

  return ok(serializeReportDetail(report));
});
