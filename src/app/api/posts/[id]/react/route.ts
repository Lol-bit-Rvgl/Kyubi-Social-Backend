import { z } from 'zod';
import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';

const input = z.object({ type: z.enum(['LIKE', 'LOVE', 'LAUGH', 'WOW', 'SAD', 'ANGRY']).default('LIKE') });

const reactionLabels: Record<string, string> = {
  LIKE: 'le ha dado like',
  LOVE: 'ama',
  LAUGH: 'se ríe de',
  WOW: 'se asombra con',
  SAD: 'se entristece por',
  ANGRY: 'se enoja con',
};

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados y silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = input.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return fail('Reacción inválida');

  const { id } = await params;
  const post = await canAccessPost(id, session.userId);
  if (post === null) return fail('Publicación no encontrada', 404);
  if (post === false) return fail('No tienes acceso a esta publicación', 403);

  const reaction = await prisma.reaction.upsert({
    where: { postId_userId: { postId: id, userId: session.userId } },
    create: { postId: id, userId: session.userId, type: body.data.type },
    update: { type: body.data.type },
  });

  // Emit notification to post author
  const postAuthor = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
  if (postAuthor && postAuthor.authorId !== session.userId) {
    const label = reactionLabels[body.data.type] ?? 'reacciona a';
    await notify({
      userId: postAuthor.authorId,
      actorId: session.userId,
      type: 'REACTION',
      target: { type: 'POST', id },
      text: `${label} tu publicación`,
    });
  }

  return ok(reaction);
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { id } = await params;
  const post = await canAccessPost(id, session.userId);
  if (post === null) return fail('Publicación no encontrada', 404);
  if (post === false) return fail('No tienes acceso a esta publicación', 403);

  await prisma.reaction.deleteMany({ where: { postId: id, userId: session.userId } });
  return ok({ success: true });
});
