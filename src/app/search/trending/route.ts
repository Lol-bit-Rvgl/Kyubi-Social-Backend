import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

/**
 * GET /search/trending
 *
 * Tags y palabras clave más activas en las últimas 48 horas, agregadas con
 * SQL (unnest + count) sobre los posts recientes.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('limit') ?? 15);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 30) : 15;

  const rows = await prisma.$queryRawUnsafe<{ tag: string; uses: number }[]>(
    `SELECT t.tag, COUNT(*)::int AS uses
     FROM "Post" p, unnest(p."tags") AS t(tag)
     WHERE p."createdAt" >= NOW() - INTERVAL '48 hours'
     GROUP BY t.tag
     ORDER BY uses DESC, t.tag ASC
     LIMIT $1`,
    limit,
  );

  const trends = rows.map((r) => ({
    tag: r.tag,
    uses: Number(r.uses),
  }));

  return ok({ data: trends, trends, trending: trends });
});

