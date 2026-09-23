import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { emitToUser } from '@/lib/socketio';
import { sendPushNotification } from '@/lib/fcm';
import { serializeAuthor, timeAgo, toIso } from '@/lib/serialize';

export type { NotificationType };

export const notificationInclude = {
  actor: {
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
} as const;

export type NotificationPayload = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

export function serializeNotification(
  notification: NotificationPayload,
  followedIds?: Set<string>
) {
  return {
    id: notification.id,
    type: notification.type,
    actor: notification.actor
      ? {
          ...serializeAuthor(notification.actor),
          isFollowing: followedIds
            ? followedIds.has(notification.actor.id)
            : false,
        }
      : null,
    targetType: notification.targetType,
    targetId: notification.targetId,
    text: notification.text,
    readAt: toIso(notification.readAt) ?? null,
    timeAgo: timeAgo(notification.createdAt),
    createdAt: toIso(notification.createdAt)!,
  };
}

type Target = { type: string; id?: string | null };

/** Título push por tipo de notificación (Nebulæ en español). */
const PUSH_TITLES: Record<NotificationType, string> = {
  COMMENT: 'Nueva respuesta 💬',
  MENTION: 'Te mencionaron @',
  WALL: 'Nueva firma en tu muro ✍️',
  REACTION: 'Nueva reacción ❤️',
  FOLLOW: 'Nuevo seguidor ✨',
  MODERATION_WARNING: 'Aviso de moderación ⚠️',
};

export async function notify(params: {
  userId: string;
  actorId?: string | null;
  type: NotificationType;
  target: Target;
  text?: string | null;
}): Promise<void> {
  if (!params.userId) return;
  if (params.actorId && params.userId === params.actorId) return;
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      actorId: params.actorId ?? null,
      type: params.type,
      targetType: params.target.type,
      targetId: params.target.id ?? null,
      text: params.text ?? null,
    },
    include: notificationInclude,
  });

  // Real-time push via Socket.IO
  emitToUser(params.userId, 'notification_received', serializeNotification(notification));

  // Push real (FCM) para reactivar usuarios fuera de la app.
  const actorName = notification.actor?.displayName ?? 'Alguien';
  await sendPushNotification({
    userId: params.userId,
    title: `${PUSH_TITLES[params.type] ?? 'Nueva notificación'} · ${actorName}`,
    body: params.text?.slice(0, 180) ?? 'Tienes una nueva actividad en Kyubi.',
    data: {
      type: params.type.toLowerCase(),
      targetType: params.target.type,
      targetId: params.target.id ?? '',
      actorId: params.actorId ?? '',
    },
    imageUrl: notification.actor?.avatarUrl ?? null,
  });
}

/**
 * Notificación de advertencia de moderación: se crea directamente (sin actor)
 * para que el usuario sancionado la vea en su centro de notificaciones y reciba
 * el evento en tiempo real por Socket.IO.
 */
export async function notifyModerationWarning(params: {
  userId: string;
  reason: string;
  target?: { type: string; id?: string | null };
}): Promise<void> {
  if (!params.userId) return;
  const text = `Has recibido una advertencia del equipo de moderación: ${params.reason}`.slice(
    0,
    500
  );

  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      actorId: null,
      type: 'MODERATION_WARNING',
      targetType: params.target?.type ?? null,
      targetId: params.target?.id ?? null,
      text,
    },
    include: notificationInclude,
  });

  emitToUser(params.userId, 'notification_received', serializeNotification(notification));

  await sendPushNotification({
    userId: params.userId,
    title: PUSH_TITLES.MODERATION_WARNING,
    body: text,
    data: {
      type: 'moderation_warning',
      targetType: params.target?.type ?? '',
      targetId: params.target?.id ?? '',
      actorId: '',
    },
    imageUrl: null,
  });
}

const MENTION_RE = /@([a-zA-Z0-9_]{1,32})/g;

export async function notifyMentions(
  body: string,
  actorId: string,
  target: Target,
  options?: { hostId?: string }
): Promise<void> {
  const matches = body.match(MENTION_RE) ?? [];
  const hasHostMention = /@host\b/i.test(body);
  const usernames = [
    ...new Set(matches.map((m) => m.slice(1))),
  ].slice(0, 10);

  const targetUserIds = new Set<string>();

  if (usernames.length > 0) {
    const users = await prisma.user.findMany({
      where: { username: { in: usernames, mode: 'insensitive' } },
      select: { id: true },
    });
    for (const u of users) {
      targetUserIds.add(u.id);
    }
  }

  if (hasHostMention && options?.hostId) {
    targetUserIds.add(options.hostId);
  }

  for (const userId of targetUserIds) {
    if (userId === actorId) continue;
    await notify({
      userId,
      actorId,
      type: 'MENTION',
      target,
      text: body.slice(0, 200),
    });
  }
}

