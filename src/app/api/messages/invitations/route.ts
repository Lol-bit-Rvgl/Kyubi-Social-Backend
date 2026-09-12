import { FollowRequestStatus } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeAuthor, timeAgo, toIso } from '@/lib/serialize';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return ok({ items: [], nextCursor: null });

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);

  // 1. Obtener los IDs de usuarios con los que ya existe una conversación directa activa
  const directConversations = await prisma.conversation.findMany({
    where: {
      type: 'DIRECT',
      members: { some: { userId: session.userId } },
    },
    select: {
      members: { select: { userId: true } },
      messages: { take: 1, select: { id: true } },
    },
  });

  const activeChatUserIds = new Set<string>();
  for (const conv of directConversations) {
    const otherMember = conv.members.find((m) => m.userId !== session.userId);
    if (otherMember) {
      activeChatUserIds.add(otherMember.userId);
    }
  }

  // 2. Auto-aceptar solicitudes pendientes si ya existe un chat activo con ese usuario
  if (activeChatUserIds.size > 0) {
    await prisma.followRequest.updateMany({
      where: {
        targetId: session.userId,
        requesterId: { in: Array.from(activeChatUserIds) },
        status: FollowRequestStatus.PENDING,
      },
      data: {
        status: FollowRequestStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    });
  }

  const where = {
    targetId: session.userId,
    status: FollowRequestStatus.PENDING,
    ...(activeChatUserIds.size > 0
      ? { requesterId: { notIn: Array.from(activeChatUserIds) } }
      : {}),
  };
  const items = await prisma.followRequest.findMany({
    where: cursor ? { ...where, id: { lt: cursor } } : where,
    orderBy: { id: 'desc' },
    take: limit + 1,
    include: {
      requester: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          usernameColor: true,
          avatarFrame: true,
          level: true,
          isOnline: true,
          gender: true,
          showGender: true,
        },
      },
    },
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return ok({
    items: page.map((r) => ({
      id: r.id,
      status: r.status,
      requester: serializeAuthor(r.requester),
      createdAt: toIso(r.createdAt)!,
      timeAgo: timeAgo(r.createdAt),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
});
