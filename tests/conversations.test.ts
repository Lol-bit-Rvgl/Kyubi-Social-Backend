import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  let current: any = null;
  function build() {
    const m = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      conversation: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      conversationMember: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
      message: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      followRequest: { updateMany: vi.fn() },
      ban: { findFirst: vi.fn(), findMany: vi.fn() },
      mute: { findFirst: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn((arg: unknown) =>
        typeof arg === 'function' ? arg(current) : Promise.all(arg as unknown[])
      ),
    };
    current = m;
    return m;
  }
  return build;
});

const mockSockets = vi.hoisted(() => ({
  emitToConversation: vi.fn(),
  emitToUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));
vi.mock('@/lib/socketio', () => mockSockets);

import { prisma } from '@/lib/prisma';
import { POST as postMessage, GET as getMessages } from '@/app/conversations/[id]/messages/route';
import { POST as voteMessage } from '@/app/conversations/[id]/messages/[messageId]/vote/route';
import { GET as getRooms } from '@/app/rooms/route';
import { GET as getConversations } from '@/app/conversations/route';

const m = prisma as unknown as PrismaMock;
const me = baseUser({ id: 'user-1', username: 'sender_user' });

async function tokenFor(userId = me.id) {
  return signAccessToken({
    userId,
    email: 'test@kyubi.app',
    username: 'sender_user',
  });
}

describe('Conversations / DMs - Mensajes Multimedia y Encuestas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (m.ban.findFirst as any).mockResolvedValue(null);
    (m.mute.findFirst as any).mockResolvedValue(null);
    (m.conversationMember.findUnique as any).mockResolvedValue({
      id: 'member-1',
      conversationId: 'conv-1',
      userId: 'user-1',
    });
    (m.conversationMember.findMany as any).mockResolvedValue([
      { userId: 'user-2' },
    ]);
    (m.conversation.findUnique as any).mockResolvedValue({
      id: 'conv-1',
      type: 'DIRECT',
      members: [{ userId: 'user-1' }, { userId: 'user-2' }],
    });
    (m.conversation.update as any).mockResolvedValue({ id: 'conv-1' });
    (m.conversationMember.update as any).mockResolvedValue({ id: 'member-1' });
    (m.message.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'msg-created-1',
        ...data,
        createdAt: new Date(),
        sender: { id: 'user-1', username: 'sender_user', displayName: 'Sender', avatarUrl: null },
      })
    );
  });

  it('permite enviar una imagen con mediaUrl y content vacío', async () => {
    const token = await tokenFor();
    const res = await postMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages', {
        method: 'POST',
        token,
        body: {
          type: 'IMAGE',
          mediaUrl: 'https://cdn.kyubi.app/uploads/photo.webp',
          content: '',
        },
      }),
      { params: Promise.resolve({ id: 'conv-1' }) }
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.mediaUrl).toBe('https://cdn.kyubi.app/uploads/photo.webp');
    expect(data.mediaType).toBe('image');
    expect(mockSockets.emitToConversation).toHaveBeenCalledWith(
      'conv-1',
      'conversation:message',
      expect.objectContaining({ mediaUrl: 'https://cdn.kyubi.app/uploads/photo.webp' })
    );
    expect(mockSockets.emitToConversation).toHaveBeenCalledWith(
      'conv-1',
      'message:new',
      expect.anything()
    );
  });

  it('permite enviar un sticker con stickerUrl y stickerId sin texto obligatorio', async () => {
    const token = await tokenFor();
    const res = await postMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages', {
        method: 'POST',
        token,
        body: {
          type: 'STICKER',
          stickerUrl: 'assets/stickers/neko_cheer.webp',
          stickerId: 'sticker-neko-1',
          content: '',
        },
      }),
      { params: Promise.resolve({ id: 'conv-1' }) }
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.mediaType).toBe('sticker');
    expect(data.mediaUrl).toBe('assets/stickers/neko_cheer.webp');
    expect(data.extensions?.stickerId).toBe('sticker-neko-1');
  });

  it('permite enviar una encuesta interactiva con poll y opciones', async () => {
    const token = await tokenFor();
    const res = await postMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages', {
        method: 'POST',
        token,
        body: {
          type: 'POLL',
          poll: {
            question: '¿A qué hora jugamos?',
            options: ['8:00 PM', '10:00 PM'],
          },
          content: '',
        },
      }),
      { params: Promise.resolve({ id: 'conv-1' }) }
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.mediaType).toBe('poll');
    expect(data.body).toContain('¿A qué hora jugamos?');
    expect(data.extensions?.poll?.options).toHaveLength(2);
  });

  it('rechaza con 400 si no hay texto, ni mediaUrl, ni sticker, ni poll', async () => {
    const token = await tokenFor();
    const res = await postMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages', {
        method: 'POST',
        token,
        body: {
          content: '',
          body: '',
        },
      }),
      { params: Promise.resolve({ id: 'conv-1' }) }
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('vacío');
  });

  it('GET /conversations/[id]/messages devuelve lista paginada de mensajes', async () => {
    const token = await tokenFor();
    (m.message.findMany as any).mockResolvedValue([
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        senderId: 'user-1',
        body: 'Hola',
        mediaUrl: null,
        mediaType: null,
        extensions: {},
        createdAt: new Date(),
        sender: { id: 'user-1', username: 'sender_user', displayName: 'Sender', avatarUrl: null },
      },
    ]);

    const res = await getMessages(
      jsonRequest('http://localhost/conversations/conv-1/messages', { token }),
      { params: Promise.resolve({ id: 'conv-1' }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data).toHaveLength(1);
    expect(data.data[0].body).toBe('Hola');
  });

  it('permite votar en una encuesta de DM y recalcula totalVotes y porcentaje', async () => {
    const token = await tokenFor();
    const pollMessage = {
      id: 'msg-poll-1',
      conversationId: 'conv-1',
      senderId: 'user-2',
      body: '📊 Encuesta: ¿Cena hoy?',
      mediaUrl: null,
      mediaType: 'poll',
      extensions: {
        poll: {
          question: '¿Cena hoy?',
          options: [
            { id: 'opt_1', text: 'Pizza', votes: 0 },
            { id: 'opt_2', text: 'Sushi', votes: 0 },
          ],
          votes: {},
          totalVotes: 0,
        },
      },
      createdAt: new Date(),
      sender: { id: 'user-2', username: 'other_user', displayName: 'Other', avatarUrl: null },
    };

    (m.message.findUnique as any).mockResolvedValue(pollMessage);
    (m.message.update as any).mockImplementation(({ data }: any) =>
      Promise.resolve({
        ...pollMessage,
        extensions: data.extensions,
      })
    );

    const res = await voteMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages/msg-poll-1/vote', {
        method: 'POST',
        token,
        body: { optionId: 'opt_1' },
      }),
      { params: Promise.resolve({ id: 'conv-1', messageId: 'msg-poll-1' }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.extensions?.poll?.totalVotes).toBe(1);
    expect(data.extensions?.poll?.options[0].votes).toBe(1);
    expect(data.extensions?.poll?.options[1].votes).toBe(0);
    expect(data.extensions?.poll?.votes['user-1']).toBe('opt_1');
    expect(mockSockets.emitToConversation).toHaveBeenCalledWith(
      'conv-1',
      'message:updated',
      expect.objectContaining({ id: 'msg-poll-1' })
    );
  });

  it('permite votar por optionIndex', async () => {
    const token = await tokenFor();
    const pollMessage = {
      id: 'msg-poll-2',
      conversationId: 'conv-1',
      senderId: 'user-2',
      body: '📊 Encuesta: ¿Día?',
      mediaUrl: null,
      mediaType: 'poll',
      extensions: {
        poll: {
          question: '¿Día?',
          options: [
            { id: 'opt_1', text: 'Sábado', votes: 0 },
            { id: 'opt_2', text: 'Domingo', votes: 0 },
          ],
          votes: {},
          totalVotes: 0,
        },
      },
      createdAt: new Date(),
      sender: { id: 'user-2', username: 'other_user', displayName: 'Other', avatarUrl: null },
    };

    (m.message.findUnique as any).mockResolvedValue(pollMessage);
    (m.message.update as any).mockImplementation(({ data }: any) =>
      Promise.resolve({
        ...pollMessage,
        extensions: data.extensions,
      })
    );

    const res = await voteMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages/msg-poll-2/vote', {
        method: 'POST',
        token,
        body: { optionIndex: 1 },
      }),
      { params: Promise.resolve({ id: 'conv-1', messageId: 'msg-poll-2' }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.extensions?.poll?.totalVotes).toBe(1);
    expect(data.extensions?.poll?.options[1].votes).toBe(1);
    expect(data.extensions?.poll?.votes['user-1']).toBe('opt_2');
  });

  it('rechaza con 403 si el usuario no es miembro de la conversación', async () => {
    const token = await tokenFor();
    (m.conversationMember.findUnique as any).mockResolvedValue(null);

    const res = await voteMessage(
      jsonRequest('http://localhost/conversations/conv-1/messages/msg-poll-1/vote', {
        method: 'POST',
        token,
        body: { optionId: 'opt_1' },
      }),
      { params: Promise.resolve({ id: 'conv-1', messageId: 'msg-poll-1' }) }
    );

    expect(res.status).toBe(403);
  });
});

