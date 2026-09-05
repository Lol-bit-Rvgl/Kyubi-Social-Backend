import { ReactionType } from '@prisma/client';
import { z } from 'zod';
import { canAccessPost } from '@/lib/posts';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import { emptyReactionCounts, normalizeReactionKey, reactionKey } from '@/lib/serialize';

const schema = z.object({
  emoji: z.string().max(10).optional(),
  type: z.string().max(10).optional(),
});

const reactionTypeSchema = z.nativeEnum(ReactionType);

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados y silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const body = schema.safeParse(await request.json().catch(() => null));
  const reactionType = body.success
    ? normalizeReactionKey(body.data.type ?? body.data.emoji ?? 'like')
    : ('like' as const);
  // Validación runtime del enum (nunca un cast `as` inseguro).
  const prismaType = reactionTypeSchema.parse(reactionType.toUpperCase());

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
      data: { postId: id, userId: session.userId, type: prismaType },
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

  // Conteos agrupados en base de datos (una consulta, exactos).
  const grouped = await prisma.reaction.groupBy({
    by: ['type'],
    where: { postId: id },
    _count: { _all: true },
  });
  const counts = emptyReactionCounts();
  for (const r of grouped) {
    counts[reactionKey(r.type)] += r._count._all;
  }

  return ok({ added, reactionCounts: counts });
});
