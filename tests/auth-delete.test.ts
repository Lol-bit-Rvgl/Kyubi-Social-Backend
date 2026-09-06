import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => {
  const m = () => ({
    user: { findUnique: vi.fn(), delete: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  });
  return m;
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma() }));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(async () => true),
    hashSync: vi.fn(() => 'dummy-hash'),
  },
}));

import type { Mock } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest } from './helpers';
import { POST as deleteAccount } from '@/app/auth/delete-account/route';

const m = prisma as unknown as {
  user: { findUnique: Mock; delete: Mock };
  refreshToken: Record<string, Mock>;
};
const bcryptMock = bcrypt as unknown as { compare: Mock; hashSync: Mock };

async function tokenFor() {
  return signAccessToken({ userId: 'user-1', email: 'user@example.com', username: 'user_one' });
}

describe('POST /auth/delete-account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 si no hay token de autenticación', async () => {
    const res = await deleteAccount(
      jsonRequest('http://localhost/auth/delete-account', { method: 'POST', body: {}, ip: '10.7.0.1' })
    );
    expect(res.status).toBe(401);
    expect(m.user.findUnique).not.toHaveBeenCalled();
    expect(m.user.delete).not.toHaveBeenCalled();
  });

  it('400 si falta la contraseña cuando el usuario tiene password hash', async () => {
    const token = await tokenFor();
    m.user.findUnique.mockResolvedValue(baseUser());
    const res = await deleteAccount(
      jsonRequest('http://localhost/auth/delete-account', { method: 'POST', body: {}, token, ip: '10.7.0.2' })
    );
    expect(res.status).toBe(400);
    expect(bcryptMock.compare).not.toHaveBeenCalled();
    expect(m.user.delete).not.toHaveBeenCalled();
  });

  it('403 si la contraseña es incorrecta', async () => {
    const token = await tokenFor();
    m.user.findUnique.mockResolvedValue(baseUser());
    bcryptMock.compare.mockResolvedValueOnce(false);
    const res = await deleteAccount(
      jsonRequest('http://localhost/auth/delete-account', { method: 'POST', body: { password: 'wrong-pass' }, token, ip: '10.7.0.3' })
    );
    expect(res.status).toBe(403);
    expect(bcryptMock.compare).toHaveBeenCalledWith('wrong-pass', 'hashed');
    expect(m.user.delete).not.toHaveBeenCalled();
  });

  it('200 elimina la cuenta y sus registros en cascada', async () => {
    const token = await tokenFor();
    m.user.findUnique.mockResolvedValue(baseUser());
    bcryptMock.compare.mockResolvedValueOnce(true);
    m.user.delete.mockResolvedValue(baseUser());
    const res = await deleteAccount(
      jsonRequest('http://localhost/auth/delete-account', { method: 'POST', body: { password: 'password123' }, token, ip: '10.7.0.4' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: 'Cuenta eliminada correctamente' });
    expect(m.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('200 para usuario sin password hash (login social exclusivo) sin contraseña', async () => {
    const token = await tokenFor();
    m.user.findUnique.mockResolvedValue(baseUser({ passwordHash: null }));
    m.user.delete.mockResolvedValue(baseUser({ passwordHash: null }));
    const res = await deleteAccount(
      jsonRequest('http://localhost/auth/delete-account', { method: 'POST', body: {}, token, ip: '10.7.0.5' })
    );
    expect(res.status).toBe(200);
    expect(m.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});
