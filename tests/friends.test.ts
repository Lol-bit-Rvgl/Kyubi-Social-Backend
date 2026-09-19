import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  const build = () => ({
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    verificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    passwordResetToken: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    follow: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    followRequest: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    reaction: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    circle: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    circleMember: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    room: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    roomParticipant: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    ban: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    mute: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    moderationLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    report: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn((items: unknown[]) => Promise.all(items)),
  });
  return build;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

import { prisma } from '@/lib/prisma';
import { GET as listFriends } from '@/app/users/friends/route';

const m = prisma as unknown as PrismaMock;

const me = baseUser();
const ME_ID = me.id;

async function tokenFor(user = me) {
  return signAccessToken({
    userId: user.id,
    email: user.email,
    username: user.username,
  });
}

function friendRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'friend-1',
    username: 'friend_one',
    displayName: 'Friend One',
    avatarUrl: 'https://cdn.kyubi.app/avatars/friend_one.png',
    bio: 'Amistad bilateral',
    usernameColor: '#BA68C8',
    avatarFrame: null,
    level: 7,
    isOnline: true,
    ...overrides,
  };
}

/**
 * Implementación determinista de las dos consultas `follow.findMany`:
 * la primera (where.followerId) son los seguidos y la segunda
 * (where.followingId) los seguidores.
 */
function setFollowQueries({
  following = [],
  followers = [],
}: {
  following?: Array<{ followingId: string; createdAt: Date }>;
  followers?: Array<{ followerId: string }>;
} = {}) {
  m.follow.findMany.mockImplementation(
    async (args: { where?: Record<string, unknown> } = {}) => {
      const where = args.where ?? {};
      if (where.followerId) return following;
      if (where.followingId) return followers;
      return [];
    },
  );
}
describe('GET /users/friends — seguimiento mutuo bilateral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFollowQueries();
    m.user.findMany.mockResolvedValue([]);
  });

  it('401 sin sesión', async () => {
    const res = await listFriends(jsonRequest('http://localhost/users/friends'));
    expect(res.status).toBe(401);
    expect(m.follow.findMany).not.toHaveBeenCalled();
  });

  it('devuelve solo amigos mutuos y excluye seguimientos unidireccionales', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [
        // Mutuo: yo lo sigo y él me sigue.
        { followingId: 'friend-1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
        // Unidireccional: yo lo sigo, pero él NO me sigue.
        { followingId: 'stranger-1', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ],
      followers: [
        { followerId: 'friend-1' },
        // Unidireccional: me sigue, pero yo NO lo sigo.
        { followerId: 'admirer-1' },
      ],
    });
    m.user.findMany.mockResolvedValue([friendRow()]);

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends', { token }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: 'friend-1',
      username: 'friend_one',
      displayName: 'Friend One',
      avatarUrl: 'https://cdn.kyubi.app/avatars/friend_one.png',
      bio: 'Amistad bilateral',
      usernameColor: '#BA68C8',
      level: 7,
      isOnline: true,
      isFriend: true,
    });
    expect(body.items[0].lastSeen).toBeNull();
    expect(body.items[0].friendsSince).toBe('2026-01-01T00:00:00.000Z');

    // Las dos hipótesis del seguimiento se consultan por separado.
    expect(m.follow.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { followerId: ME_ID } }),
    );
    expect(m.follow.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { followingId: ME_ID } }),
    );

    // Solo el id mutuo llega a la consulta de usuarios.
    expect(m.user.findMany).toHaveBeenCalledTimes(1);
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['friend-1'] } } }),
    );
  });
it('devuelve lista vacía cuando todos los seguimientos son unidireccionales', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [
        { followingId: 'stranger-1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      ],
      followers: [{ followerId: 'admirer-1' }],
    });

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends', { token }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0 });
    expect(m.user.findMany).not.toHaveBeenCalled();
  });

  it('devuelve lista vacía sin consultar usuarios si no sigue a nadie', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [],
      followers: [{ followerId: 'admirer-1' }],
    });

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends', { token }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], total: 0 });
    expect(m.follow.findMany).toHaveBeenCalledTimes(1);
    expect(m.user.findMany).not.toHaveBeenCalled();
  });

  it('ordena por amistad más reciente (Follow.createdAt desc)', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [
        { followingId: 'friend-old', createdAt: new Date('2026-02-01T00:00:00.000Z') },
        { followingId: 'friend-new', createdAt: new Date('2026-03-01T00:00:00.000Z') },
      ],
      followers: [{ followerId: 'friend-old' }, { followerId: 'friend-new' }],
    });
    m.user.findMany.mockResolvedValue([
      friendRow({ id: 'friend-old', username: 'old_friend' }),
      friendRow({ id: 'friend-new', username: 'new_friend' }),
    ]);

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends', { token }),
    );

    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([
      'friend-new',
      'friend-old',
    ]);
  });

  it('excluye al propio usuario aunque exista un auto-follow', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [
        { followingId: ME_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') },
        { followingId: 'friend-1', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      ],
      followers: [{ followerId: ME_ID }, { followerId: 'friend-1' }],
    });
    m.user.findMany.mockResolvedValue([friendRow()]);

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends', { token }),
    );

    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['friend-1']);
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['friend-1'] } } }),
    );
  });

  it('respeta el límite: limit=1 devuelve un solo amigo y limit=0 se clampea a 1', async () => {
    const token = await tokenFor();
    setFollowQueries({
      following: [
        { followingId: 'friend-a', createdAt: new Date('2026-03-02T00:00:00.000Z') },
        { followingId: 'friend-b', createdAt: new Date('2026-03-01T00:00:00.000Z') },
      ],
      followers: [{ followerId: 'friend-a' }, { followerId: 'friend-b' }],
    });
    m.user.findMany.mockResolvedValue([
      friendRow({ id: 'friend-a' }),
      friendRow({ id: 'friend-b' }),
    ]);

    const res = await listFriends(
      jsonRequest('http://localhost/users/friends?limit=1', { token }),
    );

    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('friend-a');
    expect(body.total).toBe(1);

    const clamped = await listFriends(
      jsonRequest('http://localhost/users/friends?limit=0', { token }),
    );
    const clampedBody = await clamped.json();
    expect(clampedBody.items).toHaveLength(1);
  });
});
