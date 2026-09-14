import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { clientIp, issueTokenPair } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getBlockingSanction } from '@/lib/moderation';
import { serializeUser } from '@/lib/serialize';

const input = z.object({ idToken: z.string().min(10) });
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });

export const POST = withErrorHandling(async (request: Request) => {
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (!parsed.success) return fail('Token de Google inválido', 400);

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const client = new OAuth2Client(googleClientId);

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: parsed.data.idToken,
      audience: googleClientId || undefined,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.warn('[google-auth] Error verificando idToken:', err);
    return fail('Token de Google inválido', 401);
  }

  if (!payload || !payload.sub) {
    return fail('Token de Google inválido', 401);
  }

  if (payload.email_verified === false) {
    return fail('El correo de Google no está verificado', 400);
  }

  const googleId = payload.sub;
  const email = payload.email?.toLowerCase().trim();
  if (!email) {
    return fail('No se pudo obtener el correo asociado a la cuenta de Google', 400);
  }

  const displayName = payload.name?.trim() || null;
  const avatarUrl = payload.picture || null;

  // 1. Buscar usuario existente por googleId
  let user = await prisma.user.findUnique({
    where: { googleId },
    include: { _count: { select: { followers: true, following: true } } },
  });

  // 2. Si no se encontró por googleId, buscar por email para vincularlo
  if (!user) {
    user = await prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { followers: true, following: true } } },
    });

    if (user) {
      // Vincular googleId y sincronizar avatarUrl / emailVerifiedAt si estaban vacíos
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          avatarUrl: user.avatarUrl ?? avatarUrl,
        },
        include: { _count: { select: { followers: true, following: true } } },
      });
    }
  }

  // 3. Si sigue sin existir, registrar un nuevo usuario
  if (!user) {
    const rawUsername = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const baseUsername = rawUsername.length >= 3 ? rawUsername.slice(0, 20) : `user_${rawUsername}`;

    let candidate = baseUsername;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { username: candidate } })) {
      const suffix = counter.toString();
      candidate = `${baseUsername.slice(0, 30 - suffix.length)}${suffix}`;
      counter++;
    }

    user = await prisma.user.create({
      data: {
        email,
        username: candidate,
        displayName: displayName || candidate,
        avatarUrl,
        googleId,
        emailVerifiedAt: new Date(),
        onboardingCompleted: false,
      },
      include: { _count: { select: { followers: true, following: true } } },
    });
  }

  // 4. Verificar posibles sanciones activas
  const sanction = await getBlockingSanction(user.id);
  if (sanction) {
    return fail(
      sanction.kind === 'SUSPEND' && sanction.until
        ? `Tu cuenta está suspendida hasta ${sanction.until.toISOString()}`
        : 'Tu cuenta ha sido suspendida',
      403,
    );
  }

  // 5. Emitir tokens de sesión de Kyubi
  const tokenPair = await issueTokenPair(user);
  return ok({
    ...tokenPair,
    token: tokenPair.accessToken,
    user: serializeUser(user, { isMe: true }),
  });
});
