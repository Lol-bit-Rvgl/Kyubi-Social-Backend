import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { sha256Hex } from './hash';
import { prisma } from './prisma';
import { buildResetLink, buildVerifyLink, sendMail } from './mailer';

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

export async function sendPasswordResetEmail(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return false;
  const token = await createToken(user.id, 'PASSWORD_RESET');
  const link = buildResetLink(token);
  await sendMail(
    user.email,
    'Restablece tu contraseña en Kyubi',
    `Hola ${user.username},\n\nRestablece tu contraseña con este enlace (válido por ${TOKEN_TTL_HOURS}h):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
    `<p>Hola ${user.username},</p><p>Restablece tu contraseña con este enlace (válido por ${TOKEN_TTL_HOURS}h):</p><p><a href="${link}">${link}</a></p>`
  );
  return true;
}

export async function resetPassword(token: string, newPassword: string) {
  const record = await prisma.verificationToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
  if (!record || record.type !== 'PASSWORD_RESET' || record.consumedAt || record.expiresAt < new Date()) {
    return false;
  }
  await prisma.$transaction([
    prisma.verificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } }),
    prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return true;
}
