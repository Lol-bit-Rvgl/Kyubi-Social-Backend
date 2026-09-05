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

/**
 * Headers de IP que sólo debe escribir un proxy/balanceador de confianza
 * (Cloudflare, el LB de Render, Nginx, ...).
 *
 * Regla de seguridad: NO se confían las cabeceras de reenvío
 * (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`) a menos que se cumpla
 * una frontera de confianza explícitamente configurada:
 *
 *   - `TRUSTED_PROXY_SECRET` (recomendado): si está definida, la petición debe
 *     adjuntar esa misma cadena en la cabecera `X-Proxy-Secret` (la inyecta el
 *     propio proxy). Un cliente externo sin el secreto NO puede forjar su IP.
 *   - `TRUSTED_PROXIES`: nº de proxies de confianza en `x-forwarded-for`. Se
 *     descartan esa cantidad de hops desde la derecha (los logs de cada LB) y
 *     se devuelve el primer hop NO confiable, i.e. la IP del cliente real.
 *
 * Si no hay frontera configurada, NO se usan las cabeceras de IP (spoofeables)
 * y se cae en un bucket defensivo por agente para que el rate-limiting siga
 * funcionando sin que todas las peticiones sin IP compartan un único balde.
 *
 * `clientIp` NO debe usarse para autorización; su misión es exclusivamente
 * rate-limiting.
 */
const TRUSTED_PROXY_SECRET = process.env.TRUSTED_PROXY_SECRET || '';
const TRUSTED_PROXIES = Math.max(0, Number(process.env.TRUSTED_PROXIES) || 0);

function isUsableIp(value: string | null | undefined): value is string {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (v.toLowerCase() === 'unknown' || v === '0.0.0.0' || v === '::') return false;
  // Rechaza paquetes que mezclan varios valores o caracteres inesperados.
  if (/[^a-fA-F0-9:.\s]/.test(v)) return false;
  return true;
}

export function clientIp(request: Request): string {
  const secretOk =
    TRUSTED_PROXY_SECRET.length > 0 &&
    request.headers.get('x-proxy-secret') === TRUSTED_PROXY_SECRET;

  // Solo se confía en cabeceras de reenvío cuando hay una frontera verificada:
  //   - con secret configurado y presente en la petición, o
  //   - sin secret pero con un recuento de proxies de confianza explícito.
  const trustForwarded =
    secretOk || (TRUSTED_PROXY_SECRET.length === 0 && TRUSTED_PROXIES > 0);

  if (trustForwarded) {
    // Cloudflare fija `cf-connecting-ip`; solo se acepta tras verificar el secret.
    const cf = request.headers.get('cf-connecting-ip');
    if (isUsableIp(cf)) return cf!.trim();

    const xff = request.headers.get('x-forwarded-for');
    if (xff) {
      const hops = xff.split(',').map((h) => h.trim()).filter(isUsableIp);
      if (hops.length > 0) {
        // Primer hop NO confiable: descartamos `TRUSTED_PROXIES` desde la
        // derecha (los log de cada LB) y tomamos el siguiente hacia la izquierda.
        const idx = Math.max(0, hops.length - 1 - TRUSTED_PROXIES);
        const chosen = hops[idx];
        if (chosen) return chosen;
      }
    }

    const xri = request.headers.get('x-real-ip');
    if (isUsableIp(xri)) return xri!.trim();
  }

  // Sin frontera de confianza: NO se usan cabeceras de IP (spoofeables). Bucket
  // defensivo derivado del agente/idioma para mantener el rate-limiting.
  const fingerprint = [
    request.headers.get('user-agent'),
    request.headers.get('accept-language'),
    request.headers.get('accept-encoding'),
  ].filter((v) => v);
  if (fingerprint.length) return `proxy:${sha256Hex(fingerprint.join('|'))}`;
  return 'unknown';
}
