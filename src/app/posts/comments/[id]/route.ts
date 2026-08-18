import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const comment = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
  if (!comment) return fail('Comentario no encontrado', 404);
  if (comment.userId !== session.userId) return fail('No autorizado', 403);
  await prisma.comment.delete({ where: { id } });
  return ok({ success: true });
});
