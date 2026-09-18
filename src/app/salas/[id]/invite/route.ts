import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala, emitToUser } from '@/lib/socketio';

const inviteSchema = z.object({
  userIds: z.array(z.string().min(1)).max(50).optional(),
  userId: z.string().min(1).optional(),
});

/**
 * Invita a usuarios a una sala (requiere ser participante o host).
 *
 * Crea la `RoomParticipant` de cada invitado (acceso efectivo a la sala),
 * emite `room:invited` a la sala personal de cada usuario y publica un mensaje
 * de sistema en el chat. Devuelve cuántos usuarios fueron invitados.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const room = await prisma.room.findUnique({
      where: { id },
      select: { id: true, name: true, imageUrl: true, status: true, hostId: true },
    });
    if (!room) return fail('Sala no encontrada', 404);
    if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

    const isHost = room.hostId === session.userId;
    if (!isHost) {
      const membership = await prisma.roomParticipant.findUnique({
        where: { roomId_userId: { roomId: id, userId: session.userId } },
        select: { id: true },
      });
      if (!membership) return fail('No autorizado', 403);
    }

    const body = inviteSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Datos inválidos');

    const candidates = [
      ...(body.data.userIds ?? []),
      ...(body.data.userId ? [body.data.userId] : []),
    ];
    const targets = [...new Set(candidates)].filter(
      (uid) => uid && uid !== session.userId,
    );
    if (targets.length === 0) return fail('userId o userIds requerido');

    // Solo se invita a usuarios existentes y que aún no estén dentro.
    const [users, existing] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: targets } },
        select: { id: true, username: true, displayName: true },
      }),
      prisma.roomParticipant.findMany({
        where: { roomId: id, userId: { in: targets } },
        select: { userId: true },
      }),
    ]);
    const alreadyIn = new Set(existing.map((p) => p.userId));

    const actor = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, displayName: true },
    });
    const inviterName = actor?.displayName || actor?.username || 'Alguien';

    const invited: string[] = [];
    const invitedNames: string[] = [];

    for (const user of users) {
      if (alreadyIn.has(user.id)) continue;
      try {
        await prisma.roomParticipant.create({
          data: { roomId: id, userId: user.id, role: 'INVITED' },
        });
      } catch {
        // Ya era participante (carrera con join): lo tratamos como invitado.
      }
      invited.push(user.id);
      invitedNames.push(user.displayName || user.username);

      const inviteData = {
        roomId: id,
        roomName: room.name,
        roomBanner: room.imageUrl ?? null,
        invitedBy: inviterName,
        senderId: session.userId,
        senderUsername: inviterName,
        timestamp: new Date().toISOString(),
      };
      emitToUser(user.id, 'room:invite_received', inviteData);
      emitToUser(user.id, 'room:invited', inviteData);
    }

    if (invited.length > 0) {
      try {
        const body = invitedNames.length === 1
          ? `${inviterName} invitó a ${invitedNames[0]}.`
          : `${inviterName} invitó a ${invitedNames.length} usuarios.`;
        const extensions = {
          subType: 'USER_INVITED',
          userIds: invited,
          invitedBy: session.userId,
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
          senderName: inviterName,
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
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[invite:route] Error publicando mensaje de sistema en sala:${id}:`, message);
      }
    }

    return ok({ invited: invited.length, userIds: invited });
  }
);
