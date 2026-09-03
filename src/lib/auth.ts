import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { sha256Hex } from './hash';
import { prisma } from './prisma';
import { getActiveBan } from './moderation';

const BUILD_SECRET_PLACEHOLDER = 'build-time-placeholder-do-not-use-in-production';

function getSecret(): Uint8Array {
  const rawSecret = process.env.JWT_SECRET;
  if (!rawSecret || rawSecret.length < 32) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return new TextEncoder().encode(BUILD_SECRET_PLACEHOLDER);
    }
    throw new Error('JWT_SECRET must be set and contain at least 32 characters');
  }
  return new TextEncoder().encode(rawSecret);
}

export const hash = sha256Hex;

export type Session = { userId: string; email: string; username: string };

let _dummyHash: string | null = null;
function getDummyHash() {
  if (_dummyHash == null) _dummyHash = bcrypt.hashSync('timing-equalizer-password', 12);
  return _dummyHash;
}

export function verifyPassword(password: string, passwordHash: string | null) {
  return bcrypt.compare(password, passwordHash ?? getDummyHash());
}

export async function signAccessToken(session: Session) {
  return new SignJWT({ email: session.email, username: session.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(process.env.ACCESS_TOKEN_TTL ?? '15m')
    .sign(getSecret());
}

export async function requireSession(request: Request): Promise<Session | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return { userId: payload.sub!, email: String(payload.email), username: String(payload.username) };
  } catch {
    return null;
  }
}

export async function issueTokenPair(user: { id: string; email: string; username: string }) {
  const accessToken = await signAccessToken({ userId: user.id, email: user.email, username: user.username });
  const refreshToken = randomBytes(48).toString('base64url');
  const days = Number(process.env.REFRESH_TOKEN_DAYS ?? 30);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash(refreshToken),
      expiresAt: new Date(Date.now() + days * 86400000),
    },
  });
  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(refreshToken: string) {
  const tokenHash = hash(refreshToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.expiresAt < new Date()) return null;

  const banned = await getActiveBan(record.userId);
  if (banned) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  // Reclamo atómico: solo una de las peticiones concurrentes puede marcar el
  // token como revocado. Si count === 0 el token ya fue consumido por otra
  // petición (o revocado antes): posible robo de sesión → revocamos la familia.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (claimed.count === 0) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  return issueTokenPair(record.user);
}

export async function revokeRefreshToken(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function cleanupExpiredRefreshTokens() {
  await prisma.refreshToken.deleteMany({
    where: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }] },
  });
}

export function clientIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
