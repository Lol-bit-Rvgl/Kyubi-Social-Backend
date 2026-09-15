import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { clientIp, issueTokenPair } from '@/lib/auth';
import { createRateLimiter } from '@/lib/rate-limit';
import { NextResponse } from 'next/server';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/verification';

const input = z.object({
  email: z.string().email('El correo electrónico no es válido'),
  username: z
    .string()
    .min(3, 'El nombre de usuario debe tener al menos 3 caracteres')
    .max(30, 'El nombre de usuario no puede tener más de 30 caracteres')
    .regex(/^[a-zA-Z0-9_]+$/, 'El nombre de usuario solo puede contener letras, números y guiones bajos'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(128, 'La contraseña es demasiado larga'),
  displayName: z
    .string()
    .min(1, 'El nombre no puede estar vacío')
    .max(30, 'El nombre no puede tener más de 30 caracteres')
    .optional(),
});
const limiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  // NO loguear el body: contiene credenciales (email + contraseña).
  if (!(await limiter(clientIp(request)))) return fail('Demasiados intentos, inténtalo más tarde', 429);

  const parsed = input.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue?.message || 'Datos de registro inválidos';
    console.warn('Error en registro: validación fallida', JSON.stringify(parsed.error.issues));
    return NextResponse.json(
      { error: 'validation_error', message, issues: parsed.error.issues },
      { status: 400 }
    );
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
