import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '@/lib/auth';
import { baseUser, jsonRequest, type PrismaMock } from './helpers';
import { serializeUser } from '@/lib/serialize';
import { serializeMe } from '@/lib/me';

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
import { PATCH as updateMe } from '@/app/users/me/route';
import { PATCH as updateProfile } from '@/app/users/me/profile/route';

const m = prisma as unknown as PrismaMock;
const user = baseUser();

function baseMeUser(overrides: Record<string, unknown> = {}) {
  return {
    ...user,
    bannerUrl: null,
    usernameColor: null,
    avatarFrame: null,
    level: 1,
    isOnline: false,
    gender: null,
    showGender: true,
    stickers: [],
    interests: [],
    socialLinks: null,
    voiceBioUrl: null,
    hasPaymentPassword: false,
    availability: null,
    _count: { followers: 0, following: 0 },
    ...overrides,
  };
}

async function tokenFor() {
  return signAccessToken({ userId: user.id, email: user.email, username: user.username });
}

describe('Theme Settings API and Serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('serializeUser and serializeMe', () => {
    it('serializes default themeSettings when none provided', () => {
      const publicSerialized = serializeUser(user);
      expect(publicSerialized.themeSettings).toEqual({
        primaryColor: '#BA68C8',
        accentColor: '#00E676',
        glassStyle: 'frosted',
      });

      const meSerialized = serializeMe(baseMeUser());
      expect(meSerialized.themeSettings).toEqual({
        primaryColor: '#BA68C8',
        accentColor: '#00E676',
        glassStyle: 'frosted',
      });
    });

    it('serializes custom themeSettings correctly', () => {
      const customTheme = {
        primaryColor: '#FF0055',
        accentColor: '#00E5FF',
        glassStyle: 'transparent',
      };
      const userWithTheme = {
        ...user,
        themeSettings: customTheme,
      };

      const publicSerialized = serializeUser(userWithTheme);
      expect(publicSerialized.themeSettings).toEqual(customTheme);

      const meSerialized = serializeMe(baseMeUser({ themeSettings: customTheme }));
      expect(meSerialized.themeSettings).toEqual(customTheme);
    });
  });

  describe('PATCH /users/me with themeSettings', () => {
    it('updates themeSettings successfully', async () => {
      const token = await tokenFor();
      const updatedTheme = {
        primaryColor: '#3D5AFE',
        accentColor: '#FF9100',
        glassStyle: 'transparent',
      };

      m.user.update.mockResolvedValue({
        ...user,
        role: 'USER',
        themeSettings: updatedTheme,
        stickers: [],
        interests: [],
        socialLinks: null,
        voiceBioUrl: null,
        hasPaymentPassword: false,
        availability: null,
        _count: { followers: 0, following: 0 },
      });

      const res = await updateMe(
        jsonRequest('http://localhost/users/me', {
          method: 'PATCH',
          token,
          body: {
            themeSettings: updatedTheme,
          },
        })
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.themeSettings).toEqual(updatedTheme);
      expect(m.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: user.id },
          data: expect.objectContaining({
            themeSettings: updatedTheme,
          }),
        })
      );
    });

    it('rejects invalid glassStyle with 400', async () => {
      const token = await tokenFor();
      const res = await updateMe(
        jsonRequest('http://localhost/users/me', {
          method: 'PATCH',
          token,
          body: {
            themeSettings: {
              primaryColor: '#3D5AFE',
              glassStyle: 'invalid-style',
            },
          },
        })
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Perfil inválido');
    });
  });

  describe('PATCH /users/me/profile with themeSettings', () => {
    it('updates themeSettings via profile route', async () => {
      const token = await tokenFor();
      const theme = {
        primaryColor: '#9C27B0',
        accentColor: '#1DE9B6',
        glassStyle: 'frosted',
      };

      m.user.update.mockResolvedValue({
        ...user,
        role: 'USER',
        themeSettings: theme,
        stickers: [],
        interests: [],
        socialLinks: null,
        voiceBioUrl: null,
        hasPaymentPassword: false,
        availability: null,
        _count: { followers: 0, following: 0 },
      });

      const res = await updateProfile(
        jsonRequest('http://localhost/users/me/profile', {
          method: 'PATCH',
          token,
          body: {
            themeSettings: theme,
          },
        })
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.themeSettings).toEqual(theme);
    });
  });
});
