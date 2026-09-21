import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  let current: ReturnType<typeof build> | null = null;
  function build() {
    const m = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
      verificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
      post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
      follow: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
      reaction: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
      circle: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
      circleMember: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      character: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      room: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
      roomParticipant: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      roomMessage: { create: vi.fn().mockResolvedValue({ id: 'msg-1', roomId: 'room-1', senderId: 'user-1', sender: { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null }, type: 'SYSTEM', body: 'User One se ha unido.', extensions: {}, createdAt: new Date() }), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
      ban: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
      mute: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
      moderationLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
      report: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      $transaction: vi.fn((arg: unknown) =>
        typeof arg === 'function' ? arg(current) : Promise.all(arg as unknown[])
      ),
    };
    current = m;
    return m;
  }
  return build;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

import { prisma } from '@/lib/prisma';
import { serializeRoom } from '@/lib/social';
import { GET as listSalas, POST as createSala } from '@/app/salas/route';
import { GET as getSala, PATCH as patchSala, DELETE as deleteSala } from '@/app/salas/[id]/route';
import { POST as joinSala } from '@/app/salas/[id]/join/route';
import { POST as leaveSala } from '@/app/salas/[id]/leave/route';
import { POST as updateStageRole } from '@/app/salas/[id]/stage/role/route';
import { POST as occupyRole } from '@/app/salas/[id]/roles/occupy/route';
import { POST as leaveRole } from '@/app/salas/[id]/roles/leave/route';
import { DELETE as deleteCharacter } from '@/app/characters/[id]/route';
import { POST as votePoll } from '@/app/salas/[id]/messages/[messageId]/vote/route';
import { PATCH as patchMode } from '@/app/salas/[id]/mode/route';
import { POST as postMessage, GET as getMessages } from '@/app/salas/[id]/messages/route';
import { PATCH as patchMessage, DELETE as deleteMessage } from '@/app/salas/[id]/messages/[messageId]/route';
import { GET as getInvites } from '@/app/salas/invites/route';
import { POST as acceptInvite } from '@/app/salas/[id]/invite/accept/route';
import { POST as rejectInvite } from '@/app/salas/[id]/invite/reject/route';

const m = prisma as unknown as PrismaMock;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const user = baseUser();

async function tokenFor(userId?: string) {
  return signAccessToken({
    userId: userId ?? user.id,
    email: user.email,
    username: userId ? `user_${userId}` : user.username,
  });
}

function baseRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    name: 'Sala de Anime',
    description: 'Hablamos de anime',
    imageUrl: null,
    hostId: 'user-1',
    host: author,
    status: 'ACTIVE',
    access: 'PUBLIC',
    kind: 'SOCIAL',
    capacity: null,
    circleId: null,
    circle: null,
    createdAt: new Date(),
    endedAt: null,
    _count: { participants: 1 },
    participants: [{ user: author, role: 'HOST', joinedAt: new Date() }],
    ...overrides,
  };
}

