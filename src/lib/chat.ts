import { Prisma } from '@prisma/client';
import { serializeAuthor, toIso } from '@/lib/serialize';

export const conversationInclude = {
  members: {
    include: {
      user: {
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
  },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    include: {
      sender: {
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
  },
} as const;

export const messageInclude = {
  sender: {
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

export type MessagePayload = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export function serializeMessage(message: MessagePayload) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    sender: serializeAuthor(message.sender),
    body: message.body,
    mediaUrl: message.mediaUrl,
    mediaType: message.mediaType,
    replyToId: message.replyToId,
    editedAt: toIso(message.editedAt),
    deletedAt: toIso(message.deletedAt),
    createdAt: toIso(message.createdAt)!,
  };
}

type ConversationPayload = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export function serializeConversation(
  conversation: ConversationPayload,
  myId: string,
  unreadCount = 0
) {
  const myMember = conversation.members.find((m) => m.userId === myId);
  const lastMessage = conversation.messages[0] ?? null;
  const others = conversation.members.filter((m) => m.userId !== myId);

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title,
    createdAt: toIso(conversation.createdAt),
    updatedAt: toIso(conversation.updatedAt),
    members: conversation.members.map((m) => ({
      ...serializeAuthor(m.user),
      role: m.role,
      muted: m.muted,
      lastReadAt: toIso(m.lastReadAt),
    })),
    otherMember: others[0] ? serializeAuthor(others[0].user) : null,
    isGroup: others.length > 1,
    lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
    unreadCount,
    lastReadMessageId: myMember?.lastReadMessageId ?? null,
    muted: myMember?.muted ?? false,
  };
}
