import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const schema = z.object({
  snapshot: z.record(z.unknown()),
  postId: z.string().nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Borrador inválido');

  const existing = await prisma.draft.findFirst({
    where: { userId: session.userId, ...(body.data.postId ? { postId: body.data.postId } : {}) },
    orderBy: { updatedAt: 'desc' },
  });

  const draft = existing
    ? await prisma.draft.update({
        where: { id: existing.id },
        data: { snapshot: body.data.snapshot as Prisma.InputJsonValue, postId: body.data.postId ?? null },
      })
    : await prisma.draft.create({
        data: { userId: session.userId, snapshot: body.data.snapshot as Prisma.InputJsonValue, postId: body.data.postId ?? null },
      });

  return ok({ success: true, draftId: draft.id });
});