describe('salas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin sesión en todas las rutas', async () => {
    expect((await listSalas(jsonRequest('http://localhost/salas'))).status).toBe(401);
    expect((await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: 'Sala' } }))).status).toBe(401);
    expect((await getSala(jsonRequest('http://localhost/salas/room-1'), { params: Promise.resolve({ id: 'room-1' }) })).status).toBe(401);
    expect((await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST' }), { params: Promise.resolve({ id: 'room-1' }) })).status).toBe(401);
    expect((await leaveSala(jsonRequest('http://localhost/salas/room-1/leave', { method: 'POST' }), { params: Promise.resolve({ id: 'room-1' }) })).status).toBe(401);
  });

  it('GET lista solo salas ACTIVE con isParticipant', async () => {
    const token = await tokenFor();
    m.roomParticipant.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
    m.room.findMany.mockResolvedValue([baseRoom()]);
    m.room.count.mockResolvedValue(1);

    const res = await listSalas(jsonRequest('http://localhost/salas', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Sala de Anime');
    expect(body.data[0].isParticipant).toBe(true);
    expect(m.room.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('GET lista devuelve todas las salas activas asociadas al círculo al filtrar por circleId', async () => {
    const token = await tokenFor();
    m.roomParticipant.findMany.mockResolvedValue([]);
    m.room.findMany.mockResolvedValue([
      baseRoom({ id: 'room-pub', circleId: 'circle-1', access: 'PUBLIC' }),
      baseRoom({ id: 'room-priv', circleId: 'circle-1', access: 'PRIVATE' }),
    ]);
    m.room.count.mockResolvedValue(2);

    const res = await listSalas(jsonRequest('http://localhost/salas?circleId=circle-1', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(m.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          circleId: 'circle-1',
          status: 'ACTIVE',
        }),
      })
    );
  });

  it('POST crea sala y convierte al autor en participante HOST', async () => {
    const token = await tokenFor();
    m.room.create.mockResolvedValue(baseRoom());

    const res = await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: 'Sala de Anime' }, token }));
    expect(res.status).toBe(201);
    expect(m.room.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Sala de Anime',
          hostId: 'user-1',
          participants: { create: { userId: 'user-1', role: 'HOST' } },
        }),
      })
    );
  });

  it('POST 201 crea sala con nombre y descripción con solo emojis o null', async () => {
    const token = await tokenFor();
    m.room.create.mockResolvedValue(baseRoom({ name: '🦊🔥🎮', description: '✨🎉🚀' }));

    const res = await createSala(
      jsonRequest('http://localhost/salas', {
        method: 'POST',
        body: { name: '🦊🔥🎮', description: '✨🎉🚀' },
        token,
      })
    );
    expect(res.status).toBe(201);
    expect(m.room.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '🦊🔥🎮',
          description: '✨🎉🚀',
        }),
      })
    );

    // Prueba con un solo emoji y descripción null
    m.room.create.mockResolvedValue(baseRoom({ name: '🦊', description: null }));
    const resSingleEmoji = await createSala(
      jsonRequest('http://localhost/salas', {
        method: 'POST',
        body: { name: '🦊', description: null },
        token,
      })
    );
    expect(resSingleEmoji.status).toBe(201);
  });

  it('POST 400 con nombre vacío', async () => {
    const token = await tokenFor();
    const res = await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: '   ' }, token }));
    expect(res.status).toBe(400);
  });

  it('POST 400 si la sala es PRIVATE sin círculo', async () => {
    const token = await tokenFor();
    const res = await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: 'Sala', access: 'PRIVATE' }, token }));
    expect(res.status).toBe(400);
    expect(m.room.create).not.toHaveBeenCalled();
  });

  it('POST en círculo ajeno da 403', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', isPrivate: false });
    m.circleMember.findUnique.mockResolvedValue(null);

    const res = await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: 'Sala', circleId: 'circle-1' }, token }));
    expect(res.status).toBe(403);
  });

  it('POST en círculo propio crea la sala con circleId', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', isPrivate: false });
    m.circleMember.findUnique.mockResolvedValue({ id: 'cm-1' });
    m.room.create.mockResolvedValue(baseRoom({ circleId: 'circle-1', circle: { id: 'circle-1', name: 'Anime Club', avatarUrl: null } }));

    const res = await createSala(jsonRequest('http://localhost/salas', { method: 'POST', body: { name: 'Sala', circleId: 'circle-1' }, token }));
    expect(res.status).toBe(201);
    expect(m.room.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ circleId: 'circle-1' }) }));
  });

  it('GET detalle 404 si no existe', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue(null);
    const res = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(404);
  });

  it('GET detalle público devuelve participantes', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue(baseRoom());
    m.roomParticipant.findUnique.mockResolvedValue(null);

    const res = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.participants).toHaveLength(1);
    expect(body.participants[0].role).toBe('HOST');
  });

  it('GET detalle privado sin acceso da 403; con membresía de círculo da 200', async () => {
    const token = await tokenFor('user-guest');
    m.room.findUnique.mockResolvedValue(baseRoom({ hostId: 'user-host', access: 'PRIVATE', circleId: 'circle-1' }));
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.circleMember.findUnique.mockResolvedValue(null);

    const denied = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(denied.status).toBe(403);

    m.circleMember.findUnique.mockResolvedValue({ id: 'cm-1' });
    const allowed = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(allowed.status).toBe(200);
  });

  it('GET detalle privado para el anfitrión (host) siempre da 200 aunque no tenga registro de participante', async () => {
    const token = await tokenFor('user-1');
    m.room.findUnique.mockResolvedValue(baseRoom({ hostId: 'user-1', access: 'PRIVATE' }));
    m.roomParticipant.findUnique.mockResolvedValue(null);

    const allowed = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.isParticipant).toBe(true);
  });

  it('PATCH 403 si no eres el host', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-2' });
    const res = await patchSala(jsonRequest('http://localhost/salas/room-1', { method: 'PATCH', body: { name: 'Otro' }, token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(403);
  });

  it('PATCH del host actualiza la sala', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-1' });
    m.room.update.mockResolvedValue(baseRoom({ name: 'Sala Nueva' }));

    const res = await patchSala(jsonRequest('http://localhost/salas/room-1', { method: 'PATCH', body: { name: 'Sala Nueva' }, token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    expect(m.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: 'Sala Nueva' }) }));
    const body = await res.json();
    expect(body.name).toBe('Sala Nueva');
  });

  it('PATCH a PRIVATE sin círculo da 400', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-1', circleId: null });
    const res = await patchSala(jsonRequest('http://localhost/salas/room-1', { method: 'PATCH', body: { access: 'PRIVATE' }, token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(400);
  });

  it('DELETE 403 si no eres el host; 200 si lo eres', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-2' });
    const denied = await deleteSala(jsonRequest('http://localhost/salas/room-1', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(denied.status).toBe(403);

    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-1' });
    m.room.delete.mockResolvedValue({ id: 'room-1' });
    const okRes = await deleteSala(jsonRequest('http://localhost/salas/room-1', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(okRes.status).toBe(200);
    expect(m.room.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } });
  });

  it('unirse a sala terminada da 400', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ENDED', access: 'PUBLIC', capacity: null, circleId: null });
    const res = await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(400);
  });

  it('unirse a sala privada sin ser miembro del círculo da 403', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', access: 'PRIVATE', capacity: null, circleId: 'circle-1' });
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.circleMember.findUnique.mockResolvedValue(null);

    const res = await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(403);
  });

  it('unirse a sala llena da 400', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', access: 'PUBLIC', capacity: 2, circleId: null });
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.roomParticipant.count.mockResolvedValue(2);

    const res = await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(400);
  });

  it('unirse crea participante y devuelve la sala actualizada', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValueOnce({ id: 'room-1', hostId: 'user-2', status: 'ACTIVE', access: 'PUBLIC', capacity: null, circleId: null });
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.roomParticipant.create.mockResolvedValue({ id: 'rp-2' });
    m.room.findUnique.mockResolvedValueOnce(baseRoom({ hostId: 'user-2', _count: { participants: 2 } }));

    const res = await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    expect(m.roomParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: 'room-1', userId: 'user-1', role: 'PARTICIPANT' }) })
    );
    const body = await res.json();
    expect(body.isParticipant).toBe(true);
  });

  it('unirse siendo ya participante no duplica', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValueOnce({ id: 'room-1', hostId: 'user-2', status: 'ACTIVE', access: 'PUBLIC', capacity: null, circleId: null });
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'rp-1' });
    m.room.findUnique.mockResolvedValueOnce(baseRoom({ hostId: 'user-2' }));

    const res = await joinSala(jsonRequest('http://localhost/salas/room-1/join', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    expect(m.roomParticipant.create).not.toHaveBeenCalled();
  });

  it('salir siendo participante normal elimina la membresía', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-2', status: 'ACTIVE' });
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'rp-1', role: 'PARTICIPANT' });
    m.roomParticipant.delete.mockResolvedValue({ id: 'rp-1' });

    const res = await leaveSala(jsonRequest('http://localhost/salas/room-1/leave', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended).toBe(false);
    expect(m.roomParticipant.delete).toHaveBeenCalled();
    expect(m.room.update).not.toHaveBeenCalled();
  });

  it('si el host se va, la sala termina y se vacían los participantes', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-1', status: 'ACTIVE' });
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'rp-1', role: 'HOST' });
    m.roomParticipant.delete.mockResolvedValue({ id: 'rp-1' });
    m.room.update.mockResolvedValue({ id: 'room-1', status: 'ENDED', endedAt: new Date() });
    m.roomParticipant.deleteMany.mockResolvedValue({ count: 1 });

    const res = await leaveSala(jsonRequest('http://localhost/salas/room-1/leave', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ended).toBe(true);
    expect(body.status).toBe('ENDED');
    expect(m.room.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ENDED' }) }));
    expect(m.roomParticipant.deleteMany).toHaveBeenCalled();
  });

  it('salir sin ser participante es no-op', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-2', status: 'ACTIVE' });
    m.roomParticipant.findUnique.mockResolvedValue(null);

    const res = await leaveSala(jsonRequest('http://localhost/salas/room-1/leave', { method: 'POST', token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyLeft).toBe(true);
  });

  it('adoptar un rol en el stage persiste en metadata y stageRoles', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-2', stageRoles: [] });
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'rp-1', roomId: 'room-1', userId: 'user-1', metadata: {} });
    m.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'user_one', displayName: 'User One' });
    m.roomParticipant.update.mockResolvedValue({ id: 'rp-1' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const role = { id: 'role-1', name: 'Zorro Sabio', colorHex: '#FF8800' };
    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', { method: 'POST', token, body: { action: 'take', role } }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('take');
    expect(m.roomParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            activeCharacter: expect.objectContaining({ id: 'role-1', isTaken: true, takenByUserId: 'user-1' }),
          }),
        }),
      })
    );
    expect(m.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stageRoles: expect.arrayContaining([expect.objectContaining({ id: 'role-1', isTaken: true })]),
        }),
      })
    );
  });

  it('liberar un rol en el stage limpia metadata y marca vacante en stageRoles', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'user-2',
      stageRoles: [{ id: 'role-1', name: 'Zorro Sabio', isTaken: true, takenByUserId: 'user-1' }],
    });
    m.roomParticipant.findUnique.mockResolvedValue({
      id: 'rp-1',
      roomId: 'room-1',
      userId: 'user-1',
      metadata: { activeCharacter: { id: 'role-1' } },
    });
    m.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'user_one', displayName: 'User One' });
    m.roomParticipant.update.mockResolvedValue({ id: 'rp-1' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', { method: 'POST', token, body: { action: 'leave', roleId: 'role-1' } }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('leave');
    expect(m.roomParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: 'room-1', userId: user.id },
        data: { metadata: {} },
      })
    );
    expect(m.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data: {
          stageRoles: expect.arrayContaining([
            expect.objectContaining({ id: 'role-1', isTaken: false }),
          ]),
        },
      })
    );
  });

  it('dejar rol enviando role con isTaken:true no lo toma como take sino como leave', async () => {
    const token = await tokenFor('user-1');
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'user-2',
      stageRoles: [{ id: 'role-1', name: 'Zorro', isTaken: true, takenByUserId: 'user-1' }],
    });
    m.roomParticipant.findUnique.mockResolvedValue({
      id: 'rp-1',
      metadata: { activeCharacter: { id: 'role-1' } },
    });
    m.roomParticipant.update.mockResolvedValue({ id: 'rp-1' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'leave',
          role: { id: 'role-1', name: 'Zorro', isTaken: true, takenByUserId: 'user-1' },
          roleId: 'role-1',
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('leave');
    expect(body.stageRoles[0].isTaken).toBe(false);
  });

  it('crear un rol en el stage (action: create) como host persiste en stageRoles y emite evento', async () => {
    const token = await tokenFor('user-1');
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1', stageRoles: [] });
    m.roomParticipant.findUnique.mockResolvedValue({ role: 'HOST' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const role = {
      id: 'role-new-1',
      name: 'Nuevo Heroe',
      colorHex: '#00E5FF',
      tagline: 'Defensor de la sala',
      description: 'Personaje de rol recién creado',
    };

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: { action: 'create', role },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('create');
    expect(body.role.name).toBe('Nuevo Heroe');
    expect(body.stageRoles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'role-new-1', name: 'Nuevo Heroe' })])
    );
    expect(m.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data: {
          stageRoles: expect.arrayContaining([
            expect.objectContaining({ id: 'role-new-1', isTaken: false }),
          ]),
        },
      })
    );
  });

  it('actualizar un rol en el stage (action: update) actualiza datos y conserva isTaken', async () => {
    const token = await tokenFor('user-1');
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'user-1',
      stageRoles: [{ id: 'role-1', name: 'Nombre Antiguo', isTaken: true, takenByUserId: 'user-2' }],
    });
    m.roomParticipant.findUnique.mockResolvedValue({ role: 'HOST' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const role = {
      id: 'role-1',
      name: 'Nombre Actualizado',
      description: 'Descripcion nueva',
    };

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: { action: 'update', role },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.role.name).toBe('Nombre Actualizado');
    expect(body.role.isTaken).toBe(true);
    expect(body.role.takenByUserId).toBe('user-2');
  });

  it('eliminar un rol en el stage (action: delete) lo remueve y limpia metadatos de participantes', async () => {
    const token = await tokenFor('user-1');
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'user-1',
      stageRoles: [{ id: 'role-del', name: 'Rol a Borrar' }],
    });
    m.roomParticipant.findUnique.mockResolvedValue({ role: 'HOST' });
    m.roomParticipant.findMany.mockResolvedValue([
      { id: 'part-1', metadata: { activeCharacter: { id: 'role-del' } } },
    ]);
    m.roomParticipant.update.mockResolvedValue({ id: 'part-1' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: { action: 'delete', roleId: 'role-del' },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('delete');
    expect(body.stageRoles).toEqual([]);
    expect(m.roomParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'part-1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({ activeCharacter: null }),
        }),
      })
    );
  });

  it('usuario sin permisos de moderador/host recibe 403 al crear o eliminar roles', async () => {
    const token = await tokenFor('user-guest');
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'user-host',
      stageRoles: [],
    });
    m.roomParticipant.findUnique.mockResolvedValue({ role: 'MEMBER' });

    const resCreate = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'create',
          role: { id: 'role-hack', name: 'Rol Ilegal' },
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(resCreate.status).toBe(403);

    const resDelete = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'delete',
          roleId: 'role-1',
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(resDelete.status).toBe(403);
  });

  it('patchSala persiste y devuelve rules actualizadas', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-1' });
    m.room.update.mockResolvedValue(
      baseRoom({
        rules: ['Regla 1: Respeto mutuo', 'Regla 2: Seguir el lore'],
      })
    );

    const res = await patchSala(
      jsonRequest('http://localhost/salas/room-1', {
        method: 'PATCH',
        token,
        body: { rules: ['Regla 1: Respeto mutuo', 'Regla 2: Seguir el lore'] },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toEqual(['Regla 1: Respeto mutuo', 'Regla 2: Seguir el lore']);
  });

  it('votePoll registra el voto en extensions y recalcula conteos', async () => {
    const token = await tokenFor();
    m.roomMessage.findUnique.mockResolvedValue({
      id: 'msg-poll-1',
      roomId: 'room-1',
      type: 'POLL',
      extensions: {
        question: '¿Cuál es tu clase favorita?',
        options: [
          { id: '0', text: 'Mago', votes: 1 },
          { id: '1', text: 'Guerrero', votes: 0 },
        ],
        votes: { 'user-other': '0' },
      },
    });
    m.roomMessage.update.mockResolvedValue({ id: 'msg-poll-1' });

    const res = await votePoll(
      jsonRequest('http://localhost/salas/room-1/messages/msg-poll-1/vote', {
        method: 'POST',
        token,
        body: { optionIndex: 1 },
      }),
      { params: Promise.resolve({ id: 'room-1', messageId: 'msg-poll-1' }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.userVotedOptionId).toBe('1');
    expect(body.userVotedOptionIndex).toBe(1);
    expect(body.totalVotes).toBe(2);
    expect(body.voteCounts).toEqual([1, 1]);
    expect(m.roomMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-poll-1' },
        data: expect.objectContaining({
          extensions: expect.objectContaining({
            totalVotes: 2,
            voteCounts: [1, 1],
          }),
        }),
      })
    );
  });

  it('patchMode realiza transición atómica de screening a roleplay limpiando cine y creando mensajes', async () => {
    const token = await tokenFor();
    const existingRoom = baseRoom({
      currentMode: 'screening',
      cinemaVideoId: 'video-123',
      cinemaState: 'PLAYING',
      cinemaCurrentTime: 42.5,
    });
    const updatedRoom = {
      ...existingRoom,
      currentMode: 'roleplay',
      cinemaVideoId: null,
      cinemaState: 'STOPPED',
      cinemaCurrentTime: 0,
    };

    m.room.findUnique.mockResolvedValue(existingRoom);
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'HOST' });
    m.room.update.mockResolvedValue(updatedRoom);

    const res = await patchMode(
      jsonRequest('http://localhost/salas/room-1/mode', {
        method: 'PATCH',
        token,
        body: { mode: 'roleplay' },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentMode).toBe('roleplay');
    expect(body.cinemaVideoId).toBeNull();
    expect(body.cinemaState).toBe('STOPPED');

    expect(m.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          currentMode: 'roleplay',
          cinemaVideoId: null,
          cinemaState: 'STOPPED',
          cinemaCurrentTime: 0,
        }),
      })
    );

    // Se crearon mensajes de sistema: fin de cine e inicio de roleplay
    expect(m.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: '[Sistema]: Sala de cine finalizada.',
          type: 'SYSTEM',
        }),
      })
    );
    expect(m.roomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: '[Sistema]: Sesión de roleplay iniciada.',
          type: 'SYSTEM',
        }),
      })
    );
  });

  it('patchMode al salir de roleplay a standard vacía atómicamente stageRoles y purga activeCharacter en participantes', async () => {
    const token = await tokenFor();
    const occupiedRoles = [
      {
        id: 'role-1',
        name: 'Guerrero',
        isTaken: true,
        isOccupied: true,
        takenByUserId: 'user-1',
        takenByUsername: 'user_one',
        occupiedBy: 'user-1',
        occupiedByName: 'user_one',
      },
      {
        id: 'role-2',
        name: 'Mago',
        isTaken: true,
        isOccupied: true,
        takenByUserId: 'user-2',
        takenByUsername: 'user_two',
        occupiedBy: 'user-2',
        occupiedByName: 'user_two',
      },
    ];

    const existingRoom = baseRoom({
      currentMode: 'roleplay',
      stageRoles: occupiedRoles,
      participants: [
        {
          id: 'part-1',
          user: author,
          role: 'HOST',
          joinedAt: new Date(),
          metadata: { activeCharacter: occupiedRoles[0] },
        },
      ],
    });

    const updatedRoom = {
      ...existingRoom,
      currentMode: 'standard',
      stageRoles: occupiedRoles.map((r) => ({
        ...r,
        isTaken: false,
        isOccupied: false,
        takenByUserId: null,
        takenByUsername: null,
        occupiedBy: null,
        occupiedByName: null,
      })),
    };

    m.room.findUnique.mockResolvedValue(existingRoom);
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'HOST' });
    m.room.update.mockResolvedValue(updatedRoom);

    const { _resetModeChangeCooldownForTesting } = await import('@/app/salas/[id]/mode/route');
    _resetModeChangeCooldownForTesting('room-1');

    const res = await patchMode(
      jsonRequest('http://localhost/salas/room-1/mode', {
        method: 'PATCH',
        token,
        body: { mode: 'standard' },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentMode).toBe('standard');

    // Verificar que room.update guardó los slots desocupados
    expect(m.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          currentMode: 'standard',
          stageRoles: expect.arrayContaining([
            expect.objectContaining({ id: 'slot-1', isTaken: false, takenByUserId: null }),
            expect.objectContaining({ id: 'slot-2', isTaken: false, takenByUserId: null }),
          ]),
        }),
      })
    );

    // Verificar que se limpió activeCharacter en el participante
    expect(m.roomParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'part-1' },
        data: { metadata: {} },
      })
    );

    _resetModeChangeCooldownForTesting('room-1');
  });

  it('patchMode rechaza con 429 si se intenta cambiar de modo dentro del cooldown de 3 s', async () => {
    const token = await tokenFor();
    const existingRoom = baseRoom({ currentMode: 'standard' });
    const updatedRoom = { ...existingRoom, currentMode: 'roleplay' };

    m.room.findUnique.mockResolvedValue(existingRoom);
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'HOST' });
    m.room.update.mockResolvedValue(updatedRoom);

    // Asegurarse de que el cooldown esté limpio antes de este test.
    const { _resetModeChangeCooldownForTesting } = await import('@/app/salas/[id]/mode/route');
    _resetModeChangeCooldownForTesting('room-1');

    // Primera petición: debe ser exitosa (200).
    const res1 = await patchMode(
      jsonRequest('http://localhost/salas/room-1/mode', {
        method: 'PATCH',
        token,
        body: { mode: 'roleplay' },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res1.status).toBe(200);

    // Restaurar mocks para la segunda llamada.
    m.room.findUnique.mockResolvedValue({ ...existingRoom, currentMode: 'roleplay' });

    // Segunda petición inmediata: debe ser rechazada con 429 (cooldown activo).
    const res2 = await patchMode(
      jsonRequest('http://localhost/salas/room-1/mode', {
        method: 'PATCH',
        token,
        body: { mode: 'voice' },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(res2.status).toBe(429);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/cooldown/i);

    // Limpiar para no afectar otros tests.
    _resetModeChangeCooldownForTesting('room-1');
  });

  it('updateStageRole rechaza nombres de más de 20 chars o descripciones mayores a 300', async () => {
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue(baseRoom());

    // Nombre mayor a 20 chars -> debe fallar 400
    const resNameOver = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'take',
          role: {
            id: 'role-1',
            name: 'NombreDemasiadoLargoQueExcedeVeinteCaracteres',
            tagline: 'Tagline normal',
            description: 'Desc normal',
          },
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(resNameOver.status).toBe(400);

    // Descripción mayor a 300 chars -> debe fallar 400
    const resDescOver = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'take',
          role: {
            id: 'role-1',
            name: 'Nombre Valido',
            tagline: 'Tagline normal',
            description: 'A'.repeat(301),
          },
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(resDescOver.status).toBe(400);

    // Rol canónico válido (20, 30, 300) -> pasa
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', metadata: {} });
    m.roomParticipant.update.mockResolvedValue({ id: 'part-1' });
    m.room.update.mockResolvedValue(baseRoom());
    m.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'user_one' });

    const resValid = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'take',
          role: {
            id: 'role-1',
            name: 'A'.repeat(20),
            tagline: 'B'.repeat(30),
            description: 'C'.repeat(300),
          },
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );
    expect(resValid.status).toBe(200);
  });

  it('updateStageRole con action: delete elimina el rol y limpia activeCharacter', async () => {
    const token = await tokenFor('host-1');
    m.room.findUnique.mockResolvedValue({
      id: 'room-1',
      status: 'ACTIVE',
      hostId: 'host-1',
      stageRoles: [
        { id: 'role-1', name: 'Role One' },
        { id: 'role-2', name: 'Role Two' },
      ],
    });
    m.roomParticipant.findUnique.mockResolvedValue({
      id: 'rp-host',
      role: 'HOST',
    });
    m.roomParticipant.findMany.mockResolvedValue([
      { id: 'rp-1', metadata: { activeCharacter: { id: 'role-1', name: 'Role One' } } },
      { id: 'rp-2', metadata: { activeCharacter: { id: 'role-2', name: 'Role Two' } } },
    ]);
    m.roomParticipant.update.mockResolvedValue({ id: 'rp-1' });
    m.room.update.mockResolvedValue({ id: 'room-1' });

    const res = await updateStageRole(
      jsonRequest('http://localhost/salas/room-1/stage/role', {
        method: 'POST',
        token,
        body: {
          action: 'delete',
          roleId: 'role-1',
        },
      }),
      { params: Promise.resolve({ id: 'room-1' }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.action).toBe('delete');
    expect(data.stageRoles).toEqual([{ id: 'role-2', name: 'Role Two' }]);
    expect(m.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { stageRoles: [{ id: 'role-2', name: 'Role Two' }] },
    });
    expect(m.roomParticipant.update).toHaveBeenCalledWith({
      where: { id: 'rp-1' },
      data: { metadata: { activeCharacter: null } },
    });
  });

  describe('interacción y mensajería en salas (reply, edición única y eliminación)', () => {
    it('enviar mensaje con replyToId resuelve y serializa la cita', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-quoted',
        body: 'Texto original de prueba',
        characterName: 'Zorro Sabio',
        sender: { displayName: 'Original Author', username: 'orig_author' },
      });
      m.roomMessage.create.mockResolvedValue({
        id: 'msg-2',
        roomId: 'room-1',
        senderId: 'user-1',
        type: 'TEXT',
        body: 'Respuesta al mensaje citado',
        characterId: null,
        characterName: null,
        characterAvatarUrl: null,
        extensions: {
          replyToId: 'msg-quoted',
          replyToName: 'Zorro Sabio',
          replyToBody: 'Texto original de prueba',
          replyTo: {
            id: 'msg-quoted',
            authorName: 'Zorro Sabio',
            content: 'Texto original de prueba',
          },
        },
        createdAt: new Date(),
        sender: author,
      });

      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Respuesta al mensaje citado',
            replyToId: 'msg-quoted',
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.replyToId).toBe('msg-quoted');
      expect(data.replyToName).toBe('Zorro Sabio');
      expect(data.replyToBody).toBe('Texto original de prueba');
      expect(data.replyTo.authorName).toBe('Zorro Sabio');
    });

    it('rechaza mensaje con mediaUrl de protocolo inseguro (javascript:, data:)', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });

      const resJs = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Hack url',
            mediaUrl: 'javascript:alert(1)',
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(resJs.status).toBe(400);

      const resData = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Hack data',
            mediaUrl: 'data:text/html,<script>alert(1)</script>',
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(resData.status).toBe(400);
    });

    it('acepta mensaje con mediaUrl válida http/https', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });
      m.roomMessage.create.mockResolvedValue({
        id: 'msg-media',
        roomId: 'room-1',
        senderId: 'user-1',
        type: 'IMAGE',
        body: 'https://example.com/imagen.png',
        characterId: null,
        characterName: null,
        characterAvatarUrl: null,
        extensions: { mediaUrl: 'https://example.com/imagen.png' },
        createdAt: new Date(),
        sender: author,
      });

      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            type: 'IMAGE',
            mediaUrl: 'https://example.com/imagen.png',
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(res.status).toBe(201);
    });

    it('rechaza mensaje con más de 5 adjuntos', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });

      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Muchos adjuntos',
            attachments: [
              'https://example.com/1.png',
              'https://example.com/2.png',
              'https://example.com/3.png',
              'https://example.com/4.png',
              'https://example.com/5.png',
              'https://example.com/6.png',
            ],
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('rechaza mensaje con adjunto de protocolo inseguro', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });

      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Adjunto malo',
            attachments: ['https://example.com/1.png', 'javascript:alert(1)'],
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('rechaza mensaje con extensions que superen 16KB', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });

      const largePayload = 'A'.repeat(17000);
      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Payload gigante',
            extensions: { bigData: largePayload },
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(res.status).toBe(400);
    });

    it('acepta mensaje con extensions de tamaño seguro (<= 16KB)', async () => {
      const token = await tokenFor();
      m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', hostId: 'user-1' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-1', role: 'MEMBER' });
      m.roomMessage.create.mockResolvedValue({
        id: 'msg-ext',
        roomId: 'room-1',
        senderId: 'user-1',
        type: 'TEXT',
        body: 'Payload seguro',
        characterId: null,
        characterName: null,
        characterAvatarUrl: null,
        extensions: { clientTempId: 'temp-123' },
        createdAt: new Date(),
        sender: author,
      });

      const res = await postMessage(
        jsonRequest('http://localhost/salas/room-1/messages', {
          method: 'POST',
          token,
          body: {
            content: 'Payload seguro',
            extensions: { clientTempId: 'temp-123' },
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );
      expect(res.status).toBe(201);
    });

    it('editar un mensaje por primera vez tiene éxito y marca isEdited=true, editCount=1', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'Mensaje original',
        extensions: {},
        sender: author,
      });
      m.roomMessage.update.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'msg-1',
          roomId: 'room-1',
          senderId: 'user-1',
          type: 'TEXT',
          body: data.body,
          characterId: null,
          characterName: null,
          characterAvatarUrl: null,
          extensions: data.extensions,
          createdAt: new Date(),
          sender: author,
        })
      );

      const res = await patchMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-1', {
          method: 'PATCH',
          token,
          body: { content: 'Mensaje editado correctamente' },
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.body).toBe('Mensaje editado correctamente');
      expect(data.isEdited).toBe(true);
      expect(data.editCount).toBe(1);
      expect(data.editedAt).toBeTruthy();
    });

    it('un segundo intento de edición es rechazado con 400', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'Mensaje ya editado',
        extensions: { isEdited: true, editCount: 1, editedAt: new Date().toISOString() },
        sender: author,
      });

      const res = await patchMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-1', {
          method: 'PATCH',
          token,
          body: { content: 'Segundo intento de edición' },
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-1' }) }
      );

      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.message || err.error).toBe('El mensaje ya ha sido editado previamente');
    });

    it('editar un mensaje creado hace más de 15 minutos es rechazado con 400', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
        body: 'Mensaje antiguo',
        extensions: {},
        createdAt: new Date(Date.now() - 16 * 60 * 1000), // 16 minutos atrás
        sender: author,
      });

      const res = await patchMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-1', {
          method: 'PATCH',
          token,
          body: { content: 'Intento de editar mensaje expirado' },
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-1' }) }
      );

      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.message || err.error).toBe('Solo puedes editar mensajes dentro de los primeros 15 minutos.');
    });

    it('editar un mensaje de otro usuario es rechazado con 403', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-other',
        body: 'Mensaje de otro usuario',
        extensions: {},
        sender: { id: 'user-other', username: 'other', displayName: 'Other' },
      });

      const res = await patchMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-1', {
          method: 'PATCH',
          token,
          body: { content: 'Intento no autorizado' },
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-1' }) }
      );

      expect(res.status).toBe(403);
    });

    it('eliminar un mensaje propio tiene éxito', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-1',
      });
      m.roomMessage.delete.mockResolvedValue({ id: 'msg-1' });

      const res = await deleteMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-1', {
          method: 'DELETE',
          token,
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.deletedMessageId).toBe('msg-1');
      expect(m.roomMessage.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } });
    });

    it('el host de la sala puede eliminar mensajes de otros participantes', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-other',
        roomId: 'room-1',
        senderId: 'user-other',
      });
      m.room.findUnique.mockResolvedValue({
        id: 'room-1',
        status: 'ACTIVE',
        hostId: 'user-1', // El usuario actual es el host
      });
      m.roomParticipant.findUnique.mockResolvedValue(null);
      m.roomMessage.delete.mockResolvedValue({ id: 'msg-other' });

      const res = await deleteMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-other', {
          method: 'DELETE',
          token,
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-other' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.deletedMessageId).toBe('msg-other');
    });

    it('un participante sin permisos no puede eliminar mensajes ajenos', async () => {
      const token = await tokenFor();
      m.roomMessage.findUnique.mockResolvedValue({
        id: 'msg-other',
        roomId: 'room-1',
        senderId: 'user-other',
      });
      m.room.findUnique.mockResolvedValue({
        id: 'room-1',
        status: 'ACTIVE',
        hostId: 'user-host',
      });
      m.roomParticipant.findUnique.mockResolvedValue({
        id: 'rp-1',
        role: 'MEMBER',
      });

      const res = await deleteMessage(
        jsonRequest('http://localhost/salas/room-1/messages/msg-other', {
          method: 'DELETE',
          token,
        }),
        { params: Promise.resolve({ id: 'room-1', messageId: 'msg-other' }) }
      );

      expect(res.status).toBe(403);
    });
  });

  describe('purga de roles fantasma y persistencia de tags', () => {
    it('serializeRoom purga roles corruptos sin id o con name vacío y expone tags', () => {
      const corruptRoom = baseRoom({
        tags: ['anime', 'rol'],
        stageRoles: [
          { id: 'role-valid', name: 'Guerrero', isTaken: false },
          { id: '', name: 'Fantasma' },
          { id: 'role-empty-name', name: '   ' },
          null,
          { name: 'Sin ID' },
        ],
      });

      const serialized = serializeRoom(corruptRoom as any);
      expect(serialized.stageRoles).toHaveLength(1);
      expect(serialized.stageRoles[0].id).toBe('role-valid');
      expect(serialized.stageRoles[0].name).toBe('Guerrero');
      expect(serialized.tags).toEqual(['anime', 'rol']);
    });

    it('patchSala actualiza tags sanitizando prefijos # y validando límite de 5', async () => {
      const token = await tokenFor('user-1');
      m.room.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
        status: 'ACTIVE',
      });
      const updated = baseRoom({
        tags: ['anime', 'rol', 'gaming', 'cosplay', 'manga'],
      });
      m.room.update.mockResolvedValue(updated);

      const res = await patchSala(
        jsonRequest('http://localhost/salas/room-1', {
          method: 'PATCH',
          token,
          body: {
            tags: ['#anime', ' rol ', '#gaming', 'cosplay', '#manga'],
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tags).toEqual(['anime', 'rol', 'gaming', 'cosplay', 'manga']);
      expect(m.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: ['anime', 'rol', 'gaming', 'cosplay', 'manga'],
          }),
        })
      );
    });

    it('patchSala rechaza más de 5 tags con 400', async () => {
      const token = await tokenFor('user-1');
      m.room.findUnique.mockResolvedValue({
        id: 'room-1',
        hostId: 'user-1',
        status: 'ACTIVE',
      });

      const res = await patchSala(
        jsonRequest('http://localhost/salas/room-1', {
          method: 'PATCH',
          token,
          body: {
            tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6'],
          },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(400);
    });
  });

  describe('invitaciones a salas', () => {
    it('GET /salas/invites devuelve salas con rol INVITED', async () => {
      const token = await tokenFor('user-guest');
      m.room.findMany.mockResolvedValue([
        baseRoom({ id: 'room-priv-1', name: 'Sala Privada VIP', access: 'PRIVATE' }),
      ]);

      const res = await getInvites(jsonRequest('http://localhost/salas/invites', { token }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('room-priv-1');
      expect(data.data[0].isParticipant).toBe(false);
    });

    it('POST /salas/[id]/invite/accept transiciona rol a PARTICIPANT y emite mensaje', async () => {
      const token = await tokenFor('user-guest');
      m.room.findUnique.mockResolvedValue(
        baseRoom({
          id: 'room-1',
          name: 'Sala Anime',
          status: 'ACTIVE',
          capacity: null,
          hostId: 'user-host',
          participants: [{ user: { id: 'user-guest', username: 'guest', displayName: 'Guest User', avatarUrl: null }, role: 'PARTICIPANT', joinedAt: new Date() }],
        })
      );
      m.roomParticipant.findUnique.mockResolvedValue({
        id: 'part-1',
        roomId: 'room-1',
        userId: 'user-guest',
        role: 'INVITED',
      });
      m.roomParticipant.update.mockResolvedValue({
        id: 'part-1',
        role: 'PARTICIPANT',
      });
      m.user.findUnique.mockResolvedValue({
        id: 'user-guest',
        username: 'guest',
        displayName: 'Guest User',
      });
      m.roomMessage.create.mockResolvedValue({
        id: 'msg-1',
        roomId: 'room-1',
        senderId: 'user-guest',
        type: 'SYSTEM',
        body: 'Guest User aceptó la invitación y se unió.',
        createdAt: new Date(),
        sender: { id: 'user-guest', username: 'guest', displayName: 'Guest User', avatarUrl: null },
      });

      const res = await acceptInvite(
        jsonRequest('http://localhost/salas/room-1/invite/accept', { method: 'POST', token }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      expect(m.roomParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'part-1' },
          data: expect.objectContaining({ role: 'PARTICIPANT' }),
        })
      );
    });

    it('POST /salas/[id]/invite/reject elimina rol INVITED', async () => {
      const token = await tokenFor('user-guest');
      m.roomParticipant.findUnique.mockResolvedValue({
        id: 'part-1',
        roomId: 'room-1',
        userId: 'user-guest',
        role: 'INVITED',
      });
      m.roomParticipant.delete.mockResolvedValue({ id: 'part-1' });

      const res = await rejectInvite(
        jsonRequest('http://localhost/salas/room-1/invite/reject', { method: 'POST', token }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(m.roomParticipant.delete).toHaveBeenCalledWith({ where: { id: 'part-1' } });
    });

    it('PATCH /salas/[id] permite a moderador modificar la sala', async () => {
      const token = await tokenFor('user-mod');
      m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-host' });
      m.roomParticipant.findUnique.mockResolvedValue({ id: 'part-mod', role: 'MODERATOR' });
      m.room.update.mockResolvedValue(baseRoom({ name: 'Sala Modificada por Mod' }));

      const res = await patchSala(
        jsonRequest('http://localhost/salas/room-1', {
          method: 'PATCH',
          token,
          body: { name: 'Sala Modificada por Mod' },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
    });

    it('POST /salas/[id]/roles/occupy asigna la ficha de rol al slot indicado', async () => {
      const token = await tokenFor('user-1');
      const existingRoom = baseRoom({
        stageRoles: [
          { id: 'slot-1', name: 'Guerrero', isTaken: false, isOccupied: false },
          { id: 'slot-2', name: 'Mago', isTaken: false, isOccupied: false },
        ],
      });

      m.room.findUnique.mockResolvedValue(existingRoom);
      m.character.findFirst.mockResolvedValue({
        id: 'char-1',
        name: 'Kaelen',
        avatarUrl: 'https://cdn.kyubi.app/kaelen.png',
        tagline: 'Caballero Errante',
        description: 'Espadachín veterano',
        themeColor: '#FFD600',
        userId: 'user-1',
      });
      m.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'user_one', displayName: 'User One' });
      m.room.update.mockResolvedValue(existingRoom);
      m.roomParticipant.updateMany?.mockResolvedValue({ count: 1 });

      const res = await occupyRole(
        jsonRequest('http://localhost/salas/room-1/roles/occupy', {
          method: 'POST',
          token,
          body: { slotIndex: 1, roleSheetId: 'char-1' },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.slotIndex).toBe(1);
      expect(data.role).toMatchObject({
        id: 'char-1',
        name: 'Kaelen',
        isTaken: true,
        takenByUserId: 'user-1',
      });
      expect(m.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-1' },
          data: expect.objectContaining({
            stageRoles: expect.arrayContaining([
              expect.objectContaining({ id: 'char-1', name: 'Kaelen', isTaken: true }),
            ]),
          }),
        })
      );
    });

    it('POST /salas/[id]/roles/occupy permite múltiples slots al mismo usuario y busca primer slot libre sin slotIndex', async () => {
      const token = await tokenFor('user-1');
      const existingRoom = baseRoom({
        stageRoles: [
          { id: 'slot-prev', name: 'Anterior', isTaken: true, takenByUserId: 'user-1' },
          { id: 'slot-2', name: 'Mago', isTaken: false, isOccupied: false },
        ],
      });

      m.room.findUnique.mockResolvedValue(existingRoom);
      m.character.findFirst.mockResolvedValue({
        id: 'char-2',
        name: 'Lyra',
        avatarUrl: null,
        tagline: 'Hechicera',
        description: '',
        themeColor: '#00E5FF',
        userId: 'user-1',
      });
      m.user.findUnique.mockResolvedValue({ id: 'user-1', username: 'user_one', displayName: 'User One' });
      m.room.update.mockResolvedValue(existingRoom);
      m.roomParticipant.updateMany?.mockResolvedValue({ count: 1 });

      const res = await occupyRole(
        jsonRequest('http://localhost/salas/room-1/roles/occupy', {
          method: 'POST',
          token,
          body: { roleSheetId: 'char-2' },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      // El slot previo no se libera: se preserva en el índice 0 y el nuevo personaje ocupa el índice 1
      expect(data.slotIndex).toBe(1);
      expect(data.stageRoles[0].isTaken).toBe(true);
      expect(data.stageRoles[0].takenByUserId).toBe('user-1');
      expect(data.stageRoles[1].isTaken).toBe(true);
      expect(data.stageRoles[1].takenByUserId).toBe('user-1');
      expect(data.role.name).toBe('Lyra');
    });

    it('POST /salas/[id]/roles/occupy rechaza con 409 Conflict si otro usuario intenta ocupar un slot tomado', async () => {
      const token = await tokenFor('user-2');
      const existingRoom = baseRoom({
        stageRoles: [
          { id: 'slot-1', name: 'Guerrero', isTaken: true, takenByUserId: 'user-1', occupiedBy: 'user-1' },
          { id: 'slot-2', name: 'Mago', isTaken: false, isOccupied: false },
        ],
      });

      m.room.findUnique.mockResolvedValue(existingRoom);
      m.character.findFirst.mockResolvedValue({
        id: 'char-other',
        name: 'Sombra',
        avatarUrl: null,
        tagline: 'Pícaro',
        description: '',
        themeColor: '#9C27B0',
        userId: 'user-2',
      });
      m.user.findUnique.mockResolvedValue({ id: 'user-2', username: 'user_two', displayName: 'User Two' });

      const res = await occupyRole(
        jsonRequest('http://localhost/salas/room-1/roles/occupy', {
          method: 'POST',
          token,
          body: { slotIndex: 0, roleSheetId: 'char-other' },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe('Este espacio del stage ya está ocupado');
    });

    it('POST /salas/[id]/roles/leave con slotIndex desocupa solo esa casilla y preserva otros slots del usuario', async () => {
      const token = await tokenFor('user-1');
      const existingRoom = baseRoom({
        stageRoles: [
          { id: 'slot-1', name: 'Guerrero', isTaken: true, takenByUserId: 'user-1' },
          { id: 'slot-2', name: 'Mago', isTaken: true, takenByUserId: 'user-1' },
        ],
      });

      m.room.findUnique.mockResolvedValue(existingRoom);
      m.room.update.mockResolvedValue(existingRoom);
      m.roomParticipant.findUnique.mockResolvedValue({
        id: 'rp-1',
        roomId: 'room-1',
        userId: 'user-1',
        metadata: { activeCharacter: { id: 'slot-1' } },
      });
      m.roomParticipant.update.mockResolvedValue({ id: 'rp-1' });

      const res = await leaveRole(
        jsonRequest('http://localhost/salas/room-1/roles/leave', {
          method: 'POST',
          token,
          body: { slotIndex: 0 },
        }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.slotIndex).toBe(0);
      // El slot 0 debe estar vacante, mientras el slot 1 sigue ocupado por user-1
      expect(data.stageRoles[0].isTaken).toBe(false);
      expect(data.stageRoles[1].isTaken).toBe(true);
      expect(data.stageRoles[1].takenByUserId).toBe('user-1');
      // activeCharacter debe reasignarse al rol restante
      expect(m.roomParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              activeCharacter: expect.objectContaining({ id: 'slot-2' }),
            }),
          }),
        })
      );
    });

    it('GET /salas/[id] purga defensivamente personajes eliminados de stageRoles', async () => {
      const token = await tokenFor('user-1');
      const ghostRoom = baseRoom({
        stageRoles: [
          { id: 'char-deleted', name: 'Fantasma', isTaken: true, takenByUserId: 'user-2' },
          { id: 'slot-2', name: 'Slot 2', isTaken: false },
        ],
      });

      m.room.findUnique.mockResolvedValue(ghostRoom);
      m.character.findMany.mockResolvedValue([]); // Ningún personaje existe en DB
      m.room.update.mockResolvedValue(ghostRoom);

      const res = await getSala(
        jsonRequest('http://localhost/salas/room-1', { token }),
        { params: Promise.resolve({ id: 'room-1' }) }
      );

      expect(res.status).toBe(200);
      expect(m.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-1' },
          data: expect.objectContaining({
            stageRoles: expect.arrayContaining([
              expect.objectContaining({ id: 'slot-1', isTaken: false }),
            ]),
          }),
        })
      );
    });

    it('DELETE /characters/[id] purga referencias al personaje en las salas activas', async () => {
      const token = await tokenFor('user-1');
      m.character.findUnique.mockResolvedValue({ id: 'char-to-delete', userId: 'user-1' });
      m.character.delete.mockResolvedValue({ id: 'char-to-delete' });
      m.room.findMany.mockResolvedValue([
        baseRoom({
          id: 'room-active',
          stageRoles: [
            { id: 'char-to-delete', name: 'Muerto', isTaken: true, takenByUserId: 'user-1' },
          ],
        }),
      ]);
      m.room.update.mockResolvedValue({});
      m.roomParticipant.findMany.mockResolvedValue([
        { id: 'rp-1', roomId: 'room-active', metadata: { activeCharacter: { id: 'char-to-delete' } } },
      ]);
      m.roomParticipant.update.mockResolvedValue({});

      const res = await deleteCharacter(
        jsonRequest('http://localhost/characters/char-to-delete', { method: 'DELETE', token }),
        { params: Promise.resolve({ id: 'char-to-delete' }) }
      );

      expect(res.status).toBe(200);
      expect(m.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'room-active' },
          data: expect.objectContaining({
            stageRoles: expect.arrayContaining([
              expect.objectContaining({ id: 'slot-1', isTaken: false }),
            ]),
          }),
        })
      );
    });
  });
});
