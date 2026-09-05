import { z } from 'zod';
import { requireStaffRole, writeModerationLog, emitPostModeration } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const pinSchema = z.object({
  isPinned: z.boolean(),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
});

type RouteContext = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: Request, context: RouteContext) => {
  const auth = await requireStaffRole(request, 'ADMIN'); // Only ADMIN+ can pin
  if (auth instanceof Response) return auth;

  const { id: postId } = await context.params;
  const body = await request.json();
  const data = pinSchema.parse(body);

  const post = await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true, isPinned: true } });
  if (!post) return fail('Post no encontrado', 404);

  if (data.isPinned && !post.isPinned) {
    // Check pin limit (max 3)
    const pinnedCount = await prisma.post.count({ where: { isPinned: true } });
    if (pinnedCount >= 3) {
      return fail('No se pueden fijar más de 3 publicaciones activas', 400);
    }
    await prisma.post.update({
      where: { id: postId },
      data: { isPinned: true, pinnedAt: new Date() },
    });
  } else if (!data.isPinned && post.isPinned) {
    await prisma.post.update({
      where: { id: postId },
      data: { isPinned: false, pinnedAt: null },
    });
  }

  await writeModerationLog(prisma, {
    moderatorId: auth.userId,
    action: data.isPinned ? 'PIN_POST' : 'UNPIN_POST',
    targetType: 'POST',
    targetId: postId,
    targetPostId: postId,
    reason: data.reason,
    metadata: { postId, wasPinned: post.isPinned, isPinned: data.isPinned },
  });

  emitPostModeration(data.isPinned ? 'post:pinned' : 'post:unpinned', postId, {
    action: data.isPinned ? 'PIN_POST' : 'UNPIN_POST',
    reason: data.reason,
    moderatorId: auth.userId,
  });

  return ok({ success: true, postId, isPinned: data.isPinned });
});
