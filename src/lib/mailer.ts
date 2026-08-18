import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

const mailFrom = process.env.MAIL_FROM ?? 'Kyubi Social <no-reply@kyubi.local>';

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const transport = getTransporter();
  if (!transport) {
    console.warn(`[mailer] SMTP no configurado. Correo NO enviado a ${to}: ${subject}`);
    console.log(`[mailer] Contenido:\n${text}`);
    return;
  }
  await transport.sendMail({ from: mailFrom, to, subject, text, html });
}

export function buildVerifyLink(token: string) {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildResetLink(token: string) {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}
