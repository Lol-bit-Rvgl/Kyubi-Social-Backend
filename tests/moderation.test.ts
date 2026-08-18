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

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(async () => true),
    hashSync: vi.fn(() => 'dummy-hash'),
  },
}));

vi.mock('@/lib/mailer', () => ({
  sendMail: vi.fn(async () => {}),
  buildVerifyLink: vi.fn((t: string) => `http://localhost/verify?token=${t}`),
  buildResetLink: vi.fn((t: string) => `http://localhost/reset?token=${t}`),
}));

import { prisma } from '@/lib/prisma';
import { GET as listUsers } from '@/app/moderation/users/route';
import { GET as getUser } from '@/app/moderation/users/[id]/route';
import { POST as muteUser, DELETE as unmuteUser } from '@/app/moderation/users/[id]/mute/route';
import { POST as banUser, DELETE as unbanUser } from '@/app/moderation/users/[id]/ban/route';
import { PATCH as changeRole } from '@/app/moderation/users/[id]/role/route';
import { GET as listPosts } from '@/app/moderation/posts/route';
import { GET as getPost, DELETE as deletePost } from '@/app/moderation/posts/[id]/route';
import { GET as listCircles } from '@/app/moderation/circles/route';
import { GET as getCircle, DELETE as deleteCircle } from '@/app/moderation/circles/[id]/route';
import { GET as listSalas } from '@/app/moderation/salas/route';
import { GET as getSala, DELETE as deleteSala } from '@/app/moderation/salas/[id]/route';
import { GET as listReports } from '@/app/moderation/reports/route';
import { GET as getReport } from '@/app/moderation/reports/[id]/route';
import { POST as reviewReport } from '@/app/moderation/reports/[id]/review/route';
import { POST as resolveReport } from '@/app/moderation/reports/[id]/resolve/route';
import { POST as dismissReport } from '@/app/moderation/reports/[id]/dismiss/route';
import { GET as listLogs } from '@/app/moderation/logs/route';
import { POST as reportPost } from '@/app/posts/[id]/report/route';
import { POST as reportUser } from '@/app/users/[username]/report/route';
import { POST as createPost } from '@/app/api/posts/route';
import { POST as login } from '@/app/auth/login/route';

const m = prisma as unknown as PrismaMock;

function actor(id: string, role: string) {
  return { id, email: `${id}@example.com`, username: id, role };
}

async function makeToken(user: { id: string; email: string; username: string }) {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

function setupAuth(role: 'USER' | 'MODERATOR' | 'ADMIN' | 'OWNER') {
  const authUser = actor('auth-1', role);
  m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
    if (where.id === authUser.id) return Promise.resolve(authUser);
    return Promise.resolve(null);
  });
  m.ban.findFirst.mockResolvedValue(null);
  return makeToken(authUser);
}

const modActor = { id: 'mod-1', username: 'moderator', displayName: 'Moderator', avatarUrl: null, role: 'MODERATOR' };
const adminActor = { id: 'admin-1', username: 'admin', displayName: 'Admin', avatarUrl: null, role: 'ADMIN' };
const userActor = { id: 'user-2', username: 'user2', displayName: 'User Two', avatarUrl: null, role: 'USER' };

function baseMute(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mute-1',
    userId: 'user-2',
    moderatorId: 'mod-1',
    reason: 'spam',
    expiresAt: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date(),
    user: userActor,
    moderator: modActor,
    ...overrides,
  };
}

