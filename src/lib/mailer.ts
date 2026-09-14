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

const mailFrom =
  process.env.EMAIL_FROM ??
  process.env.MAIL_FROM ??
  'Kyubi Social <no-reply@kyubi.app>';

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

export function buildResetLink(token: string, email?: string) {
  const base = process.env.APP_URL ?? 'https://kyubi.app';
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : '';
  return `${base}/reset-password?token=${encodeURIComponent(token)}${emailParam}`;
}

export async function sendPasswordResetOtpEmail(params: {
  email: string;
  username: string;
  code: string;
  token: string;
}) {
  const { email, username, code, token } = params;
  const link = buildResetLink(token, email);

  // Fallback / log explícito para pruebas y desarrollo local
  console.log(`[DEBUG] Password reset code for ${email}: ${code}`);
  console.log(`[DEBUG] Password reset link for ${email}: ${link}`);

  const subject = 'Tu código de recuperación de contraseña - Kyubi';
  const text = `Hola ${username},\n\n` +
    `Tu código de recuperación de contraseña es:\n\n` +
    `  ${code}\n\n` +
    `Este código es válido por 15 minutos.\n\n` +
    `También puedes restablecer tu contraseña haciendo clic en el siguiente enlace:\n` +
    `${link}\n\n` +
    `Si no solicitaste este cambio, puedes ignorar este correo con total seguridad.\n`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0d0c15; color: #ffffff; padding: 32px 20px; text-align: center;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #14121f; border: 1px solid #28213b; border-radius: 16px; padding: 32px 24px; text-align: left;">
        <h2 style="color: #00E5FF; margin-top: 0; font-size: 22px;">Recuperación de Contraseña</h2>
        <p style="color: #c4c1d4; font-size: 14px; line-height: 1.5;">
          Hola <strong style="color: #ffffff;">${username}</strong>, recibimos una solicitud para restablecer tu contraseña en Kyubi.
        </p>
        <p style="color: #9e9cb0; font-size: 13px; margin-bottom: 8px;">
          Ingresa este código de 6 dígitos en la aplicación:
        </p>
        <div style="background-color: #1d182e; border: 1px dashed #00E5FF; border-radius: 12px; padding: 18px; text-align: center; margin: 16px 0;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #00E5FF; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #8b889e; font-size: 12px; text-align: center; margin-bottom: 24px;">
          (Válido por 15 minutos)
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${link}" style="background-color: #FF0055; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 14px; display: inline-block;">
            Restablecer con enlace directo
          </a>
        </div>
        <hr style="border: none; border-top: 1px solid #231e36; margin: 24px 0;" />
        <p style="color: #6b687d; font-size: 11.5px; line-height: 1.4; margin-bottom: 0;">
          Si tú no realizaste esta solicitud, puedes ignorar este mensaje. Tu cuenta sigue estando protegida.
        </p>
      </div>
    </div>
  `;

  await sendMail(email, subject, text, html);
}

