import type { Mock } from 'vitest';

export type PrismaMock = {
  user: { findFirst: Mock; findUnique: Mock; findMany: Mock; create: Mock; update: Mock; count: Mock };
  refreshToken: { create: Mock; findUnique: Mock; update: Mock; updateMany: Mock; deleteMany: Mock };
  verificationToken: { create: Mock; findUnique: Mock; update: Mock };
  passwordResetToken: { create: Mock; findFirst: Mock; update: Mock; updateMany: Mock; deleteMany?: Mock };
  post: { create: Mock; findMany: Mock; findUnique: Mock; update: Mock; delete: Mock; count: Mock };
  follow: { findMany: Mock; findUnique: Mock; upsert: Mock; deleteMany: Mock };
  reaction: { upsert: Mock; deleteMany: Mock; findMany: Mock };
  circle: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock; delete: Mock; count: Mock };
  circleMember: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock; delete: Mock };
  room: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock; delete: Mock; count: Mock };
  roomParticipant: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock; updateMany?: Mock; upsert?: Mock; delete: Mock; deleteMany: Mock; count: Mock };
  roomMessage: { create: Mock; findMany: Mock; findUnique: Mock; update: Mock; delete: Mock };
  ban: { findFirst: Mock; findMany: Mock; findUnique: Mock; create: Mock; update: Mock; updateMany: Mock; count: Mock };
  mute: { findFirst: Mock; findMany: Mock; findUnique: Mock; create: Mock; update: Mock; updateMany: Mock; count: Mock };
  moderationLog: { findMany: Mock; create: Mock; count: Mock };
  report: { findFirst: Mock; findMany: Mock; findUnique: Mock; create: Mock; update: Mock; count: Mock };
  conversation: { findFirst: Mock; findUnique: Mock; findMany: Mock; create: Mock; update: Mock; delete: Mock; count: Mock };
  conversationMember: { findFirst: Mock; findUnique: Mock; findMany: Mock; create: Mock; update: Mock; delete: Mock; count: Mock };
  block: { findFirst: Mock; findUnique: Mock; findMany: Mock; create: Mock; update: Mock; delete: Mock; upsert: Mock; count: Mock };
  $queryRawUnsafe: Mock;
  $queryRaw: Mock;
  $transaction: Mock;
};

export function jsonRequest(
  url: string,
  { method = 'GET', body, token, ip }: { method?: string; body?: unknown; token?: string; ip?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (ip) headers['x-forwarded-for'] = ip;
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user_one',
    passwordHash: 'hashed',
    displayName: 'User One',
    avatarUrl: null,
    bio: null,
    emailVerifiedAt: null,
    role: 'USER',
    onboardingCompleted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    authorId: 'user-1',
    content: 'Hello world',
    visibility: 'PUBLIC',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