function baseBan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ban-1',
    userId: 'user-2',
    moderatorId: 'admin-1',
    reason: 'harassment',
    expiresAt: null,
    revokedAt: null,
    revokedById: null,
    createdAt: new Date(),
    user: userActor,
    moderator: adminActor,
    ...overrides,
  };
}

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    reporterId: 'auth-1',
    reporter: { ...userActor, id: 'auth-1' },
    reason: 'SPAM',
    details: 'Spam content',
    targetType: 'POST',
    targetId: 'post-1',
    status: 'OPEN',
    handledById: null,
    handledBy: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function baseLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    moderatorId: 'mod-1',
    moderator: modActor,
    action: 'MUTE_USER',
    targetType: 'USER',
    targetId: 'user-2',
    reason: 'spam',
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('autorización', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin token en rutas de moderación', async () => {
    const res = await listUsers(jsonRequest('http://localhost/moderation/users'));
    expect(res.status).toBe(401);
  });

  it('USER → 403 en rutas de moderación', async () => {
    const token = await setupAuth('USER');
    const res = await listUsers(jsonRequest('http://localhost/moderation/users', { token }));
    expect(res.status).toBe(403);
  });

  it('MODERATOR → 200 en listar usuarios', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findMany.mockResolvedValue([]);
    m.user.count.mockResolvedValue(0);
    const res = await listUsers(jsonRequest('http://localhost/moderation/users', { token }));
    expect(res.status).toBe(200);
  });

  it('MODERATOR → 403 en ban (requiere ADMIN)', async () => {
    const token = await setupAuth('MODERATOR');
    const res = await banUser(jsonRequest('http://localhost/moderation/users/user-2/ban', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(403);
  });

  it('ADMIN → 201 al banear', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.ban.create.mockResolvedValue({ id: 'ban-1' });
    m.ban.findUnique.mockResolvedValue(baseBan());
    m.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const res = await banUser(jsonRequest('http://localhost/moderation/users/user-2/ban', { method: 'POST', body: { reason: 'harassment' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(201);
  });

  it('ADMIN → 403 en cambiar rol a ADMIN (requiere OWNER)', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    const res = await changeRole(jsonRequest('http://localhost/moderation/users/user-2/role', { method: 'PATCH', body: { role: 'ADMIN' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(403);
  });
});

describe('mute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mutea a un usuario', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.mute.create.mockResolvedValue({ id: 'mute-1' });
    m.mute.findUnique.mockResolvedValue(baseMute());

    const res = await muteUser(jsonRequest('http://localhost/moderation/users/user-2/mute', { method: 'POST', body: { reason: 'spam' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.userId).toBe('user-2');
    expect(body.reason).toBe('spam');
    expect(body.active).toBe(true);
  });

  it('no permite mutear a un ADMIN siendo MODERATOR', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve({ ...userActor, role: 'ADMIN' });
      return Promise.resolve(null);
    });
    const res = await muteUser(jsonRequest('http://localhost/moderation/users/user-2/mute', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(403);
  });

  it('desmutear revoca el mute activo', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.mute.findFirst.mockResolvedValue({ id: 'mute-1', userId: 'user-2' });
    const res = await unmuteUser(jsonRequest('http://localhost/moderation/users/user-2/mute', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(200);
  });

  it('desmutear sin mute activo → 404', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.mute.findFirst.mockResolvedValue(null);
    const res = await unmuteUser(jsonRequest('http://localhost/moderation/users/user-2/mute', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(404);
  });

  it('usuario silenciado no puede crear contenido', async () => {
    const user = baseUser({ id: 'user-2', role: 'USER' });
    const token = await makeToken(user);
    m.mute.findFirst.mockResolvedValue({ id: 'mute-1', userId: 'user-2' });
    m.ban.findFirst.mockResolvedValue(null);
    const res = await createPost(jsonRequest('http://localhost/api/posts', { method: 'POST', body: { content: 'Hola' }, token }));
    expect(res.status).toBe(403);
  });
});

describe('ban', () => {
  beforeEach(() => vi.clearAllMocks());

  it('banea a un usuario y revoca sesiones', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.ban.create.mockResolvedValue({ id: 'ban-1' });
    m.ban.findUnique.mockResolvedValue(baseBan());
    m.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    const res = await banUser(jsonRequest('http://localhost/moderation/users/user-2/ban', { method: 'POST', body: { reason: 'harassment' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(201);
    expect(m.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('no permite banear a un ADMIN siendo ADMIN', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      if (where.id === 'user-2') return Promise.resolve({ ...userActor, role: 'ADMIN' });
      return Promise.resolve(null);
    });
    const res = await banUser(jsonRequest('http://localhost/moderation/users/user-2/ban', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(403);
  });

  it('desbanear revoca el ban activo', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.ban.findFirst.mockImplementation(({ where }: { where: { userId?: string } }) => {
      if (where.userId === 'auth-1') return Promise.resolve(null);
      return Promise.resolve({ id: 'ban-1', userId: 'user-2' });
    });
    const res = await unbanUser(jsonRequest('http://localhost/moderation/users/user-2/ban', { method: 'DELETE', token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(200);
  });

  it('usuario baneado no puede iniciar sesión', async () => {
    const user = baseUser({ id: 'user-2', role: 'USER' });
    m.user.findUnique.mockResolvedValue(user);
    m.ban.findFirst.mockResolvedValue({ id: 'ban-1', userId: 'user-2' });
    const res = await login(jsonRequest('http://localhost/auth/login', { method: 'POST', body: { email: 'user2@example.com', password: 'password123' }, ip: '10.0.0.1' }));
    expect(res.status).toBe(403);
  });

  it('usuario baneado es rechazado por requireUser', async () => {
    const user = baseUser({ id: 'user-2', role: 'USER' });
    const token = await makeToken(user);
    m.user.findUnique.mockResolvedValue(user);
    m.ban.findFirst.mockResolvedValue({ id: 'ban-1', userId: 'user-2' });
    const res = await listUsers(jsonRequest('http://localhost/moderation/users', { token }));
    expect(res.status).toBe(403);
  });
});

describe('reportes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reportar un POST', async () => {
    const user = baseUser({ id: 'auth-1', role: 'USER' });
    const token = await makeToken(user);
    m.post.findUnique.mockResolvedValue({ id: 'post-1', authorId: 'user-2', visibility: 'PUBLIC' });
    m.report.findFirst.mockResolvedValue(null);
    m.report.create.mockResolvedValue({});
    const res = await reportPost(jsonRequest('http://localhost/posts/post-1/report', { method: 'POST', body: { reason: 'SPAM' }, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(201);
  });

  it('reportar un USER', async () => {
    const user = baseUser({ id: 'auth-1', role: 'USER' });
    const token = await makeToken(user);
    m.user.findFirst.mockResolvedValue({ id: 'user-2', username: 'user2' });
    m.report.findFirst.mockResolvedValue(null);
    m.report.create.mockResolvedValue({});
    const res = await reportUser(jsonRequest('http://localhost/users/user2/report', { method: 'POST', body: { reason: 'HARASSMENT' }, token }), { params: Promise.resolve({ username: 'user2' }) });
    expect(res.status).toBe(201);
  });

  it('duplicado → 409', async () => {
    const user = baseUser({ id: 'auth-1', role: 'USER' });
    const token = await makeToken(user);
    m.post.findUnique.mockResolvedValue({ id: 'post-1', authorId: 'user-2', visibility: 'PUBLIC' });
    m.report.findFirst.mockResolvedValue({ id: 'existing-report' });
    const res = await reportPost(jsonRequest('http://localhost/posts/post-1/report', { method: 'POST', body: { reason: 'SPAM' }, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(409);
  });

  it('listar reportes', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findMany.mockResolvedValue([baseReport()]);
    m.report.count.mockResolvedValue(1);
    const res = await listReports(jsonRequest('http://localhost/moderation/reports', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  it('filtrar por estado', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findMany.mockResolvedValue([]);
    m.report.count.mockResolvedValue(0);
    await listReports(jsonRequest('http://localhost/moderation/reports?status=OPEN', { token }));
    expect(m.report.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'OPEN' }) }));
  });

  it('marcar como REVIEWING', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'OPEN' });
    m.report.update.mockResolvedValue(baseReport({ status: 'REVIEWING' }));
    const res = await reviewReport(jsonRequest('http://localhost/moderation/reports/report-1/review', { method: 'POST', token }), { params: Promise.resolve({ id: 'report-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('REVIEWING');
  });

  it('resolver reporte', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'REVIEWING' });
    m.report.update.mockResolvedValue(baseReport({ status: 'RESOLVED' }));
    const res = await resolveReport(jsonRequest('http://localhost/moderation/reports/report-1/resolve', { method: 'POST', body: { resolutionNote: 'Resolved' }, token }), { params: Promise.resolve({ id: 'report-1' }) });
    expect(res.status).toBe(200);
    expect(m.report.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RESOLVED' }) }));
  });

  it('descartar reporte', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'OPEN' });
    m.report.update.mockResolvedValue(baseReport({ status: 'DISMISSED' }));
    const res = await dismissReport(jsonRequest('http://localhost/moderation/reports/report-1/dismiss', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'report-1' }) });
    expect(res.status).toBe(200);
    expect(m.report.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DISMISSED' }) }));
  });

  it('no resolver un reporte ya cerrado → 409', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'RESOLVED' });
    const res = await resolveReport(jsonRequest('http://localhost/moderation/reports/report-1/resolve', { method: 'POST', body: {}, token }), { params: Promise.resolve({ id: 'report-1' }) });
    expect(res.status).toBe(409);
  });
});

describe('moderación de contenido', () => {
  beforeEach(() => vi.clearAllMocks());

  it('eliminar post como moderador', async () => {
    const token = await setupAuth('MODERATOR');
    m.post.findUnique.mockResolvedValue({ id: 'post-1', authorId: 'user-2' });
    m.post.delete.mockResolvedValue({});
    const res = await deletePost(jsonRequest('http://localhost/moderation/posts/post-1', { method: 'DELETE', body: { reason: 'inappropriate' }, token }), { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(200);
    expect(m.post.delete).toHaveBeenCalledWith({ where: { id: 'post-1' } });
  });

  it('eliminar círculo como moderador', async () => {
    const token = await setupAuth('MODERATOR');
    m.circle.findUnique.mockResolvedValue({ id: 'circle-1', creatorId: 'user-2', name: 'Bad Circle' });
    m.circle.delete.mockResolvedValue({});
    const res = await deleteCircle(jsonRequest('http://localhost/moderation/circles/circle-1', { method: 'DELETE', body: {}, token }), { params: Promise.resolve({ id: 'circle-1' }) });
    expect(res.status).toBe(200);
    expect(m.circle.delete).toHaveBeenCalledWith({ where: { id: 'circle-1' } });
  });

  it('eliminar sala como moderador', async () => {
    const token = await setupAuth('MODERATOR');
    m.room.findUnique.mockResolvedValue({ id: 'room-1', hostId: 'user-2', name: 'Bad Room' });
    m.room.delete.mockResolvedValue({});
    const res = await deleteSala(jsonRequest('http://localhost/moderation/salas/room-1', { method: 'DELETE', body: {}, token }), { params: Promise.resolve({ id: 'room-1' }) });
    expect(res.status).toBe(200);
    expect(m.room.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } });
  });

  it('ver detalle de usuario con mute/ban', async () => {
    const token = await setupAuth('MODERATOR');
    const targetUser = { ...userActor, id: 'user-2', email: 'user2@example.com', bio: null, isOnline: false, createdAt: new Date(), _count: { followers: 0, following: 0, posts: 0 } };
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(targetUser);
      return Promise.resolve(null);
    });
    m.mute.findFirst.mockResolvedValue(null);
    m.ban.findFirst.mockResolvedValue(null);
    m.mute.findMany.mockResolvedValue([]);
    m.ban.findMany.mockResolvedValue([]);
    const res = await getUser(jsonRequest('http://localhost/moderation/users/user-2', { token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('user-2');
    expect(body.activeMute).toBeNull();
    expect(body.activeBan).toBeNull();
  });
});

describe('audit log', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mute genera entrada en el log', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    m.mute.create.mockResolvedValue({ id: 'mute-1' });
    m.mute.findUnique.mockResolvedValue(baseMute());
    await muteUser(jsonRequest('http://localhost/moderation/users/user-2/mute', { method: 'POST', body: { reason: 'spam' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(m.moderationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        moderatorId: 'auth-1',
        action: 'MUTE_USER',
        targetType: 'USER',
        targetId: 'user-2',
      }),
    }));
  });

  it('listar logs', async () => {
    const token = await setupAuth('MODERATOR');
    m.moderationLog.findMany.mockResolvedValue([baseLog()]);
    m.moderationLog.count.mockResolvedValue(1);
    const res = await listLogs(jsonRequest('http://localhost/moderation/logs', { token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].moderatorId).toBe('mod-1');
    expect(body.data[0].action).toBe('MUTE_USER');
    expect(body.data[0].targetId).toBe('user-2');
    expect(body.data[0].createdAt).toBeTruthy();
  });

  it('cambio de rol genera CHANGE_ROLE en el log', async () => {
    const token = await setupAuth('OWNER');
    const targetWithCounts = { ...userActor, id: 'user-2', email: 'user2@example.com', bio: null, isOnline: false, createdAt: new Date(), _count: { followers: 0, following: 0, posts: 0 } };
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'OWNER'));
      if (where.id === 'user-2') return Promise.resolve({ id: 'user-2', role: 'USER' });
      return Promise.resolve(null);
    });
    m.user.update.mockResolvedValue({ ...targetWithCounts, role: 'MODERATOR' });
    const res = await changeRole(jsonRequest('http://localhost/moderation/users/user-2/role', { method: 'PATCH', body: { role: 'MODERATOR' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(200);
    expect(m.moderationLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'CHANGE_ROLE',
        targetType: 'USER',
        targetId: 'user-2',
      }),
    }));
  });
});

describe('seguridad', () => {
  beforeEach(() => vi.clearAllMocks());

  it('404 al eliminar post inexistente', async () => {
    const token = await setupAuth('MODERATOR');
    m.post.findUnique.mockResolvedValue(null);
    const res = await deletePost(jsonRequest('http://localhost/moderation/posts/nonexistent', { method: 'DELETE', body: {}, token }), { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('404 al eliminar círculo inexistente', async () => {
    const token = await setupAuth('MODERATOR');
    m.circle.findUnique.mockResolvedValue(null);
    const res = await deleteCircle(jsonRequest('http://localhost/moderation/circles/nonexistent', { method: 'DELETE', body: {}, token }), { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('404 al eliminar sala inexistente', async () => {
    const token = await setupAuth('MODERATOR');
    m.room.findUnique.mockResolvedValue(null);
    const res = await deleteSala(jsonRequest('http://localhost/moderation/salas/nonexistent', { method: 'DELETE', body: {}, token }), { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('404 al ver reporte inexistente', async () => {
    const token = await setupAuth('MODERATOR');
    m.report.findUnique.mockResolvedValue(null);
    const res = await getReport(jsonRequest('http://localhost/moderation/reports/nonexistent', { token }), { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('no puede cambiar su propio rol', async () => {
    const token = await setupAuth('ADMIN');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'ADMIN'));
      return Promise.resolve(null);
    });
    const res = await changeRole(jsonRequest('http://localhost/moderation/users/auth-1/role', { method: 'PATCH', body: { role: 'MODERATOR' }, token }), { params: Promise.resolve({ id: 'auth-1' }) });
    expect(res.status).toBe(403);
  });

  it('MODERATOR no puede cambiar roles', async () => {
    const token = await setupAuth('MODERATOR');
    m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
      if (where.id === 'auth-1') return Promise.resolve(actor('auth-1', 'MODERATOR'));
      if (where.id === 'user-2') return Promise.resolve(userActor);
      return Promise.resolve(null);
    });
    const res = await changeRole(jsonRequest('http://localhost/moderation/users/user-2/role', { method: 'PATCH', body: { role: 'MODERATOR' }, token }), { params: Promise.resolve({ id: 'user-2' }) });
    expect(res.status).toBe(403);
  });
});