describe('Inbox / Conversaciones - Exclusión de Chats Vacíos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excluye conversaciones sin mensajes y solo retorna aquellas con al menos un mensaje', async () => {
    const token = await tokenFor();

    const conversationWithMsg = {
      id: 'conv-with-msg',
      type: 'DIRECT',
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      members: [
        {
          id: 'mem-1',
          userId: 'user-1',
          role: 'MEMBER',
          muted: false,
          lastReadAt: new Date(),
          lastReadMessageId: null,
          user: {
            id: 'user-1',
            username: 'sender_user',
            displayName: 'Sender',
            avatarUrl: null,
            usernameColor: null,
            avatarFrame: null,
            level: 1,
            isOnline: true,
            gender: null,
            showGender: true,
          },
        },
        {
          id: 'mem-2',
          userId: 'user-2',
          role: 'MEMBER',
          muted: false,
          lastReadAt: new Date(),
          lastReadMessageId: null,
          user: {
            id: 'user-2',
            username: 'other_user',
            displayName: 'Other',
            avatarUrl: null,
            usernameColor: null,
            avatarFrame: null,
            level: 1,
            isOnline: true,
            gender: null,
            showGender: true,
          },
        },
      ],
      messages: [
        {
          id: 'msg-1',
          conversationId: 'conv-with-msg',
          senderId: 'user-2',
          body: '¡Hola!',
          mediaUrl: null,
          mediaType: null,
          replyToId: null,
          characterId: null,
          characterName: null,
          characterAvatarUrl: null,
          extensions: null,
          editedAt: null,
          deletedAt: null,
          createdAt: new Date(),
          sender: {
            id: 'user-2',
            username: 'other_user',
            displayName: 'Other',
            avatarUrl: null,
            usernameColor: null,
            avatarFrame: null,
            level: 1,
            isOnline: true,
            gender: null,
            showGender: true,
          },
        },
      ],
    };

    const emptyConversation = {
      id: 'conv-empty',
      type: 'DIRECT',
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      members: [
        {
          id: 'mem-3',
          userId: 'user-1',
          role: 'MEMBER',
          muted: false,
          lastReadAt: new Date(),
          lastReadMessageId: null,
          user: {
            id: 'user-1',
            username: 'sender_user',
            displayName: 'Sender',
            avatarUrl: null,
            usernameColor: null,
            avatarFrame: null,
            level: 1,
            isOnline: true,
            gender: null,
            showGender: true,
          },
        },
        {
          id: 'mem-4',
          userId: 'user-3',
          role: 'MEMBER',
          muted: false,
          lastReadAt: new Date(),
          lastReadMessageId: null,
          user: {
            id: 'user-3',
            username: 'third_user',
            displayName: 'Third',
            avatarUrl: null,
            usernameColor: null,
            avatarFrame: null,
            level: 1,
            isOnline: true,
            gender: null,
            showGender: true,
          },
        },
      ],
      messages: [],
    };

    (m.conversation.findMany as any).mockResolvedValue([
      conversationWithMsg,
      emptyConversation,
    ]);
    (m.conversationMember.findMany as any).mockResolvedValue([]);
    (m.message.count as any).mockResolvedValue(0);

    // 1. Probar GET /rooms
    const resRooms = await getRooms(
      jsonRequest('http://localhost/rooms', { method: 'GET', token })
    );
    expect(resRooms.status).toBe(200);
    const dataRooms = await resRooms.json();
    expect(dataRooms.data).toHaveLength(1);
    expect(dataRooms.data[0].id).toBe('conv-with-msg');
    expect(dataRooms.data[0].lastMessage).not.toBeNull();
    expect(dataRooms.data[0].lastMessage.body).toBe('¡Hola!');

    // 2. Probar GET /conversations (reexportado)
    const resConvs = await getConversations(
      jsonRequest('http://localhost/conversations', { method: 'GET', token })
    );
    expect(resConvs.status).toBe(200);
    const dataConvs = await resConvs.json();
    expect(dataConvs.data).toHaveLength(1);
    expect(dataConvs.data[0].id).toBe('conv-with-msg');

    // Verificar que la consulta prisma incluyó messages: { some: {} }
    expect(m.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messages: { some: {} },
        }),
      })
    );
  });
});
