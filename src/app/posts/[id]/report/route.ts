import { z } from 'zod';
import { ReportStatus } from '@prisma/client';
import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'VIOLENCE', 'ADULT_CONTENT', 'SPOILERS', 'IMPERSONATION', 'COPYRIGHT', 'SELF_HARM', 'OTHER'] as const;

const schema = z.object({
  reason: z.enum(REASONS).default('OTHER'),
  details: z.string().trim().max(2000).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;

  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  const existing = await prisma.report.findFirst({
    where: { reporterId: session.userId, targetType: 'POST', targetId: id, status: { in: [ReportStatus.OPEN, ReportStatus.REVIEWING] } },
  });
  if (existing) return fail('Ya reportaste esta publicación y el reporte sigue abierto', 409);

  await prisma.report.create({
    data: {
      reporterId: session.userId,
      reason: body.data.reason,
      details: body.data.details ?? null,
      targetType: 'POST',
      targetId: id,
    },
  });

  return ok({ success: true, reportedPostId: id, reason: body.data.reason }, 201);
});
