import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { prisma } from '@/lib/prisma';

/**
 * Firebase Cloud Messaging (FCM) — notificaciones push reales.
 *
 * La inicialización es 100% defensiva: si faltan las credenciales
 * (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) el
 * servidor arranca igual y `sendPushNotification` se convierte en no-op.
 * También acepta `GOOGLE_APPLICATION_CREDENTIALS` (ruta al JSON de servicio).
 */

let cachedMessaging: Messaging | null | undefined;

function isFcmConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      (process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY),
  );
}

/** Devuelve la instancia de Messaging o `null` si FCM no está disponible. */
function getMessagingSafe(): Messaging | null {
  if (cachedMessaging !== undefined) return cachedMessaging;
  cachedMessaging = null;
  if (!isFcmConfigured()) {
    console.warn(
      '[FCM] Credenciales ausentes (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY). Push deshabilitado.',
    );
    return null;
  }
  try {
    if (getApps().length === 0) {
      const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(
        /\\n/g,
        '\n',
      );
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        }),
      });
    }
    cachedMessaging = getMessaging();
  } catch (error) {
    console.error('[FCM] Error al inicializar Firebase Admin:', error);
    cachedMessaging = null;
  }
  return cachedMessaging;
}

export interface PushNotification {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string | null;
}

/**
 * Envía una notificación push a todos los dispositivos registrados de un
 * usuario. Limpia los tokens inválidos/expirados que reporte FCM.
 * Nunca lanza: los fallos de push no deben romper el flujo de negocio.
 */
export async function sendPushNotification(params: PushNotification): Promise<void> {
  try {
    const messaging = getMessagingSafe();
    if (!messaging) return;

    const tokens = await prisma.deviceToken.findMany({
      where: { userId: params.userId },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const message = {
      notification: {
        title: params.title,
        body: params.body,
        ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
      },
      data: params.data ?? {},
    };

    const response = await messaging.sendEachForMulticast({
      ...message,
      tokens: tokens.map((t) => t.token),
    });

    // Limpieza de tokens inválidos (app desinstalada, token rotado, etc.).
    const invalid = response.responses
      .map((r, i) => (r.success ? null : tokens[i].token))
      .filter((t): t is string => t !== null);
    if (invalid.length > 0) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
    }
  } catch (error) {
    console.error('[FCM] Error al enviar push:', error);
  }
}

/** Elimina todos los tokens de un usuario (logout / cierre de cuenta). */
export async function deleteUserPushTokens(userId: string): Promise<void> {
  try {
    await prisma.deviceToken.deleteMany({ where: { userId } });
  } catch (error) {
    console.error('[FCM] Error al eliminar tokens:', error);
  }
}
