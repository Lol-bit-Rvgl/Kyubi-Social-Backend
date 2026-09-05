import { z } from 'zod';
import { requireStaffRole, writeModerationLog, emitPostModeration } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const visibilitySchema = z.object({
  isHidden: z.boolean(),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
});

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'MODERATOR');
  if (auth instanceof Response) return auth;

  const { id: postId } = await context.params;
  const body = await request.json();
  const data = visibilitySchema.parse(body);

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true, isHidden: true } });
  if (!post) return fail('Post no encontrado', 404);

  await prisma.post.update({
    where: { id: postId },
    data: {
      isHidden: data.isHidden,
      hiddenReason: data.isHidden ? data.reason : null,
      hiddenByUserId: data.isHidden ? auth.userId : null,
    },
  });

  await writeModerationLog(prisma, {
    moderatorId: auth.userId,
    action: data.isHidden ? 'HIDE_POST' : 'UNHIDE_POST',
    targetType: 'POST',
    targetId: postId,
    targetPostId: postId,
    reason: data.reason,
    metadata: { wasHidden: post.isHidden, isHidden: data.isHidden },
  });

  emitPostModeration(data.isHidden ? 'post:hidden' : 'post:unhidden', postId, {
    action: data.isHidden ? 'HIDE_POST' : 'UNHIDE_POST',
    reason: data.reason,
    moderatorId: auth.userId,
  });

  return ok({ success: true, postId, isHidden: data.isHidden });
});
