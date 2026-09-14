import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { sha256Hex } from './hash';
import { prisma } from './prisma';
import { buildResetLink, buildVerifyLink, sendMail, sendPasswordResetOtpEmail } from './mailer';

const TOKEN_TTL_HOURS = 24;

async function createToken(userId: string, type: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET') {
  const token = randomBytes(32).toString('base64url');
  await prisma.verificationToken.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      type,
      expiresAt: new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000),
    },
  });
  return token;
}

export async function sendVerificationEmail(user: { id: string; email: string; username: string }) {
  const token = await createToken(user.id, 'EMAIL_VERIFICATION');
  const link = buildVerifyLink(token);
  await sendMail(
    user.email,
    'Verifica tu correo en Kyubi',
    `Hola ${user.username},\n\nConfirma tu correo con este enlace (válido por ${TOKEN_TTL_HOURS}h):\n${link}\n\nSi no creaste esta cuenta, ignora este mensaje.`,
    `<p>Hola ${user.username},</p><p>Confirma tu correo con este enlace (válido por ${TOKEN_TTL_HOURS}h):</p><p><a href="${link}">${link}</a></p>`
  );
}

export async function verifyEmail(token: string) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!record || record.type !== 'EMAIL_VERIFICATION' || record.consumedAt || record.expiresAt < new Date()) {
    return false;
  }
  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  return true;
}

export async function sendPasswordResetOtp(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    // Protección contra enumeración de correos
    return true;
  }

  // Generar código numérico de 6 dígitos (ej. 100000 - 999999)
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  // Generar token criptográfico único para deep link
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60_000); // 15 minutos

  // Invalidar tokens previos no utilizados para este correo
  await prisma.passwordResetToken.updateMany({
    where: { email: normalizedEmail, used: false },
    data: { used: true },
  });

  // Crear nuevo registro de recuperación
  await prisma.passwordResetToken.create({
    data: {
      email: normalizedEmail,
      code,
      token,
      expiresAt,
      used: false,
    },
  });

  // Enviar correo (incluye log en consola en modo local/desarrollo)
  await sendPasswordResetOtpEmail({
    email: normalizedEmail,
    username: user.username,
    code,
    token,
  });

  return true;
}

export async function resetPasswordWithOtpOrToken({
  email,
  code,
  token,
  newPassword,
}: {
  email?: string;
  code?: string;
  token?: string;
  newPassword: string;
}) {
  if (!code && !token) {
    return { success: false, error: 'Se requiere código OTP de 6 dígitos o token de recuperación' };
  }

  let normalizedEmail = email ? email.trim().toLowerCase() : undefined;

  // Si no se proporcionó email pero sí token, intentar resolver el email a partir del token
  if (!normalizedEmail && token) {
    const byToken = await prisma.passwordResetToken.findFirst({
      where: {
        token,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });
    if (byToken) {
      normalizedEmail = byToken.email;
    }
  }

  if (!normalizedEmail) {
    return { success: false, error: 'Correo no especificado o inválido' };
  }

  const orConditions: Array<{ code?: string; token?: string }> = [];
  if (code) orConditions.push({ code: code.trim() });
  if (token) orConditions.push({ token: token.trim() });

  const record = await prisma.passwordResetToken.findFirst({
    where: {
      email: normalizedEmail,
      used: false,
      expiresAt: { gt: new Date() },
      OR: orConditions,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { success: false, error: 'Código o enlace de recuperación inválido o expirado' };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { success: false, error: 'Usuario no encontrado' };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used: true },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { success: true };
}

// Mantener compatibilidad con funciones existentes
export async function sendPasswordResetEmail(email: string) {
  return sendPasswordResetOtp(email);
}

export async function resetPassword(token: string, newPassword: string) {
  const res = await resetPasswordWithOtpOrToken({ token, newPassword });
  return res.success;
}

