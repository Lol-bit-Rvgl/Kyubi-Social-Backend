import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { clientIp, issueTokenPair } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/verification';

const input = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(30).optional(),
});
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  // NO loguear el body: contiene credenciales (email + contraseña).
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const parsed = input.safeParse(body);
  if (!parsed.success) {
    console.error('Error en registro: validación fallida', JSON.stringify(parsed.error.issues));
    return fail('Datos de registro inválidos');
  }

  const { email, username, password, displayName } = parsed.data;

  try {
    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username: { equals: username, mode: 'insensitive' } }] },
    });
    if (exists) return fail('El correo o nombre de usuario ya existe', 409);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          username,
          displayName: displayName ?? username,
          passwordHash: await bcrypt.hash(password, 12),
        },
      });
    } catch (error) {
      console.error('Error en registro: prisma.user.create', error);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return fail('El correo o nombre de usuario ya existe', 409);
      }
      throw error;
    }

    sendVerificationEmail(user).catch((error) => console.warn('[register] no se pudo enviar el correo de verificación:', error));

    return ok(
      {
        ...(await issueTokenPair(user)),
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          emailVerifiedAt: user.emailVerifiedAt,
          onboardingCompleted: user.onboardingCompleted,
          isFollowing: false,
          followersCount: 0,
          followingCount: 0,
        },
      },
      201
    );
  } catch (error) {
    console.error('Error en registro:', error);
    throw error;
  }
});
