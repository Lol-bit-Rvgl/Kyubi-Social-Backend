import { describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { jsonRequest, type PrismaMock } from './helpers';

// â”€â”€ Mock de Prisma (mismo patrÃ³n usado en moderation.test.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const mockPrisma = vi.hoisted(() => {
  let current: ReturnType<typeof build> | null = null;
  function build() {
    const m = {
      user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
      ban: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
      mute: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
      moderationLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
      report: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
      userTitle: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
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
vi.mock('@/lib/socketio', () => ({
  emitToUser: vi.fn(() => undefined),
  emitToRoom: vi.fn(() => undefined),
}));
vi.mock('@/lib/notifications', () => ({
  notifyModerationWarning: vi.fn(async () => undefined),
}));

import { prisma } from '@/lib/prisma';
import { POST as sanctionUser } from '@/app/api/admin/users/[id]/sanction/route';
import { POST as unsanctionUser } from '@/app/api/admin/users/[id]/unsanction/route';
import { PATCH as toggleProfileVisibility } from '@/app/api/admin/users/[id]/profile-visibility/route';
import { POST as assignTitle } from '@/app/api/admin/users/[id]/titles/route';
import { PATCH as pinPost } from '@/app/api/admin/posts/[id]/pin/route';
import { PATCH as postVisibility } from '@/app/api/admin/posts/[id]/visibility/route';
import { POST as bulkDelete } from '@/app/api/admin/posts/bulk-delete/route';
import { GET as listReports } from '@/app/api/admin/reports/route';
import { GET as getStats } from '@/app/api/admin/stats/route';
import { GET as listAuditLogs } from '@/app/api/admin/audit-logs/route';

const m = prisma as unknown as PrismaMock & {
  post: PrismaMock['post'] & {
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

function actor(id: string, role: string) {
  return { id, email: `${id}@kyubi.test`, username: id, role };
}

async function makeToken(user: { id: string; email: string; username: string }) {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

/** Autentica con `role` y prepara el mock para servir al actor + target opcional. */
async function setupAuth(role: string, target: ReturnType<typeof actor> | null = null) {
  const authUser = actor('auth-1', role);
  m.user.findUnique.mockImplementation(({ where }: { where: { id?: string } }) => {
    if (where.id === authUser.id) return Promise.resolve(authUser);
    if (target && where.id === target.id) return Promise.resolve(target);
    return Promise.resolve(null);
  });
  m.ban.findFirst.mockResolvedValue(null); // actor no estÃ¡ baneado
  return makeToken(authUser);
}

const targetUserParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Seguridad de /api/admin/*', () => {
  // â”€â”€ 1. Un usuario SIN sesiÃ³n no puede pasar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('Sin token', () => {
    it('stats devuelve 401', async () => {
      const res = await getStats(jsonRequest('http://localhost/api/admin/stats'));
      expect(res.status).toBe(401);
    });

    it('reports devuelve 401', async () => {
      const res = await listReports(jsonRequest('http://localhost/api/admin/reports'));
      expect(res.status).toBe(401);
    });

    it('audit-logs devuelve 401', async () => {
      const res = await listAuditLogs(jsonRequest('http://localhost/api/admin/audit-logs'));
      expect(res.status).toBe(401);
    });

    it('sanction devuelve 401', async () => {
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/u1/sanction', {
          method: 'POST',
          body: { action: 'WARN', reason: 'motivo vÃ¡lido' },
        }),
        targetUserParams('u1')
      );
      expect(res.status).toBe(401);
    });
  });

  // â”€â”€ 2. Un usuario normal (USER) recibe 403 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('Rol USER (sin privilegios)', () => {
    it('stats devuelve 403', async () => {
      const token = await setupAuth('USER');
      const res = await getStats(jsonRequest('http://localhost/api/admin/stats', { token }));
      expect(res.status).toBe(403);
    });

    it('reports devuelve 403', async () => {
      const token = await setupAuth('USER');
      const res = await listReports(jsonRequest('http://localhost/api/admin/reports', { token }));
      expect(res.status).toBe(403);
    });

    it('audit-logs devuelve 403', async () => {
      const token = await setupAuth('USER');
      const res = await listAuditLogs(jsonRequest('http://localhost/api/admin/audit-logs', { token }));
      expect(res.status).toBe(403);
    });

    it('sanction devuelve 403', async () => {
      const token = await setupAuth('USER', actor('victim-1', 'USER'));
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/victim-1/sanction', {
          method: 'POST',
          body: { action: 'WARN', reason: 'spam' },
          token,
        }),
        targetUserParams('victim-1')
      );
      expect(res.status).toBe(403);
    });

    it('bulk-delete devuelve 403', async () => {
      const token = await setupAuth('USER');
      const res = await bulkDelete(
        jsonRequest('http://localhost/api/admin/posts/bulk-delete', {
          method: 'POST',
          body: { reason: 'limpieza' },
          token,
        })
      );
      expect(res.status).toBe(403);
    });
  });

  // â”€â”€ 3. JerarquÃ­a: MODERATOR no puede tocar ADMIN/OWNER ni otro MODERATOR â”€â”€â”€
  describe('JerarquÃ­a de objetivos', () => {
    it('MODERATOR no puede WARN/â€¦ a un ADMIN', async () => {
      const token = await setupAuth('MODERATOR', actor('admin-victim', 'ADMIN'));
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/admin-victim/sanction', {
          method: 'POST',
          body: { action: 'WARN', reason: 'intento de abuso' },
          token,
        }),
        targetUserParams('admin-victim')
      );
      expect(res.status).toBe(403);
      expect(m.moderationLog.create).not.toHaveBeenCalled();
    });

    it('MODERATOR no puede tocar a un OWNER', async () => {
      const token = await setupAuth('MODERATOR', actor('owner-1', 'OWNER'));
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/owner-1/sanction', {
          method: 'POST',
          body: { action: 'MUTE', reason: 'test' },
          token,
        }),
        targetUserParams('owner-1')
      );
      expect(res.status).toBe(403);
    });

    it('MODERATOR no puede tocar a otro MODERATOR', async () => {
      const token = await setupAuth('MODERATOR', actor('mod-2', 'MODERATOR'));
      const res = await toggleProfileVisibility(
        jsonRequest('http://localhost/api/admin/users/mod-2/profile-visibility', {
          method: 'PATCH',
          body: { isHidden: true, reason: 'ocultar perfil' },
          token,
        }),
        targetUserParams('mod-2')
      );
      expect(res.status).toBe(403);
    });

    it('ADMIN no puede tocar al OWNER (unsanction)', async () => {
      const token = await setupAuth('ADMIN', actor('owner-1', 'OWNER'));
      const res = await unsanctionUser(
        jsonRequest('http://localhost/api/admin/users/owner-1/unsanction', {
          method: 'POST',
          body: { reason: 'revocar ban' },
          token,
        }),
        targetUserParams('owner-1')
      );
      expect(res.status).toBe(403);
    });

    it('ADMIN no puede tocar a otro ADMIN (assign title)', async () => {
      const token = await setupAuth('ADMIN', actor('admin-2', 'ADMIN'));
      const res = await assignTitle(
        jsonRequest('http://localhost/api/admin/users/admin-2/titles', {
          method: 'POST',
          body: { titleText: 'VIP', colorHex: '#FF5500' },
          token,
        }),
        targetUserParams('admin-2')
      );
      expect(res.status).toBe(403);
    });

    it('OWNER puede sancionar a un ADMIN', async () => {
      const token = await setupAuth('OWNER', actor('some-admin', 'ADMIN'));
      m.moderationLog.create.mockResolvedValue({ id: 'log-1' });
      m.$transaction.mockImplementation((cb: unknown) =>
        typeof cb === 'function' ? (cb as (tx: unknown) => unknown)(m) : Promise.resolve([])
      );
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/some-admin/sanction', {
          method: 'POST',
          body: { action: 'WARN', reason: 'revisiÃ³n de conducta' },
          token,
        }),
        targetUserParams('some-admin')
      );
      expect(res.status).toBe(200);
    });

    it('MODERATOR puede WARN a un USER normal', async () => {
      const token = await setupAuth('MODERATOR', actor('bad-user', 'USER'));
      m.moderationLog.create.mockResolvedValue({ id: 'log-1' });
      m.$transaction.mockImplementation((cb: unknown) =>
        typeof cb === 'function' ? (cb as (tx: unknown) => unknown)(m) : Promise.resolve([])
      );
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/bad-user/sanction', {
          method: 'POST',
          body: { action: 'WARN', reason: 'spam repetido' },
          token,
        }),
        targetUserParams('bad-user')
      );
      expect(res.status).toBe(200);
      expect(m.moderationLog.create).toHaveBeenCalled();
    });
  });

  // â”€â”€ 4. Control por acciÃ³n: BAN exige ADMIN+; pin requiere ADMIN+ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  describe('Acciones restringidas', () => {
    it('MODERATOR no puede BAN', async () => {
      const token = await setupAuth('MODERATOR', actor('bad-user', 'USER'));
      m.$transaction.mockImplementation((cb: unknown) =>
        typeof cb === 'function' ? (cb as (tx: unknown) => unknown)(m) : Promise.resolve([])
      );
      const res = await sanctionUser(
        jsonRequest('http://localhost/api/admin/users/bad-user/sanction', {
          method: 'POST',
          body: { action: 'BAN', reason: 'violaciÃ³n severa' },
          token,
        }),
        targetUserParams('bad-user')
      );
      expect(res.status).toBe(403);
    });

    it('MODERATOR no puede fijar posts (ADMIN requerido)', async () => {
      const token = await setupAuth('MODERATOR');
      m.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u9', isPinned: false });
      const res = await pinPost(
        jsonRequest('http://localhost/api/admin/posts/p1/pin', {
          method: 'PATCH',
          body: { isPinned: true, reason: 'destacar' },
          token,
        }),
        targetUserParams('p1')
      );
      expect(res.status).toBe(403);
    });

    it('MODERATOR puede ocultar un post (MODERATOR requerido)', async () => {
      const token = await setupAuth('MODERATOR');
      m.post.findUnique.mockResolvedValue({ id: 'p1', authorId: 'u9', isHidden: false });
      const res = await postVisibility(
        jsonRequest('http://localhost/api/admin/posts/p1/visibility', {
          method: 'PATCH',
          body: { isHidden: true, reason: 'contenido inapropiado' },
          token,
        }),
        targetUserParams('p1')
      );
      expect(res.status).toBe(200);
    });

    it('MODERATOR puede leer stats y reports', async () => {
      const token = await setupAuth('MODERATOR');
      m.report.count.mockResolvedValue(0);
      m.user.count.mockResolvedValue(0);
      m.ban.count.mockResolvedValue(0);
      m.mute.count.mockResolvedValue(0);
      m.post.count.mockResolvedValue(0);
      m.moderationLog.count.mockResolvedValue(0);
      m.moderationLog.findMany.mockResolvedValue([]);
      const statsRes = await getStats(jsonRequest('http://localhost/api/admin/stats', { token }));
      expect(statsRes.status).toBe(200);

      m.report.findMany.mockResolvedValue([]);
      const reportsRes = await listReports(jsonRequest('http://localhost/api/admin/reports', { token }));
      expect(reportsRes.status).toBe(200);
    });
  });
});

