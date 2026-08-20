import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { emitToUser } from '@/lib/socketio';
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
