import { z } from 'zod';
import { clientIp, issueTokenPair, verifyPassword } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { getBlockingSanction } from '@/lib/moderation';

const input = z.object({ email: z.string().email(), password: z.string().min(1) });
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 });

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  // NO loguear el body: contiene credenciales (email + contraseña).
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const parsed = input.safeParse(body);
  if (!parsed.success) return fail('Credenciales inválidas', 401);

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    include: { _count: { select: { followers: true, following: true } } },
  });
  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? null);
  if (!user || !valid) return fail('Credenciales inválidas', 401);

  const sanction = await getBlockingSanction(user.id);
  if (sanction) {
    return fail(
      sanction.kind === 'SUSPEND' && sanction.until
        ? `Tu cuenta está suspendida hasta ${sanction.until.toISOString()}`
        : 'Tu cuenta ha sido suspendida',
      403,
    );
  }

  return ok({
    ...(await issueTokenPair(user)),
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      emailVerifiedAt: user.emailVerifiedAt,
      onboardingCompleted: user.onboardingCompleted,
      role: user.role,
      isFollowing: false,
      followersCount: user._count?.followers ?? 0,
      followingCount: user._count?.following ?? 0,
    },
  });
});
