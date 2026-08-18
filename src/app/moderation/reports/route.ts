import { Prisma, ReportStatus, ReportTargetType } from '@prisma/client';
import { requireModerator } from '@/lib/authz';
import { ok, withErrorHandling } from '@/lib/http';
import { reportDetailInclude, serializeReportDetail } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireModerator(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const status = url.searchParams.get('status');
  const targetType = url.searchParams.get('targetType');

  const where: Prisma.ReportWhereInput = {
    ...(status ? { status: status as ReportStatus } : {}),
    ...(targetType ? { targetType: targetType as ReportTargetType } : {}),
  };

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: reportDetailInclude,
  });

  return ok({
    data: reports.map((r) => serializeReportDetail(r)),
    total: await prisma.report.count({ where }),
  });
});
