import { requireSession } from '@/lib/auth';
import { getActiveMute, getBlockingSanction } from '@/lib/moderation';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { createVoiceToken, isLiveKitEnabled } from '@/lib/livekit';
import { prisma } from '@/lib/prisma';

/**
 * POST /salas/[id]/voice/token
 * Emite un token LiveKit para entrar al canal de voz de una sala.
 * Requiere: sesión activa, usuario no sancionado (ban/mute global o en la sala),
 * sala en estado ACTIVE y autorización estricta en salas privadas (host, participante o miembro del círculo).
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

    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);

    const sanction = await getBlockingSanction(session.userId);
    if (sanction) {
      return fail(
        sanction.kind === 'SUSPEND' && sanction.until
          ? `Tu cuenta está suspendida hasta ${sanction.until.toISOString()}`
          : 'Tu cuenta ha sido suspendida',
        403,
      );
    }

    const activeMute = await getActiveMute(session.userId);
    if (activeMute) {
      return fail('Tu usuario tiene el micrófono restringido o sancionado', 403);
    }

    const [room, participant, user] = await Promise.all([
      prisma.room.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          access: true,
          circleId: true,
          hostId: true,
        },
      }),
      prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId: session.userId } },
        select: { role: true, metadata: true },
      }),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      }),
    ]);
    if (!room) return fail('Sala no encontrada', 404);
    if (!user) return fail('Usuario no encontrado', 401);

    if (room.status && room.status !== 'ACTIVE') {
      return fail('La sala ha terminado', 400);
    }

    const isParticipantMuted = (participant?.metadata as any)?.isMuted === true;
    if (isParticipantMuted) {
      return fail('Tu usuario tiene el micrófono restringido o sancionado', 403);
    }

    if (room.access === 'PRIVATE') {
      const isHost = room.hostId === session.userId;
      const isParticipant = Boolean(participant);
      let isCircleMember = false;

      if (!isHost && !isParticipant && room.circleId) {
        const circleMembership = await prisma.circleMember.findUnique({
          where: {
            circleId_userId: {
              circleId: room.circleId,
              userId: session.userId,
            },
          },
          select: { id: true },
        });
        isCircleMember = Boolean(circleMembership);
      }

      if (!isHost && !isParticipant && !isCircleMember) {
        return fail('No tienes acceso a la sala de voz de este círculo/sala privada', 403);
      }
    }

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