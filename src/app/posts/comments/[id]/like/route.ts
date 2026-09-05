import { ReactionType } from '@prisma/client';
import { z } from 'zod';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { normalizeReactionKey, reactionKey } from '@/lib/serialize';

const schema = z.object({
  emoji: z.string().max(10).optional(),
  type: z.string().max(10).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados y silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { id } = await params;

  const comment = await prisma.comment.findUnique({ where: { id }, select: { id: true } });
  if (!comment) return fail('Comentario no encontrado', 404);

  const body = schema.safeParse(await request.json().catch(() => null));
  const key = body.success
    ? normalizeReactionKey(body.data.type ?? body.data.emoji ?? 'like')
    : ('like' as const);

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId: { commentId: id, userId: session.userId } },
    select: { id: true },
  });

  let added: boolean;
  if (existing) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
    added = false;
  } else {
    await prisma.commentReaction.create({
      data: { commentId: id, userId: session.userId, type: key.toUpperCase() as ReactionType },
    });
    added = true;
  }

  const likeCount = await prisma.commentReaction.count({ where: { commentId: id } });
  return ok({
    added,
    likeCount,
    isLiked: added,
    myReaction: added ? key : null,
    reactionCounts: { [key]: likeCount },
  });
});
