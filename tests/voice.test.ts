import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  let current: ReturnType<typeof build> | null = null;
  function build() {
    const m = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      roomParticipant: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      room: { findUnique: vi.fn() },
      ban: { findFirst: vi.fn() },
      mute: { findFirst: vi.fn() },
    };
    current = m;
    return m;
  }
  return build;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

const mockLiveKit = vi.hoisted(() => ({
  createVoiceToken: vi.fn(async (opts: unknown) => ({
    token: 'jwt-livekit',
    url: 'wss://kyubi-lxduyy00.livekit.cloud',
    ...(opts ? { opts } : {}),
  })),
  isLiveKitEnabled: vi.fn(() => true),
  livekitConfig: vi.fn(() => ({
    url: 'wss://kyubi-lxduyy00.livekit.cloud',
    apiKey: 'APITEST',
    apiSecret: 'SECRET',
  })),
}));

vi.mock('@/lib/livekit', () => mockLiveKit);

import { prisma } from '@/lib/prisma';
import { createVoiceToken } from '@/lib/livekit';
import { POST as salaVoiceToken } from '@/app/salas/[id]/voice/token/route';
import { POST as dmVoiceToken } from '@/app/messages/voice/token/route';

const m = prisma as unknown as PrismaMock;
const user = baseUser();

async function tokenFor() {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

describe('voz — tokens LiveKit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks no descarta implementaciones persistentes; cada test
    // arranca sin ban/mute activos.
    m.ban.findFirst.mockImplementation(() => undefined);
    m.mute.findFirst.mockImplementation(() => undefined);
    // La ruta de voz consulta la sala para verificar que existe.
    m.room.findUnique.mockResolvedValue({ id: 'room-1' });
  });

  /** Mock de la consulta de suspensión de getBlockingSanction (usuario libre). */
  function mockUserNotSuspended() {
    m.user.findUnique.mockResolvedValueOnce({ isSuspended: false, suspendedUntil: null, bans: [] });
  }

  it('401 sin sesión en ambas rutas de token', async () => {
    const sala = await salaVoiceToken(jsonRequest('http://localhost/salas/room-1/voice/token', { method: 'POST' }), {
      params: Promise.resolve({ id: 'room-1' }),
    });
    const dm = await dmVoiceToken(jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: { targetUserId: 'user-2' } }));
    expect(sala.status).toBe(401);
    expect(dm.status).toBe(401);
  });

  describe('POST /salas/[id]/voice/token', () => {
    it('200 aunque no figure como participante (se asume rol MEMBER)', async () => {
      const token = await tokenFor();
      m.roomParticipant.findUnique.mockResolvedValue(null);
      m.user.findUnique.mockResolvedValue({ id: 'user-1', displayName: 'User One', username: 'user_one', avatarUrl: null });

      const res = await salaVoiceToken(jsonRequest('http://localhost/salas/room-1/voice/token', { method: 'POST', token }), {
        params: Promise.resolve({ id: 'room-1' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string };
      expect(data.token).toBe('jwt-livekit');
    });

    it('403 si el usuario tiene mute global activo', async () => {
      const token = await tokenFor();
      m.mute.findFirst.mockResolvedValue({ id: 'mute-1', userId: 'user-1' });

      const res = await salaVoiceToken(jsonRequest('http://localhost/salas/room-1/voice/token', { method: 'POST', token }), {
        params: Promise.resolve({ id: 'room-1' }),
      });
      expect(res.status).toBe(403);
    });

    it('200 devuelve token, url y roomName `sala_<id>` con identidad y metadatos', async () => {
      const token = await tokenFor();
      m.roomParticipant.findUnique.mockResolvedValue({ role: 'HOST' });
      m.user.findUnique.mockResolvedValue({ id: 'user-1', displayName: 'User One', username: 'user_one', avatarUrl: 'https://cdn/ava.png' });

      const res = await salaVoiceToken(jsonRequest('http://localhost/salas/room-1/voice/token', { method: 'POST', token }), {
        params: Promise.resolve({ id: 'room-1' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string; url: string; roomName: string };
      expect(data.token).toBe('jwt-livekit');
      expect(data.url).toBe('wss://kyubi-lxduyy00.livekit.cloud');
      expect(data.roomName).toBe('sala_room-1');
      expect(createVoiceToken).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: 'user-1',
          name: 'User One',
          room: 'sala_room-1',
          metadata: { avatarUrl: 'https://cdn/ava.png', role: 'HOST' },
        })
      );
    });
  });

  describe('POST /messages/voice/token', () => {
    it('400 con body inválido', async () => {
      const token = await tokenFor();
      const res = await dmVoiceToken(jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: {}, token }));
      expect(res.status).toBe(400);
    });

    it('400 si el destinatario es uno mismo', async () => {
      const token = await tokenFor();
      const res = await dmVoiceToken(
        jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: { targetUserId: user.id }, token })
      );
      expect(res.status).toBe(400);
    });

    it('404 si el destinatario no existe', async () => {
      const token = await tokenFor();
      mockUserNotSuspended();
      m.user.findUnique.mockResolvedValueOnce(null);
      const res = await dmVoiceToken(
        jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: { targetUserId: 'ghost' }, token })
      );
      expect(res.status).toBe(404);
    });

    it('200 genera roomName canónico `dm_<idMenor>_<idMayor>`', async () => {
      const token = await tokenFor();
      mockUserNotSuspended();
      m.user.findUnique.mockResolvedValueOnce({ id: 'user-2' });
      m.user.findUnique.mockResolvedValueOnce({ id: 'user-1', displayName: 'User One', username: 'user_one', avatarUrl: null });

      const res = await dmVoiceToken(
        jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: { targetUserId: 'user-2' }, token })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { token: string; url: string; roomName: string };
      expect(data.roomName).toBe('dm_user-1_user-2');
      expect(data.token).toBe('jwt-livekit');
      expect(createVoiceToken).toHaveBeenCalledWith(
        expect.objectContaining({ identity: 'user-1', room: 'dm_user-1_user-2' })
      );
    });

    it('200 ordena los ids aunque el destinatario sea alfabéticamente menor', async () => {
      const token = await tokenFor();
      mockUserNotSuspended();
      m.user.findUnique.mockResolvedValueOnce({ id: 'aaa' });
      m.user.findUnique.mockResolvedValueOnce({ id: 'user-1', displayName: 'User One', username: 'user_one', avatarUrl: null });

      const res = await dmVoiceToken(
        jsonRequest('http://localhost/messages/voice/token', { method: 'POST', body: { targetUserId: 'aaa' }, token })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as { roomName: string };
      expect(data.roomName).toBe('dm_aaa_user-1');
    });
  });
});