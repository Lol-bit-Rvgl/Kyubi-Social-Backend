import { Prisma, ReportStatus, ReportTargetType } from '@prisma/client';
import { requireStaffRole } from '@/lib/admin';
import { ok, withErrorHandling } from '@/lib/http';
import { moderationActorSelect, reportDetailInclude, serializeReportDetail } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';

const postPreviewSelect = {
  id: true,
  content: true,
  author: { select: { ...moderationActorSelect } },
} satisfies Prisma.PostSelect;

export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const targetType = url.searchParams.get('targetType');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10)));

  const where: Prisma.ReportWhereInput = {
    ...(status ? { status: status as ReportStatus } : {}),
    ...(targetType ? { targetType: targetType as ReportTargetType } : {}),
  };

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      ...reportDetailInclude,
      reportedUser: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, role: true },
      },
    },
  });

  // Resolver el post denunciado (y su autor) para los reportes de tipo POST.
  const postIds = reports
    .filter((r) => r.targetType === 'POST')
    .map((r) => r.targetId);
  const posts = postIds.length
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: postPreviewSelect,
      })
    : [];
  const postById = new Map(posts.map((p) => [p.id, p]));

  return ok({
    data: reports.map((r) =>
      serializeReportDetail(r, r.targetType === 'POST' ? (postById.get(r.targetId) ?? null) : null)
    ),
    total: await prisma.report.count({ where }),
    page,
    limit,
  });
});
