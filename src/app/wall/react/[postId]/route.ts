import { ReactionType } from '@prisma/client';
import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { normalizeReactionKey, reactionKey } from '@/lib/serialize';

const schema = z.object({
  type: z.string().max(10).optional(),
  emoji: z.string().max(10).optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ postId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { postId } = await params;
  const entry = await prisma.wallEntry.findUnique({ where: { id: postId }, select: { id: true } });
  if (!entry) return fail('Mensaje no encontrado', 404);

  const body = schema.safeParse(await request.json().catch(() => null));
  const key = body.success
    ? normalizeReactionKey(body.data.type ?? body.data.emoji ?? 'like')
    : ('like' as const);

  const existing = await prisma.wallLike.findUnique({
    where: { entryId_userId: { entryId: postId, userId: session.userId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.wallLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.wallLike.create({
      data: { entryId: postId, userId: session.userId, type: key.toUpperCase() as ReactionType },
    });
  }
  const likeCount = await prisma.wallLike.count({ where: { entryId: postId } });
  return ok({ added: !existing, likeCount, myReaction: existing ? null : key, reactionCounts: { [key]: likeCount } });
});
