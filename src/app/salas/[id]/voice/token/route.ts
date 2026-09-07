import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createVoiceToken } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';

/**
 * POST /salas/[id]/voice/token
 * Emite un token LiveKit para entrar al canal de voz de una sala.
 * Requiere: sesión activa, usuario no sancionado (ban/mute global) y que ya
 * sea participante de la sala. La identidad es el userId y los metadatos
 * llevan avatar + rol para la fila de avatares viva.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await assertCanCreateContent(request);
    if (session instanceof Response) return session;
    const { id } = await params;

    const [participant, user] = await Promise.all([
      prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId: session.userId } },
        select: { role: true },
      }),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      }),
    ]);
    if (!participant) return fail('Debes entrar a la sala para hablar', 403);
    if (!user) return fail('Usuario no encontrado', 401);

    const roomName = `sala_${id}`;
    try {
      const { token, url } = await createVoiceToken({
        identity: session.userId,
        name: user.displayName ?? user.username,
        room: roomName,
        metadata: {
          avatarUrl: user.avatarUrl ?? null,
          role: participant.role,
        },
      });
      return ok({ token, url, roomName });
    } catch {
      return fail('El canal de voz no está disponible ahora mismo', 503);
    }
  }
);