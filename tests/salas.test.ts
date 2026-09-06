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
      room: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
      roomParticipant: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
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
import { GET as listSalas, POST as createSala } from '@/app/salas/route';
import { GET as getSala, PATCH as patchSala, DELETE as deleteSala } from '@/app/salas/[id]/route';
import { POST as joinSala } from '@/app/salas/[id]/join/route';
import { POST as leaveSala } from '@/app/salas/[id]/leave/route';

const m = prisma as unknown as PrismaMock;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const user = baseUser();

async function tokenFor() {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
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

  it('GET lista no muestra salas PRIVATE de círculo ajeno', async () => {
    const token = await tokenFor();
    m.roomParticipant.findMany.mockResolvedValue([]);
    m.room.findMany.mockResolvedValue([]);
    m.room.count.mockResolvedValue(0);

    const res = await listSalas(jsonRequest('http://localhost/salas?circleId=circle-1', { token }));
    expect(res.status).toBe(200);
    expect(m.circleMember.findUnique).toHaveBeenCalled();
    expect(m.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({ access: 'PUBLIC' })]),
        }),
      }),
    );
  });

  it('GET exploración general solo muestra salas públicas o propias', async () => {
    const token = await tokenFor();
    m.roomParticipant.findMany.mockResolvedValue([]);
    m.room.findMany.mockResolvedValue([]);
    m.room.count.mockResolvedValue(0);

    const res = await listSalas(jsonRequest('http://localhost/salas', { token }));
    expect(res.status).toBe(200);
    expect(m.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { access: 'PUBLIC' },
                { participants: { some: { userId: 'user-1' } } },
              ]),
            }),
          ]),
        }),
      }),
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
    const token = await tokenFor();
    m.room.findUnique.mockResolvedValue(baseRoom({ access: 'PRIVATE', circleId: 'circle-1' }));
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.circleMember.findUnique.mockResolvedValue(null);

    const denied = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(denied.status).toBe(403);

    m.circleMember.findUnique.mockResolvedValue({ id: 'cm-1' });
    const allowed = await getSala(jsonRequest('http://localhost/salas/room-1', { token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(allowed.status).toBe(200);
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
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', access: 'PUBLIC', capacity: null, circleId: null });
    m.roomParticipant.findUnique.mockResolvedValue(null);
    m.roomParticipant.create.mockResolvedValue({ id: 'rp-2' });
    m.room.findUnique.mockResolvedValue(baseRoom({ _count: { participants: 2 } }));

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
    m.room.findUnique.mockResolvedValue({ id: 'room-1', status: 'ACTIVE', access: 'PUBLIC', capacity: null, circleId: null });
    m.roomParticipant.findUnique.mockResolvedValue({ id: 'rp-1' });
    m.room.findUnique.mockResolvedValue(baseRoom());

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
});
