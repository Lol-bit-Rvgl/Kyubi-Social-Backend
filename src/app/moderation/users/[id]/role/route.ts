import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { requireAdmin, hasRoleAtLeast } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { logAction } from '@/lib/moderation';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

const roleSchema = z.object({
  role: z.enum(['USER', 'MODERATOR', 'ADMIN']),
});

export const PATCH = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;

  if (id === auth.userId) return fail('No puedes cambiar tu propio rol', 403);

  const body = roleSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Rol inválido', 400);

  const newRole = body.data.role as UserRole;

  if (newRole === 'ADMIN' && !hasRoleAtLeast(auth.role, 'OWNER')) {
    return fail('Solo un OWNER puede asignar el rol ADMIN', 403);
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, username: true, displayName: true, avatarUrl: true, email: true, bio: true, isOnline: true, createdAt: true, _count: { select: { followers: true, following: true, posts: true } } } });
  if (!target) return fail('Usuario no encontrado', 404);

  if (hasRoleAtLeast(target.role, 'ADMIN') && !hasRoleAtLeast(auth.role, 'OWNER')) {
    return fail('No puedes modificar el rol de un ADMIN', 403);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { role: newRole },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        role: true,
        isOnline: true,
        createdAt: true,
        _count: { select: { followers: true, following: true, posts: true } },
      },
    });
    await logAction(tx, {
      moderatorId: auth.userId,
      action: 'CHANGE_ROLE',
      targetType: 'USER',
      targetId: id,
      reason: null,
      metadata: { from: target.role, to: newRole },
    });
    return user;
  });

  return ok(serializeUser(updated, { isMe: false }));
});
