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

const MENTION_RE = /@([a-zA-Z0-9_]{1,32})/g;

export async function notifyMentions(
  body: string,
  actorId: string,
  target: Target
): Promise<void> {
  const usernames = [
    ...new Set((body.match(MENTION_RE) ?? []).map((m) => m.slice(1))),
  ].slice(0, 5);
  if (usernames.length === 0) return;
  const users = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true },
  });
  for (const user of users) {
    await notify({
      userId: user.id,
      actorId,
      type: 'MENTION',
      target,
      text: body.slice(0, 200),
    });
  }
}
