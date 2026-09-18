import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeAuthor } from '@/lib/serialize';
import { serializeRoom } from '@/lib/social';
import { emitToSala } from '@/lib/socketio';

async function roomDetail(roomId: string) {
  return prisma.room.findUnique({
    where: { id: roomId },
    include: {
      host: true,
      circle: { select: { id: true, name: true, avatarUrl: true } },
      participants: { include: { user: true }, orderBy: { joinedAt: 'asc' }, take: 50 },
      _count: { select: { participants: true } },
    },
  });
}

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session?.userId) return fail('No autorizado', 401);
    const { id } = await params;

    const room = await prisma.room.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, capacity: true, hostId: true },
    });
    if (!room) return fail('Sala no encontrada', 404);
    if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId: id, userId: session.userId } },
    });

    if (!participant) {
      return fail('No tienes una invitación para esta sala', 404);
    }

    if (participant.role !== 'INVITED') {
      // Ya es miembro activo de la sala
      const current = await roomDetail(id);
      if (!current) return fail('Sala no encontrada', 404);
      return ok(
        serializeRoom(current, {
          myUserId: session.userId,
          isParticipant: true,
          fullParticipants: current.participants,
        })
      );
    }

    if (room.capacity != null) {
      const activeCount = await prisma.roomParticipant.count({
        where: { roomId: id, role: { not: 'INVITED' } },
      });
      if (activeCount >= room.capacity) return fail('La sala está llena', 400);
    }

    // Actualizar rol a PARTICIPANT
    await prisma.roomParticipant.update({
      where: { id: participant.id },
      data: { role: 'PARTICIPANT', joinedAt: new Date() },
    });

    try {
      const actor = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, username: true, displayName: true },
      });
      const userName = actor?.displayName || actor?.username || 'Un usuario';
      const body = `${userName} aceptó la invitación y se unió.`;
      const extensions = {
        subType: 'USER_JOIN',
        userId: session.userId,
        userName,
      };

      const systemMsg = await prisma.roomMessage.create({
        data: {
          roomId: id,
          senderId: session.userId,
          type: 'SYSTEM',
          body,
          extensions,
        },
        include: { sender: true },
      });

      emitToSala(id, 'room:message', {
        id: systemMsg.id,
        roomId: systemMsg.roomId,
        senderId: systemMsg.senderId,
        sender: serializeAuthor(systemMsg.sender),
        senderName: userName,
        username: systemMsg.sender.username,
        roleId: null,
        roleName: null,
        type: 'SYSTEM',
        content: systemMsg.body,
        metadata: extensions,
        body: systemMsg.body,
        characterId: null,
        characterName: null,
        characterAvatarUrl: null,
        extensions,
        createdAt: systemMsg.createdAt.toISOString(),
      });
    } catch (err) {
      console.error('[invite:accept] Error al emitir mensaje de sistema:', err);
    }

    const updated = await roomDetail(id);
    if (!updated) return fail('Sala no encontrada', 404);

    return ok(
      serializeRoom(updated, {
        myUserId: session.userId,
        isParticipant: true,
        fullParticipants: updated.participants,
      })
    );
  }
);
