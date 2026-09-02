import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest } from './helpers';

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
    story: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    storyView: { upsert: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((items: unknown[]) => Promise.all(items)),
  });
  return m;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

import { prisma } from '@/lib/prisma';
import { POST as createStory } from '@/app/stories/route';
import { GET as feed } from '@/app/stories/feed/route';
import { POST as markViewed } from '@/app/stories/[id]/view/route';

const m = prisma as unknown as ReturnType<typeof mockPrisma>;

const author = { id: 'user-1', username: 'user_one', displayName: 'User One', avatarUrl: null };
const authorUser = baseUser();

async function tokenFor(user = authorUser) {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

function story(overrides: Record<string, unknown> = {}) {
  return {
    id: 'story-1',
    userId: 'user-1',
    mediaUrl: 'https://cdn.example.com/img.png',
    mediaType: 'IMAGE',
    caption: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    user: author,
    views: [],
    ...overrides,
  };
}

describe('stories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST 401 sin sesión', async () => {
    const res = await createStory(
      jsonRequest('http://localhost/stories', {
        method: 'POST',
        body: { mediaUrl: 'https://cdn.example.com/img.png' },
      })
    );
    expect(res.status).toBe(401);
  });

  it('POST 201 crea historia con expiración 24h', async () => {
    const token = await tokenFor();
    m.story.create.mockResolvedValue(story());
    const res = await createStory(
      jsonRequest('http://localhost/stories', {
        method: 'POST',
        body: { mediaUrl: 'https://cdn.example.com/img.png', mediaType: 'IMAGE' },
        token,
      })
    );
    expect(res.status).toBe(201);
    const data = m.story.create.mock.calls[0][0].data;
    expect(data.userId).toBe('user-1');
    expect(data.mediaUrl).toBe('https://cdn.example.com/img.png');
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 60_000);
  });

  it('POST 400 con mediaUrl inválida', async () => {
    const token = await tokenFor();
    const res = await createStory(
      jsonRequest('http://localhost/stories', {
        method: 'POST',
        body: { mediaUrl: 'no-url' },
        token,
      })
    );
    expect(res.status).toBe(400);
  });

  it('GET /feed 401 sin sesión', async () => {
    const res = await feed(jsonRequest('http://localhost/stories/feed'));
    expect(res.status).toBe(401);
  });

  it('GET /feed agrupa por autor y marca no vistas', async () => {
    const token = await tokenFor();
    m.story.findMany.mockResolvedValue([
      story({ id: 's1', views: [{ viewerId: 'user-1' }] }),
      story({ id: 's2', views: [] }),
    ]);
    const res = await feed(jsonRequest('http://localhost/stories/feed', { token }));
    expect(res.status).toBe(200);
    expect(m.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { expiresAt: { gt: expect.any(Date) } },
      })
    );
    const body = await res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].hasUnseen).toBe(true);
    expect(body.groups[0].stories).toHaveLength(2);
  });

  it('POST /:id/view 401 sin sesión', async () => {
    const res = await markViewed(
      jsonRequest('http://localhost/stories/story-1/view', { method: 'POST' }),
      { params: Promise.resolve({ id: 'story-1' }) }
    );
    expect(res.status).toBe(401);
  });

  it('POST /:id/view 404 si no existe', async () => {
    const token = await tokenFor();
    m.story.findUnique.mockResolvedValue(null);
    const res = await markViewed(
      jsonRequest('http://localhost/stories/story-1/view', { method: 'POST', token }),
      { params: Promise.resolve({ id: 'story-1' }) }
    );
    expect(res.status).toBe(404);
  });

  it('POST /:id/view 410 si expiró', async () => {
    const token = await tokenFor();
    m.story.findUnique.mockResolvedValue(
      story({ expiresAt: new Date(Date.now() - 1000) })
    );
    const res = await markViewed(
      jsonRequest('http://localhost/stories/story-1/view', { method: 'POST', token }),
      { params: Promise.resolve({ id: 'story-1' }) }
    );
    expect(res.status).toBe(410);
  });

  it('POST /:id/view registra vista', async () => {
    const token = await tokenFor();
    m.story.findUnique.mockResolvedValue(story());
    m.storyView.upsert.mockResolvedValue({ id: 'v1' });
    const res = await markViewed(
      jsonRequest('http://localhost/stories/story-1/view', { method: 'POST', token }),
      { params: Promise.resolve({ id: 'story-1' }) }
    );
    expect(res.status).toBe(200);
    expect(m.storyView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storyId_viewerId: { storyId: 'story-1', viewerId: 'user-1' } },
      })
    );
  });
});