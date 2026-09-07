import { z } from 'zod';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createVoiceToken } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';

const tokenSchema = z.object({
  targetUserId: z.string().trim().min(1).max(100),
});

/**
 * POST /messages/voice/token
 * Emite un token LiveKit para una llamada directa 1-a-1. El nombre de la sala
 * es canónico ordenando los dos id: `dm_<min>_<max>`, así ambos extremos
 * acaban conectados al mismo room.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = tokenSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Destinatario inválido', 400);
  if (body.data.targetUserId === session.userId) {
    return fail('No puedes llamarte a ti mismo', 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: body.data.targetUserId },
    select: { id: true },
  });
  if (!target) return fail('Usuario no encontrado', 404);

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, displayName: true, username: true, avatarUrl: true },
  });
  if (!me) return fail('Usuario no encontrado', 401);

  const roomName = ['dm', ...[session.userId, body.data.targetUserId].sort()].join('_');

  try {
    const { token, url } = await createVoiceToken({
      identity: session.userId,
      name: me.displayName ?? me.username,
      room: roomName,
      metadata: { avatarUrl: me.avatarUrl ?? null },
    });
    return ok({ token, url, roomName });
  } catch {
    return fail('El canal de voz no está disponible ahora mismo', 503);
  }
});