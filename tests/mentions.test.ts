import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  let current: any = null;
  function build() {
    const m = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
      notification: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      room: { findMany: vi.fn(), findUnique: vi.fn() },
      conversation: { findMany: vi.fn(), findUnique: vi.fn() },
      follow: { findMany: vi.fn() },
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
  emitToSala: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));
vi.mock('@/lib/socketio', () => mockSockets);

import { prisma } from '@/lib/prisma';
import { notifyMentions } from '@/lib/notifications';
import { GET as getMentions, PATCH as patchMentions } from '@/app/users/me/mentions/route';
import { PATCH as patchNotificationId } from '@/app/notifications/[id]/route';

const m = prisma as unknown as PrismaMock;
const me = baseUser({ id: 'user-1', username: 'sender_user', displayName: 'Sender' });
const targetUser = baseUser({ id: 'user-2', username: 'target_user', displayName: 'Target' });
const hostUser = baseUser({ id: 'user-host', username: 'host_user', displayName: 'Host' });

async function tokenFor(userId = me.id) {
  return signAccessToken({
    userId,
    email: 'test@kyubi.app',
    username: 'test_user',
  });
}

describe('Sistema de Menciones (@Mentions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.user.findFirst.mockResolvedValue(me);
    m.user.findUnique.mockResolvedValue(me);
    m.ban.findFirst.mockResolvedValue(null);
    m.mute.findFirst.mockResolvedValue(null);
  });

  describe('notifyMentions', () => {
    it('notifica a usuario mencionado mediante @username', async () => {
      m.user.findMany.mockResolvedValueOnce([{ id: targetUser.id }]);
      m.notification.create.mockResolvedValueOnce({
        id: 'notif-1',
        userId: targetUser.id,
        actorId: me.id,
        type: 'MENTION',
        targetType: 'room',
        targetId: 'room-1',
        text: 'Hola @target_user!',
        readAt: null,
        createdAt: new Date(),
        actor: me,
      });

      await notifyMentions('Hola @target_user mira esto', me.id, { type: 'room', id: 'room-1' });

      expect(m.user.findMany).toHaveBeenCalledWith({
        where: { username: { in: ['target_user'], mode: 'insensitive' } },
        select: { id: true },
      });
      expect(m.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: targetUser.id,
            actorId: me.id,
            type: 'MENTION',
          }),
        })
      );
      expect(mockSockets.emitToUser).toHaveBeenCalledWith(
        targetUser.id,
        'notification_received',
        expect.objectContaining({ type: 'MENTION' })
      );
    });

    it('resuelve y notifica a @host cuando se incluye en el mensaje de una sala', async () => {
      m.user.findMany.mockResolvedValueOnce([]);
      m.notification.create.mockResolvedValueOnce({
        id: 'notif-host',
        userId: hostUser.id,
        actorId: me.id,
        type: 'MENTION',
        targetType: 'room',
        targetId: 'room-1',
        text: 'Atención @host por favor',
        readAt: null,
        createdAt: new Date(),
        actor: me,
      });

      await notifyMentions(
        'Atención @host por favor',
        me.id,
        { type: 'room', id: 'room-1' },
        { hostId: hostUser.id }
      );

      expect(m.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: hostUser.id,
            actorId: me.id,
            type: 'MENTION',
          }),
        })
      );
      expect(mockSockets.emitToUser).toHaveBeenCalledWith(
        hostUser.id,
        'notification_received',
        expect.objectContaining({ type: 'MENTION' })
      );
    });

    it('excluye al emisor si se auto-menciona o si el host es el emisor', async () => {
      m.user.findMany.mockResolvedValueOnce([{ id: me.id }]);

      await notifyMentions(
        'Hablando conmigo mismo @sender_user y @host',
        me.id,
        { type: 'room', id: 'room-1' },
        { hostId: me.id }
      );

      expect(m.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('Endpoint GET /users/me/mentions', () => {
    it('requiere autenticación', async () => {
      const res = await getMentions(new Request('http://localhost/users/me/mentions'));
      expect(res.status).toBe(401);
    });

    it('devuelve menciones no leídas con metadatos contextuales de sala y chat', async () => {
      const token = await tokenFor(targetUser.id);
      m.user.findUnique.mockResolvedValue(targetUser);

      m.notification.findMany.mockResolvedValueOnce([
        {
          id: 'notif-1',
          userId: targetUser.id,
          actorId: me.id,
          type: 'MENTION',
          targetType: 'room',
          targetId: 'room-100',
          text: 'Te mencioné en la sala @target_user',
          readAt: null,
          createdAt: new Date('2026-09-23T10:00:00Z'),
          actor: me,
        },
        {
          id: 'notif-2',
          userId: targetUser.id,
          actorId: me.id,
          type: 'MENTION',
          targetType: 'conversation',
          targetId: 'conv-200',
          text: 'Mira esto @target_user',
          readAt: null,
          createdAt: new Date('2026-09-23T11:00:00Z'),
          actor: me,
        },
      ]);
      m.notification.count
        .mockResolvedValueOnce(2) // total
        .mockResolvedValueOnce(2); // unread

      m.room.findMany.mockResolvedValueOnce([
        { id: 'room-100', name: 'Sala de Anime y Rol', imageUrl: 'https://cdn.example.com/cover.jpg' },
      ]);
      m.conversation.findMany.mockResolvedValueOnce([
        {
          id: 'conv-200',
          title: 'Grupo de Rol',
          type: 'GROUP',
          members: [{ user: me }, { user: targetUser }],
        },
      ]);

      const req = new Request('http://localhost/users/me/mentions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await getMentions(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.unread).toBe(2);
      expect(json.total).toBe(2);
      expect(json.data).toHaveLength(2);

      // Sala
      expect(json.data[0].targetTitle).toBe('Sala de Anime y Rol');
      expect(json.data[0].targetCoverUrl).toBe('https://cdn.example.com/cover.jpg');

      // Conversación
      expect(json.data[1].targetTitle).toBe('Grupo de Rol');
    });
  });

  describe('Endpoint PATCH /users/me/mentions y PATCH /notifications/:id', () => {
    it('marca una mención específica como leída', async () => {
      const token = await tokenFor(targetUser.id);
      m.user.findUnique.mockResolvedValue(targetUser);
      m.notification.updateMany.mockResolvedValueOnce({ count: 1 });

      const req = jsonRequest('http://localhost/users/me/mentions', {
        method: 'PATCH',
        body: { id: 'notif-1' },
        token,
      });
      const res = await patchMentions(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.marked).toBe(1);

      expect(m.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: targetUser.id, readAt: null },
        data: expect.objectContaining({ readAt: expect.any(Date) }),
      });
    });

    it('marca todas las menciones como leídas con all: true', async () => {
      const token = await tokenFor(targetUser.id);
      m.user.findUnique.mockResolvedValue(targetUser);
      m.notification.updateMany.mockResolvedValueOnce({ count: 5 });

      const req = jsonRequest('http://localhost/users/me/mentions', {
        method: 'PATCH',
        body: { all: true },
        token,
      });
      const res = await patchMentions(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.marked).toBe(5);

      expect(m.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: targetUser.id, type: 'MENTION', readAt: null },
        data: expect.objectContaining({ readAt: expect.any(Date) }),
      });
    });

    it('soporta PATCH en /notifications/[id]', async () => {
      const token = await tokenFor(targetUser.id);
      m.user.findUnique.mockResolvedValue(targetUser);
      m.notification.updateMany.mockResolvedValueOnce({ count: 1 });

      const req = new Request('http://localhost/notifications/notif-abc', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await patchNotificationId(req, { params: Promise.resolve({ id: 'notif-abc' }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.marked).toBe(1);
    });
  });
});
