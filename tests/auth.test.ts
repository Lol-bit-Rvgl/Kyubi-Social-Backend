import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';

const mockPrisma = vi.hoisted(() => {
  const m = () => ({
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    verificationToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    follow: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    reaction: { upsert: vi.fn(), deleteMany: vi.fn() },
    ban: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    mute: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    moderationLog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    report: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    $transaction: vi.fn((items: unknown[]) => Promise.all(items)),
  });
  return m;
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

import type { Mock } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { POST as register } from '@/app/auth/register/route';
import { POST as login } from '@/app/auth/login/route';
import { POST as refresh } from '@/app/auth/refresh/route';
import { POST as verifyEmail } from '@/app/auth/verify-email/route';
import { POST as forgotPassword } from '@/app/auth/forgot-password/route';
import { POST as resetPassword } from '@/app/auth/reset-password/route';

const m = prisma as unknown as PrismaMock;
const bcryptMock = bcrypt as unknown as { hash: Mock; compare: Mock; hashSync: Mock };

describe('register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea un usuario y devuelve tokens', async () => {
    const user = baseUser();
    m.user.findFirst.mockResolvedValue(null);
    m.user.create.mockResolvedValue(user);
    m.refreshToken.create.mockResolvedValue({ id: 'rt' });

    const res = await register(jsonRequest('http://localhost/auth/register', { method: 'POST', body: { email: 'USER@example.com', username: 'user_one', password: 'password123' }, ip: '10.0.0.1' }));

    expect(res.status).toBe(201);
    expect(m.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: 'user@example.com' }) }));
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('409 si el email o username ya existe', async () => {
    m.user.findFirst.mockResolvedValue(baseUser());
    const res = await register(jsonRequest('http://localhost/auth/register', { method: 'POST', body: { email: 'user@example.com', username: 'user_one', password: 'password123' }, ip: '10.0.0.2' }));
    expect(res.status).toBe(409);
  });

  it('409 si hay race condition P2002', async () => {
    m.user.findFirst.mockResolvedValue(null);
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: '6.0.0' });
    m.user.create.mockRejectedValue(err);
    const res = await register(jsonRequest('http://localhost/auth/register', { method: 'POST', body: { email: 'user@example.com', username: 'user_one', password: 'password123' }, ip: '10.0.0.3' }));
    expect(res.status).toBe(409);
  });

  it('400 con datos inválidos', async () => {
    const res = await register(jsonRequest('http://localhost/auth/register', { method: 'POST', body: { email: 'no-es-un-email', username: 'a', password: 'corta' }, ip: '10.0.0.4' }));
    expect(res.status).toBe(400);
  });

  it('envía correo de verificación al registrarse', async () => {
    const user = baseUser();
    m.user.findFirst.mockResolvedValue(null);
    m.user.create.mockResolvedValue(user);
    m.refreshToken.create.mockResolvedValue({ id: 'rt' });
    m.verificationToken.create.mockResolvedValue({ id: 'vt' });

    await register(jsonRequest('http://localhost/auth/register', { method: 'POST', body: { email: 'user@example.com', username: 'user_one', password: 'password123' }, ip: '10.0.0.5' }));

    expect(m.verificationToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'EMAIL_VERIFICATION', userId: 'user-1' }) }));
  });
});

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 con contraseña incorrecta', async () => {
    m.user.findUnique.mockResolvedValue(baseUser());
    bcryptMock.compare.mockResolvedValue(false);
    const res = await login(jsonRequest('http://localhost/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'wrong' }, ip: '10.0.1.1' }));
    expect(res.status).toBe(401);
  });

  it('401 si el usuario no existe (siempre compara password)', async () => {
    m.user.findUnique.mockResolvedValue(null);
    const res = await login(jsonRequest('http://localhost/auth/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'whatever' }, ip: '10.0.1.2' }));
    expect(res.status).toBe(401);
    expect(bcryptMock.compare).toHaveBeenCalled(); // dummy hash para evitar timing attack
  });

  it('200 con credenciales válidas', async () => {
    m.user.findUnique.mockResolvedValue(baseUser());
    bcryptMock.compare.mockResolvedValue(true);
    m.refreshToken.create.mockResolvedValue({ id: 'rt' });
    const res = await login(jsonRequest('http://localhost/auth/login', { method: 'POST', body: { email: 'user@example.com', password: 'password123' }, ip: '10.0.1.3' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('user@example.com');
    expect(body.accessToken).toBeTruthy();
  });

  it('429 tras 10 intentos fallidos desde la misma IP', async () => {
    m.user.findUnique.mockResolvedValue(null);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await login(jsonRequest('http://localhost/auth/login', { method: 'POST', body: { email: 'x@example.com', password: 'nope' }, ip: '10.9.9.9' }));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe('refresh / logout / email', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refresh rota el token', async () => {
    m.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', tokenHash: 'h', userId: 'user-1', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user: baseUser() });
    // Reclamo atómico: updateMany marca el token como revocado (count 1 = lo ganó esta petición).
    m.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    m.refreshToken.create.mockResolvedValue({ id: 'rt2' });
    const res = await refresh(jsonRequest('http://localhost/auth/refresh', { method: 'POST', body: { refreshToken: 'token' }, ip: '10.0.2.1' }));
    expect(res.status).toBe(200);
  });

  it('refresh 401 si el token está revocado', async () => {
    m.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', tokenHash: 'h', userId: 'user-1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), user: baseUser() });
    // count 0 => el token ya fue consumido/revocado (o una petición concurrente lo
    // ganó) => se revoca la familia completa y se rechaza la rotación.
    m.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    const res = await refresh(jsonRequest('http://localhost/auth/refresh', { method: 'POST', body: { refreshToken: 'stolen' }, ip: '10.0.2.2' }));
    expect(res.status).toBe(401);
    expect(m.refreshToken.updateMany).toHaveBeenCalled(); // revoca la familia
  });

  it('verify-email marca el correo como verificado', async () => {
    m.verificationToken.findUnique.mockResolvedValue({ id: 'vt', type: 'EMAIL_VERIFICATION', consumedAt: null, expiresAt: new Date(Date.now() + 3600_000) });
    m.user.update.mockResolvedValue(baseUser({ emailVerifiedAt: new Date() }));
    m.verificationToken.update.mockResolvedValue({});
    const res = await verifyEmail(jsonRequest('http://localhost/auth/verify-email', { method: 'POST', body: { token: 'tok' }, ip: '10.0.3.1' }));
    expect(res.status).toBe(200);
  });

  it('verify-email 400 con token expirado', async () => {
    m.verificationToken.findUnique.mockResolvedValue({ id: 'vt', type: 'EMAIL_VERIFICATION', consumedAt: null, expiresAt: new Date(Date.now() - 1000) });
    const res = await verifyEmail(jsonRequest('http://localhost/auth/verify-email', { method: 'POST', body: { token: 'tok' }, ip: '10.0.3.2' }));
    expect(res.status).toBe(400);
  });

  it('forgot-password no revela si el email existe', async () => {
    m.user.findUnique.mockResolvedValue(null);
    const res = await forgotPassword(jsonRequest('http://localhost/auth/forgot-password', { method: 'POST', body: { email: 'ghost@example.com' }, ip: '10.0.4.1' }));
    expect(res.status).toBe(200);
  });

  it('reset-password actualiza el hash y revoca sesiones', async () => {
    m.verificationToken.findUnique.mockResolvedValue({ id: 'vt', type: 'PASSWORD_RESET', consumedAt: null, expiresAt: new Date(Date.now() + 3600_000) });
    m.user.update.mockResolvedValue(baseUser());
    m.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    m.verificationToken.update.mockResolvedValue({});
    const res = await resetPassword(jsonRequest('http://localhost/auth/reset-password', { method: 'POST', body: { token: 'tok', password: 'new-password-123' }, ip: '10.0.5.1' }));
    expect(res.status).toBe(200);
    expect(m.refreshToken.updateMany).toHaveBeenCalled();
  });
});
