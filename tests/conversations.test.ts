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
      message: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
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
});
