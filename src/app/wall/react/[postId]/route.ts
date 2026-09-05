import { ReactionType } from '@prisma/client';
import { z } from 'zod';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { normalizeReactionKey, reactionKey } from '@/lib/serialize';

const schema = z.object({
  type: z.string().max(10).optional(),
  emoji: z.string().max(10).optional(),
});

const reactionTypeSchema = z.nativeEnum(ReactionType);

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ postId: string }> }) => {
  // Bloquea usuarios baneados y silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { postId } = await params;
  const entry = await prisma.wallEntry.findUnique({ where: { id: postId }, select: { id: true } });
  if (!entry) return fail('Mensaje no encontrado', 404);

  const body = schema.safeParse(await request.json().catch(() => null));
  const key = body.success
    ? normalizeReactionKey(body.data.type ?? body.data.emoji ?? 'like')
    : ('like' as const);

  // Validación runtime del enum (nunca un cast `as` inseguro).
  const prismaType = reactionTypeSchema.parse(key.toUpperCase());

  const existing = await prisma.wallLike.findUnique({
    where: { entryId_userId: { entryId: postId, userId: session.userId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.wallLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.wallLike.create({
      data: { entryId: postId, userId: session.userId, type: prismaType },
    });
  }

  // Conteos agrupados en base de datos: una sola consulta, exactos
  // (evita el patrón `reactionCounts: { [key]: total }` incorrecto).
  const grouped = await prisma.wallLike.groupBy({
    by: ['type'],
    where: { entryId: postId },
    _count: { _all: true },
  });
  const reactionCounts: Record<string, number> = {};
  let likeCount = 0;
  for (const row of grouped) {
    reactionCounts[reactionKey(row.type)] = row._count._all;
    likeCount += row._count._all;
  }

  return ok({ added: !existing, likeCount, myReaction: existing ? null : key, reactionCounts });
});
