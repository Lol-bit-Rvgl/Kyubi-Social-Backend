import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const drafts = await prisma.draft.findMany({
    where: { userId: session.userId },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(
    drafts.map((d) => ({
      id: d.id,
      snapshot: d.snapshot,
      postId: d.postId,
      updatedAt: d.updatedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    }))
  );
});

export const DELETE = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return fail('Falta el id del borrador');
  const draft = await prisma.draft.findUnique({ where: { id }, select: { userId: true } });
  if (!draft) return fail('Borrador no encontrado', 404);
  if (draft.userId !== session.userId) return fail('No autorizado', 403);
  await prisma.draft.delete({ where: { id } });
  return ok({ success: true });
});
