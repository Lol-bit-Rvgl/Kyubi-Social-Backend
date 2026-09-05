import { z } from 'zod';
import { requireStaffRole, writeModerationLog, emitPostModeration } from '@/lib/admin';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const bulkDeleteSchema = z.object({
  postIds: z.array(z.string()).optional(),
  authorId: z.string().optional(),
  reason: z.string().trim().min(3, 'La razón debe tener al menos 3 caracteres'),
  hardDelete: z.boolean().default(false), // If true, actually delete from DB. If false, mark as hidden.
});

export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireStaffRole(request, 'ADMIN'); // Only ADMIN+ can bulk delete
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const data = bulkDeleteSchema.parse(body);

  let affectedCount = 0;
  const postIds = data.postIds ?? [];

  await prisma.$transaction(async (tx) => {
    if (data.hardDelete) {
      // Hard delete: remove from DB
      const where = data.authorId ? { authorId: data.authorId } : { id: { in: postIds } };
      const result = await tx.post.deleteMany({ where });
      affectedCount = result.count;
    } else {
      // Soft delete: mark as hidden
      const where = data.authorId ? { authorId: data.authorId } : { id: { in: postIds } };
      const result = await tx.post.updateMany({
        where,
        data: {
          isHidden: true,
          hiddenReason: data.reason,
          hiddenByUserId: auth.userId,
        },
      });
      affectedCount = result.count;
    }

    await writeModerationLog(tx, {
      moderatorId: auth.userId,
      action: 'DELETE_CONTENT',
      targetType: 'POST',
      targetId: data.authorId || 'bulk',
      reason: data.reason,
      metadata: {
        postIds,
        authorId: data.authorId,
        hardDelete: data.hardDelete,
        affectedCount,
      },
    });
  });

  // Emit event for feed update
  emitPostModeration('post:hidden', 'bulk', {
    action: 'DELETE_CONTENT',
    reason: data.reason,
    moderatorId: auth.userId,
  });

  return ok({ success: true, affectedCount, hardDelete: data.hardDelete });
});
