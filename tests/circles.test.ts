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
import { GET as listCircles, POST as createCircle } from '@/app/circles/route';
import { GET as myCircles } from '@/app/circles/my-circles/route';
import { GET as mineCircles } from '@/app/circles/mine/route';
import { GET as searchCircles } from '@/app/circles/search/route';
import { GET as getCircle, PATCH as patchCircle, DELETE as deleteCircle } from '@/app/circles/[circleId]/route';
import { POST as joinCircle } from '@/app/circles/[circleId]/join/route';
import { POST as leaveCircle } from '@/app/circles/[circleId]/leave/route';
import { GET as listCirclePosts, POST as createCirclePost } from '@/app/circles/[circleId]/posts/route';

const m = prisma as unknown as PrismaMock;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const user = baseUser();

async function tokenFor() {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

function baseCircle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'circle-1',
    name: 'Anime Club',
    description: 'Club de anime',
    avatarUrl: null,
    bannerUrl: null,
    isPrivate: false,
    creatorId: 'user-1',
    creator: author,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { members: 1, posts: 0, rooms: 0 },
    ...overrides,
  };
}

describe('círculos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin sesión', async () => {
    const res = await listCircles(jsonRequest('http://localhost/circles'));
    expect(res.status).toBe(401);
  });

  it('GET lista círculos públicos con isMember', async () => {
    const token = await tokenFor();
    m.circle.findMany.mockResolvedValue([baseCircle()]);
    m.circle.count.mockResolvedValue(1);
    m.circleMember.findMany.mockResolvedValue([{ circleId: 'circle-1', role: 'MEMBER' }]);

    const res = await listCircles(jsonRequest('http://localhost/circles', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Anime Club');
    expect(body.data[0].isMember).toBe(true);
    expect(m.circle.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isPrivate: false }) }));
  });

  it('POST crea círculo y convierte al autor en OWNER', async () => {
    const token = await tokenFor();
    m.circle.create.mockResolvedValue(baseCircle({ _count: { members: 1, posts: 0, rooms: 0 } }));

    const res = await createCircle(jsonRequest('http://localhost/circles', { method: 'POST', body: { name: 'Anime Club' }, token }));
    expect(res.status).toBe(201);
    expect(m.circle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Anime Club',
          creatorId: 'user-1',
          members: { create: { userId: 'user-1', role: 'OWNER' } },
        }),
      })
    );
  });

  it('POST 400 con nombre vacío', async () => {
    const token = await tokenFor();
    const res = await createCircle(jsonRequest('http://localhost/circles', { method: 'POST', body: { name: '  ' }, token }));
    expect(res.status).toBe(400);
  });

  it('GET my-circles devuelve solo los círculos del usuario', async () => {
    const token = await tokenFor();
    m.circleMember.findMany.mockResolvedValue([{ circleId: 'circle-1', role: 'ADMIN' }]);
    m.circle.findMany.mockResolvedValue([baseCircle()]);
    m.circle.count.mockResolvedValue(1);

    const res = await myCircles(jsonRequest('http://localhost/circles/my-circles', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe('circle-1');
    expect(body.data[0].role).toBe('ADMIN');
  });

  it('GET /circles/mine devuelve círculos del usuario incluyendo privados', async () => {
    const token = await tokenFor();
    const privCircle = baseCircle({ id: 'priv-1', name: 'Círculo Oculto', isPrivate: true, creatorId: user.id });
    m.circleMember.findMany.mockResolvedValue([]);
    m.circle.findMany.mockResolvedValue([privCircle]);
    m.circle.count.mockResolvedValue(1);

    const res = await mineCircles(jsonRequest('http://localhost/circles/mine', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].id).toBe('priv-1');
    expect(body.data[0].isPrivate).toBe(true);
    expect(body.data[0].role).toBe('OWNER');
    expect(m.circle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { creatorId: user.id },
            { members: { some: { userId: user.id } } },
          ]),
        }),
      })
    );
  });

  it('GET search con q filtra por nombre', async () => {
    const token = await tokenFor();
    m.circle.findMany.mockResolvedValue([baseCircle()]);
    m.circleMember.findMany.mockResolvedValue([]);

    const res = await searchCircles(jsonRequest('http://localhost/circles/search?q=anime', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].name).toBe('Anime Club');
  });

  it('GET search sin q devuelve vacío sin consultar', async () => {
    const token = await tokenFor();
    const res = await searchCircles(jsonRequest('http://localhost/circles/search?q=', { token }));
    const body = await res.json();
    expect(body.data).toHaveLength(0);
    expect(m.circle.findMany).not.toHaveBeenCalled();
  });

  it('GET detalle devuelve miembros; 403 si círculo privado sin membresía', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue(baseCircle({ members: [{ user: author, role: 'OWNER', joinedAt: new Date() }] }));
    m.circleMember.findUnique.mockResolvedValue(null);

    const res = await getCircle(jsonRequest('http://localhost/circles/circle-1', { token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);

    m.circle.findUnique.mockResolvedValue(baseCircle({ isPrivate: true }));
    const priv = await getCircle(jsonRequest('http://localhost/circles/circle-1', { token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(priv.status).toBe(403);
  });

  it('PATCH 403 si no es OWNER/ADMIN', async () => {
    const token = await tokenFor();
    m.circleMember.findUnique.mockResolvedValue({ role: 'MEMBER' });

    const res = await patchCircle(jsonRequest('http://localhost/circles/circle-1', { method: 'PATCH', body: { name: 'Otro' }, token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(403);
  });

  it('DELETE solo el OWNER', async () => {
    const token = await tokenFor();
    m.circleMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    const res = await deleteCircle(jsonRequest('http://localhost/circles/circle-1', { method: 'DELETE', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(403);

    m.circleMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    m.circle.delete.mockResolvedValue({ id: 'circle-1' });
    const okRes = await deleteCircle(jsonRequest('http://localhost/circles/circle-1', { method: 'DELETE', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(okRes.status).toBe(200);
  });

  it('unirse crea membresía MEMBER en círculo público', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', isPrivate: false });
    m.circleMember.findUnique.mockResolvedValue(null);
    m.circleMember.create.mockResolvedValue({ id: 'cm-1' });
    m.circle.findUnique.mockResolvedValue(baseCircle({ _count: { members: 2, posts: 0, rooms: 0 } }));

    const res = await joinCircle(jsonRequest('http://localhost/circles/circle-1/join', { method: 'POST', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(200);
    expect(m.circleMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ circleId: 'circle-1', userId: 'user-1', role: 'MEMBER' }) })
    );
    const body = await res.json();
    expect(body.isMember).toBe(true);
  });

  it('unirse a círculo privado sin membresía da 403', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', isPrivate: true });
    m.circleMember.findUnique.mockResolvedValue(null);
    const res = await joinCircle(jsonRequest('http://localhost/circles/circle-1/join', { method: 'POST', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(403);
  });

  it('salir elimina membresía; el OWNER no puede salir', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1' });

    m.circleMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    const ownerRes = await leaveCircle(jsonRequest('http://localhost/circles/circle-1/leave', { method: 'POST', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(ownerRes.status).toBe(400);

    m.circleMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    m.circleMember.delete.mockResolvedValue({ id: 'cm-1' });
    m.circle.findUnique.mockResolvedValue(baseCircle());
    const res = await leaveCircle(jsonRequest('http://localhost/circles/circle-1/leave', { method: 'POST', token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(200);
    expect(m.circleMember.delete).toHaveBeenCalled();
  });

  it('posts: GET lista posts del círculo; POST requiere membresía', async () => {
    const token = await tokenFor();
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', isPrivate: false });
    m.circleMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    m.post.findMany.mockResolvedValue([]);
    m.post.count.mockResolvedValue(0);
    m.reaction.findMany.mockResolvedValue([]);

    const listRes = await listCirclePosts(jsonRequest('http://localhost/circles/circle-1/posts', { token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(listRes.status).toBe(200);

    m.circleMember.findUnique.mockResolvedValue(null);
    const noMember = await createCirclePost(jsonRequest('http://localhost/circles/circle-1/posts', { method: 'POST', body: { body: 'Hola' }, token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(noMember.status).toBe(403);

    m.circleMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
    m.post.create.mockResolvedValue({
      id: 'post-1', authorId: 'user-1', author, content: 'Hola', visibility: 'CIRCLE', circleId: 'circle-1', createdAt: new Date(),
      reactions: [], comments: [], _count: { comments: 0, reactions: 0 }, views: 0, shares: 0, updatedAt: new Date(), publishedAt: new Date(),
    });
    const res = await createCirclePost(jsonRequest('http://localhost/circles/circle-1/posts', { method: 'POST', body: { body: 'Hola' }, token }), { params: Promise.resolve({ circleId: 'circle-1' }) });
    expect(res.status).toBe(201);
    expect(m.post.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ circleId: 'circle-1', visibility: 'CIRCLE' }) }));
  });
});
