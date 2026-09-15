import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  const build = () => ({
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
    $queryRawUnsafe: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn((items: unknown[]) => Promise.all(items)),
  });
  return build;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

import { prisma } from '@/lib/prisma';
import { GET as search } from '@/app/search/route';
import { GET as trending } from '@/app/search/trending/route';
import { GET as suggest } from '@/app/search/suggest/route';

const m = prisma as unknown as PrismaMock;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const authorUser = baseUser();

async function tokenFor(user = authorUser) {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

// ── Helpers to build raw rows ──────────────────────────────────────────

function postRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    content: 'Hola mundo',
    title: null,
    tags: [],
    coverImageUrl: null,
    authorId: 'user-1',
    authorName: 'User One',
    authorUsername: 'user_one',
    authorAvatar: null,
    rank: 0.5,
    ...overrides,
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-2',
    username: 'user_two',
    displayName: 'User Two',
    avatarUrl: null,
    bio: null,
    usernameColor: null,
    avatarFrame: null,
    level: 1,
    isOnline: false,
    rank: 0.8,
    ...overrides,
  };
}

function roomRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    name: 'Sala de Anime',
    description: 'Hablamos de anime',
    imageUrl: null,
    hostName: 'User One',
    participantCount: 5,
    rank: 0.9,
    ...overrides,
  };
}

// ── GET /search ─────────────────────────────────────────────────────────

