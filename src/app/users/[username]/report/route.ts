import { z } from 'zod';
import { ReportStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'VIOLENCE', 'ADULT_CONTENT', 'SPOILERS', 'IMPERSONATION', 'COPYRIGHT', 'SELF_HARM', 'OTHER'] as const;

const schema = z.object({
  reason: z.enum(REASONS).default('OTHER'),
  details: z.string().trim().max(2000).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { username } = await params;
  const target = username === 'me' ? null : await findUserByIdOrUsername(username);
  if (!target) return fail('Usuario no encontrado', 404);

  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Datos inválidos');

  const existing = await prisma.report.findFirst({
    where: { reporterId: session.userId, targetType: 'USER', targetId: target.id, status: { in: [ReportStatus.OPEN, ReportStatus.REVIEWING] } },
  });
  if (existing) return fail('Ya reportaste a este usuario y el reporte sigue abierto', 409);

  await prisma.report.create({
    data: {
      reporterId: session.userId,
      reason: body.data.reason,
      details: body.data.details ?? null,
      targetType: 'USER',
      targetId: target.id,
    },
  });

  return ok({ success: true, reportedUserId: target.id, reason: body.data.reason }, 201);
});
