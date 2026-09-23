import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notificationInclude } from '@/lib/notifications';
import { serializeAuthor, timeAgo, toIso } from '@/lib/serialize';
import { Prisma } from '@prisma/client';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const all = url.searchParams.get('all') === 'true';
  const unreadOnly = !all;

  const where: Prisma.NotificationWhereInput = {
    userId: session.userId,
    type: 'MENTION',
    ...(unreadOnly ? { readAt: null } : {}),
  };

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: notificationInclude,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { userId: session.userId, type: 'MENTION', readAt: null },
    }),
  ]);

  // Recolectar IDs de salas y conversaciones para enriquecer con metadatos contextuales
  const roomIds = [
    ...new Set(
      items
        .filter((n) => n.targetType === 'room' && n.targetId)
        .map((n) => n.targetId as string)
    ),
  ];

  const convIds = [
    ...new Set(
      items
        .filter((n) => n.targetType === 'conversation' && n.targetId)
        .map((n) => n.targetId as string)
    ),
  ];

  const [rooms, convs] = await Promise.all([
    roomIds.length > 0
      ? prisma.room.findMany({
          where: { id: { in: roomIds } },
          select: { id: true, name: true, imageUrl: true },
        })
      : [],
    convIds.length > 0
      ? prisma.conversation.findMany({
          where: { id: { in: convIds } },
          select: {
            id: true,
            title: true,
            type: true,
            members: {
              select: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        })
      : [],
  ]);

  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const convMap = new Map(convs.map((c) => [c.id, c]));

  const data = items.map((n) => {
    let targetTitle = 'Mención';
    let targetCoverUrl: string | null = null;

    if (n.targetType === 'room' && n.targetId) {
      const room = roomMap.get(n.targetId);
      targetTitle = room?.name || 'Sala';
      targetCoverUrl = room?.imageUrl || null;
    } else if (n.targetType === 'conversation' && n.targetId) {
      const conv = convMap.get(n.targetId);
      if (conv) {
        if (conv.title) {
          targetTitle = conv.title;
        } else {
          const other = conv.members.find((m) => m.user.id !== session.userId);
          targetTitle =
            other?.user.displayName ||
            other?.user.username ||
            'Chat privado';
          targetCoverUrl = other?.user.avatarUrl || null;
        }
      } else {
        targetTitle = 'Chat privado';
      }
    }

    return {
      id: n.id,
      type: n.type,
      actor: n.actor ? serializeAuthor(n.actor) : null,
      targetType: n.targetType,
      targetId: n.targetId,
      targetTitle,
      targetCoverUrl,
      text: n.text,
      readAt: toIso(n.readAt) ?? null,
      timeAgo: timeAgo(n.createdAt),
      createdAt: toIso(n.createdAt)!,
    };
  });

  return ok({
    data,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    unread,
  });
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  let body: { id?: string; all?: boolean } = {};
  try {
    body = await request.json();
  } catch (_) {
    // Si no hay body o es vacío
  }

  if (body.all) {
    const updated = await prisma.notification.updateMany({
      where: { userId: session.userId, type: 'MENTION', readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ success: true, marked: updated.count });
  }

  if (body.id) {
    const updated = await prisma.notification.updateMany({
      where: { id: body.id, userId: session.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ success: true, marked: updated.count });
  }

  return fail('Debes proporcionar id o all: true', 400);
});