describe('GET /search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.circle.findMany.mockResolvedValue([]);
    m.circleMember.findMany.mockResolvedValue([]);
  });

  it('401 sin sesión', async () => {
    const res = await search(jsonRequest('http://localhost/search?q=hola'));
    expect(res.status).toBe(401);
  });

  it('devuelve resultados vacíos cuando q < 1 caracter', async () => {
    const token = await tokenFor();
    const res = await search(
      jsonRequest('http://localhost/search?q=&type=all', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.posts).toEqual([]);
    expect(body.users).toEqual([]);
    expect(body.rooms).toEqual([]);
    expect(body.circles).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.query).toBe('');
    expect(body.type).toBe('all');
    expect(m.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('aplica límite por defecto (20) y offset 0', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([]);
    m.follow.findMany.mockResolvedValue([]);

    const res = await search(
      jsonRequest('http://localhost/search?q=hola&type=all', { token }),
    );
    expect(res.status).toBe(200);
  });

  it('busca publicaciones (type=posts) con full-text + ILIKE fallback', async () => {
    const token = await tokenFor();

    m.$queryRawUnsafe
      .mockResolvedValueOnce([postRow({ id: 'post-ts' })])
      .mockResolvedValueOnce([postRow({ id: 'post-like' })]);

    const res = await search(
      jsonRequest('http://localhost/search?q=hola&type=posts&limit=20&offset=0', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(2);
    expect(body.users).toEqual([]);
    expect(body.rooms).toEqual([]);
    expect(body.total).toBe(2);
    expect(m.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it('busca publicaciones con suficientes resultados full-text (sin ILIKE)', async () => {
    const token = await tokenFor();

    m.$queryRawUnsafe.mockResolvedValueOnce([
      postRow({ id: 'post-1' }),
      postRow({ id: 'post-2' }),
      postRow({ id: 'post-3' }),
      postRow({ id: 'post-4' }),
      postRow({ id: 'post-5' }),
    ]);

    const res = await search(
      jsonRequest('http://localhost/search?q=hola&type=posts&limit=20&offset=0', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(5);
    expect(m.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('busca usuarios (type=users) con estado de follow', async () => {
    const token = await tokenFor();

    m.$queryRawUnsafe
      .mockResolvedValueOnce([userRow({ id: 'user-2' })])
      .mockResolvedValueOnce([userRow({ id: 'user-3' })]);

    m.follow.findMany.mockResolvedValue([{ followingId: 'user-3' }]);

    const res = await search(
      jsonRequest('http://localhost/search?q=user&type=users&limit=20&offset=0', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0].id).toBe('user-2');
    expect(body.users[0].isFollowing).toBe(false);
    expect(body.users[1].id).toBe('user-3');
    expect(body.users[1].isFollowing).toBe(true);
    expect(body.posts).toEqual([]);
    expect(body.rooms).toEqual([]);
  });

  it('no llama follow.findMany cuando no hay usuarios', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([]);

    const res = await search(
      jsonRequest('http://localhost/search?q=ghost&type=users&limit=20&offset=0', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(m.follow.findMany).not.toHaveBeenCalled();
    });

  it('busca salas (type=rooms) con full-text + ILIKE fallback', async () => {
    const token = await tokenFor();

    m.$queryRawUnsafe
      .mockResolvedValueOnce([roomRow({ id: 'room-ts' })])
      .mockResolvedValueOnce([roomRow({ id: 'room-like' })]);

    const res = await search(
      jsonRequest('http://localhost/search?q=anime&type=rooms&limit=20&offset=0', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rooms).toHaveLength(2);
    expect(body.posts).toEqual([]);
    expect(body.users).toEqual([]);
    expect(body.rooms[0].name).toBe('Sala de Anime');
  });
});

// ── GET /search/trending ─────────────────────────────────────────────────

describe('GET /search/trending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin sesión', async () => {
    const res = await trending(jsonRequest('http://localhost/search/trending'));
    expect(res.status).toBe(401);
  });

  it('devuelve tags en tendencia ordenados por popularidad', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([
      { tag: 'anime', uses: 42 },
      { tag: 'roleplay', uses: 18 },
    ]);

    const res = await trending(
      jsonRequest('http://localhost/search/trending', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].tag).toBe('anime');
    expect(body.data[0].uses).toBe(42);
    expect(body.data[1].tag).toBe('roleplay');
    expect(body.data[1].uses).toBe(18);
    expect(body.trends).toHaveLength(2);
    expect(body.trending).toHaveLength(2);
  });

  it('valida límite: 999 se clampea a 30', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([]);

    const res = await trending(
      jsonRequest('http://localhost/search/trending?limit=999', { token }),
    );
    expect(res.status).toBe(200);
    expect(m.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      30,
    );
  });

  it('valida límite: 0 se clampea a 1', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([]);

    const res = await trending(
      jsonRequest('http://localhost/search/trending?limit=0', { token }),
    );
    expect(res.status).toBe(200);
    expect(m.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      1,
    );
  });

  it('usa límite por defecto 15', async () => {
    const token = await tokenFor();
    m.$queryRawUnsafe.mockResolvedValue([]);

    const res = await trending(
      jsonRequest('http://localhost/search/trending', { token }),
    );
    expect(res.status).toBe(200);
    expect(m.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      15,
    );
  });
});

// ── GET /search/suggest ─────────────────────────────────────────────────

describe('GET /search/suggest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin sesión', async () => {
    const res = await suggest(jsonRequest('http://localhost/search/suggest'));
    expect(res.status).toBe(401);
  });

  it('devuelve usuarios sugeridos ordenados por seguidores', async () => {
    const token = await tokenFor();
    m.user.findMany.mockResolvedValue([
      {
        id: 'user-2',
        username: 'user_two',
        displayName: 'User Two',
        avatarUrl: null,
        bio: 'Test bio',
        usernameColor: null,
        avatarFrame: null,
        level: 2,
        isOnline: true,
      },
    ]);

    const res = await suggest(
      jsonRequest('http://localhost/search/suggest?limit=10', { token }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].username).toBe('user_two');
    expect(body.data[0].displayName).toBe('User Two');
    expect(body.data[0].level).toBe(2);
    expect(body.suggestions).toHaveLength(1);
    expect(body.results).toHaveLength(1);
  });

  it('valida límite: 0 se clampea a 1, 999 a 50', async () => {
    const token = await tokenFor();
    m.user.findMany.mockResolvedValue([]);

    await suggest(
      jsonRequest('http://localhost/search/suggest?limit=0', { token }),
    );
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );

    vi.clearAllMocks();
    m.user.findMany.mockResolvedValue([]);

    await suggest(
      jsonRequest('http://localhost/search/suggest?limit=999', { token }),
    );
    expect(m.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});


