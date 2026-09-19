import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const leaveSchema = z.object({
  slotIndex: z.number().int().min(0).max(50).optional(),
  roleId: z.string().trim().min(1).optional(),
});

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId } = await params;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, hostId: true, stageRoles: true },
    });
    if (!room) return fail('Sala no encontrada', 404);
    if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

    const body = leaveSchema.safeParse(await request.json().catch(() => ({})));
    const { slotIndex, roleId } = body.success ? body.data : { slotIndex: undefined, roleId: undefined };

    let currentStageRoles = Array.isArray(room.stageRoles)
      ? (room.stageRoles as any[]).filter(
          (r) =>
            r &&
            typeof r === 'object' &&
            r.id &&
            String(r.name || '').trim().length > 0
        )
      : [];

    let leftRole: any = null;

    if (slotIndex !== undefined && slotIndex >= 0 && slotIndex < currentStageRoles.length) {
      const slot = currentStageRoles[slotIndex];
      leftRole = { ...slot };
      currentStageRoles[slotIndex] = {
        ...slot,
        isTaken: false,
        isOccupied: false,
        takenByUserId: null,
        takenByUsername: null,
        occupiedBy: null,
        occupiedByName: null,
      };
    } else if (roleId) {
      const idx = currentStageRoles.findIndex((r) => String(r.id).trim() === roleId);
      if (idx >= 0) {
        const slot = currentStageRoles[idx];
        leftRole = { ...slot };
        currentStageRoles[idx] = {
          ...slot,
          isTaken: false,
          isOccupied: false,
          takenByUserId: null,
          takenByUsername: null,
          occupiedBy: null,
          occupiedByName: null,
        };
      }
    } else {
      // Liberar todos los slots del usuario si no se especifica slotIndex ni roleId
      currentStageRoles = currentStageRoles.map((r) => {
        if (r.takenByUserId === session.userId || r.occupiedBy === session.userId) {
          leftRole = leftRole || { ...r };
          return {
            ...r,
            isTaken: false,
            isOccupied: false,
            takenByUserId: null,
            takenByUsername: null,
            occupiedBy: null,
            occupiedByName: null,
          };
        }
        return r;
      });
    }

    // Comprobar si el usuario aún posee otros roles activos en la sala
    const remainingRole = currentStageRoles.find(
      (r) =>
        r.isTaken &&
        (r.takenByUserId === session.userId || r.occupiedBy === session.userId)
    );

    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: session.userId } },
    });

    if (participant) {
      const meta = (participant.metadata as Record<string, any>) || {};
      await prisma.roomParticipant.update({
        where: { id: participant.id },
        data: {
          metadata: {
            ...meta,
            activeCharacter: remainingRole ?? null,
          },
        },
      });
    }

    await prisma.room.update({
      where: { id: roomId },
      data: { stageRoles: currentStageRoles },
    });

    emitToSala(roomId, 'room:stage_role', {
      action: 'leave',
      role: leftRole,
      roleId: leftRole?.id,
      slotIndex,
      stageRoles: currentStageRoles,
      userId: session.userId,
    });

    emitToSala(roomId, 'roleplay:slot_updated', {
      action: 'leave',
      role: leftRole,
      roleId: leftRole?.id,
      slotIndex,
      stageRoles: currentStageRoles,
      userId: session.userId,
    });

    return ok({
      success: true,
      action: 'leave',
      slotIndex,
      role: leftRole,
      stageRoles: currentStageRoles,
    });
  }
);
