import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { basePost, baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  const m = () => ({
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    verificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    follow: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    reaction: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    ban: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    mute: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    moderationLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    report: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((items: unknown[]) => Promise.all(items)),
  });
  return m;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

import { prisma } from '@/lib/prisma';
import { POST as createPost } from '@/app/api/posts/route';
import { GET as feed } from '@/app/api/posts/feed/route';
import { GET as getPost, PATCH as patchPost, DELETE as deletePost } from '@/app/api/posts/[id]/route';
import { POST as react, DELETE as unreact } from '@/app/api/posts/[id]/react/route';

const m = prisma as unknown as PrismaMock;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const authorUser = baseUser();

async function tokenFor(user = authorUser) {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

describe('crear post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('201 sin sesión no autorizado', async () => {
    const res = await createPost(jsonRequest('http://localhost/api/posts', { method: 'POST', body: { content: 'Hola' } }));
    expect(res.status).toBe(401);
  });

  it('201 crea el post con visibilidad por defecto PUBLIC', async () => {
    const token = await tokenFor();
    const post = { ...basePost(), author, _count: { reactions: 0 } };
    m.post.create.mockResolvedValue(post);

    const res = await createPost(jsonRequest('http://localhost/api/posts', { method: 'POST', body: { content: 'Hola' }, token }));
    expect(res.status).toBe(201);
    expect(m.post.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ authorId: 'user-1', content: 'Hola', visibility: 'PUBLIC' }) })
    );
  });

  it('400 con contenido vacío', async () => {
    const token = await tokenFor();
    const res = await createPost(jsonRequest('http://localhost/api/posts', { method: 'POST', body: { content: '   ' }, token }));
    expect(res.status).toBe(400);
  });
});

describe('feed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aplica límite por defecto y orden con desempate', async () => {
    const token = await tokenFor();
    m.post.findMany.mockResolvedValue([]);

    const res = await feed(jsonRequest('http://localhost/api/posts/feed', { token }));
    expect(res.status).toBe(200);
    expect(m.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    );
  });

  it('no revienta con limit no numérico (NaN)', async () => {
    const token = await tokenFor();
    m.post.findMany.mockResolvedValue([]);

    const res = await feed(jsonRequest('http://localhost/api/posts/feed?limit=abc', { token }));
    expect(res.status).toBe(200);
    expect(m.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 21 }));
  });

  it('incluye FOLLOWERS vía subconsulta relacional sin materializar follows', async () => {
    const token = await tokenFor();
    m.post.findMany.mockResolvedValue([]);

    await feed(jsonRequest('http://localhost/api/posts/feed', { token }));

    // Ya no se traen los follows a memoria con un findMany previo.
    expect(m.follow.findMany).not.toHaveBeenCalled();

    const where = m.post.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ visibility: 'PUBLIC' });
    expect(where.OR[1]).toEqual({
      visibility: 'FOLLOWERS',
      OR: [
        { authorId: 'user-1' },
        { author: { followers: { some: { followerId: 'user-1' } } } },
      ],
    });
    expect(where.OR[2]).toEqual({ visibility: 'PRIVATE', authorId: 'user-1' });
  });

  it('incluye myReaction y nextCursor', async () => {
    const token = await tokenFor();
    m.post.findMany.mockResolvedValue([{ ...basePost(), author, _count: { reactions: 1 }, reactions: [{ type: 'LOVE' }] }]);

    const res = await feed(jsonRequest('http://localhost/api/posts/feed', { token }));
    const body = await res.json();
    expect(body.items[0].myReaction).toBe('LOVE');
    expect(body.nextCursor).toBeNull();
  });
});

describe('post [id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET 404 si el post no existe', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(null);
    const res = await getPost(jsonRequest('http://localhost/api/posts/post-1', { token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(404);
  });

  it('PATCH 403 si no eres el autor', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue({ ...basePost(), authorId: 'user-2' });
    const res = await patchPost(jsonRequest('http://localhost/api/posts/post-1', { method: 'PATCH', body: { content: 'editado' }, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(403);
  });

  it('PATCH 200 del autor', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(basePost());
    m.post.update.mockResolvedValue({ ...basePost(), content: 'editado', author });
    const res = await patchPost(jsonRequest('http://localhost/api/posts/post-1', { method: 'PATCH', body: { content: 'editado' }, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(200);
  });

  it('DELETE 200 del autor', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(basePost());
    m.post.delete.mockResolvedValue({});
    const res = await deletePost(jsonRequest('http://localhost/api/posts/post-1', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(200);
    expect(m.post.delete).toHaveBeenCalledWith({ where: { id: 'post-1' } });
  });
});

describe('reacciones', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403 en un post PRIVATE ajeno', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue({ ...basePost(), authorId: 'user-2', visibility: 'PRIVATE' });
    const res = await react(jsonRequest('http://localhost/api/posts/post-1/react', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(403);
  });

  it('403 en un post FOLLOWERS sin seguir al autor', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue({ ...basePost(), authorId: 'user-2', visibility: 'FOLLOWERS' });
    m.follow.findUnique.mockResolvedValue(null);
    const res = await react(jsonRequest('http://localhost/api/posts/post-1/react', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(403);
  });

  it('200 reaccionar a un post PUBLIC', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(basePost());
    m.reaction.upsert.mockResolvedValue({ id: 'r1', postId: 'post-1', userId: 'user-1', type: 'LIKE' });
    const res = await react(jsonRequest('http://localhost/api/posts/post-1/react', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(200);
    expect(m.reaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { postId_userId: { postId: 'post-1', userId: 'user-1' } } })
    );
  });

  it('DELETE quita la reacción', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(basePost());
    m.reaction.deleteMany.mockResolvedValue({ count: 1 });
    const res = await unreact(jsonRequest('http://localhost/api/posts/post-1/react', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(200);
    expect(m.reaction.deleteMany).toHaveBeenCalledWith({ where: { postId: 'post-1', userId: 'user-1' } });
  });

  it('404 si el post no existe', async () => {
    const token = await tokenFor();
    m.post.findUnique.mockResolvedValue(null);
    const res = await react(jsonRequest('http://localhost/api/posts/post-1/react', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(404);
  });
});
