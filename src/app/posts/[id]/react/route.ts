import { ReactionType } from '@prisma/client';
import { z } from 'zod';
import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import { emptyReactionCounts, normalizeReactionKey, reactionKey } from '@/lib/serialize';

const schema = z.object({
  emoji: z.string().max(10).optional(),
  type: z.string().max(10).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const body = schema.safeParse(await request.json().catch(() => null));
  const reactionType = body.success
    ? normalizeReactionKey(body.data.type ?? body.data.emoji ?? 'like')
    : ('like' as const);
  const prismaType = reactionType.toUpperCase();

  const existing = await prisma.reaction.findUnique({
    where: { postId_userId: { postId: id, userId: session.userId } },
    select: { id: true },
  });

  let added: boolean;
  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
    added = false;
  } else {
    await prisma.reaction.create({
      data: { postId: id, userId: session.userId, type: reactionType.toUpperCase() as ReactionType },
    });
    added = true;
  }

  if (added && access.authorId !== session.userId) {
    await notify({
      userId: access.authorId,
      actorId: session.userId,
      type: 'REACTION',
      target: { type: 'POST', id },
    });
  }

  const rows = await prisma.reaction.findMany({ where: { postId: id }, select: { type: true } });
  const counts = emptyReactionCounts();
  for (const r of rows) {
    counts[reactionKey(r.type)] += 1;
  }

  return ok({ added, reactionCounts: counts });
});
