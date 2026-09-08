import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createVoiceToken, isLiveKitEnabled } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';

/**
 * POST /salas/[id]/voice/token
 * Emite un token LiveKit para entrar al canal de voz de una sala.
 * Requiere: sesión activa, usuario no sancionado (ban/mute global) y que la
 * sala exista. NO se bloquea por el estado previo de participación (el socket
 * ya validó la membresía al entrar a la sala); si el usuario aún no figura
 * como participante se asume rol MEMBER. La identidad es el userId y los
 * metadatos llevan avatar + rol para la fila de avatares viva.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    console.log('[LIVEKIT_ROUTE] Request received for room:', id);

    if (!isLiveKitEnabled()) {
      console.error(
        '[LIVEKIT_ROUTE] LiveKit no configurado. ' +
          `LIVEKIT_URL=${process.env.LIVEKIT_URL ?? 'undefined'} ` +
          `LIVEKIT_API_KEY=${process.env.LIVEKIT_API_KEY ? 'set' : 'undefined'} ` +
          `LIVEKIT_API_SECRET=${process.env.LIVEKIT_API_SECRET ? 'set' : 'undefined'}`,
      );
    }

    const session = await assertCanCreateContent(request);
    if (session instanceof Response) return session;

    const [room, participant, user] = await Promise.all([
      prisma.room.findUnique({ where: { id }, select: { id: true } }),
      prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId: session.userId } },
        select: { role: true },
      }),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      }),
    ]);
    if (!room) return fail('Sala no encontrada', 404);
    if (!user) return fail('Usuario no encontrado', 401);

    const roomName = `sala_${id}`;
    try {
      const { token, url } = await createVoiceToken({
        identity: session.userId,
        name: user.displayName ?? user.username,
        room: roomName,
        metadata: {
          avatarUrl: user.avatarUrl ?? null,
          role: participant?.role ?? 'MEMBER',
        },
      });
      return ok({ token, url, roomName });
    } catch (err) {
      console.error(`[voice/token] Error emitiendo token para ${roomName}:`, err);
      return fail('El canal de voz no está disponible ahora mismo', 503);
    }
  }
);