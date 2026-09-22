import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const occupySchema = z.object({
  slotIndex: z.number().int().min(0).optional(),
  roleSheetId: z.string().trim().min(1),
});

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId } = await params;

    const body = occupySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Datos de ocupación inválidos', 400);
    const { slotIndex, roleSheetId } = body.data;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, stageRoles: true, hostId: true },
    });
    if (!room) return fail('Sala no encontrada', 404);
    if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

    const isHost = room.hostId === session.userId;
    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: session.userId } },
      select: { id: true, role: true, leftAt: true },
    });
    const isMember =
      isHost ||
      Boolean(
        participant &&
          participant.role !== 'INVITED' &&
          participant.leftAt === null
      );
    if (!isMember) {
      return fail(
        'Debes unirte a la sala para poder participar en el Stage de Roleplay',
        403
      );
    }

    const character = await prisma.character.findFirst({
      where: { id: roleSheetId, userId: session.userId },
    });
    if (!character) {
      return fail('Ficha de personaje no encontrada o no te pertenece', 404);
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, displayName: true },
    });
    const userName = user?.displayName || user?.username || 'Usuario';

    let currentStageRoles = Array.isArray(room.stageRoles)
      ? (room.stageRoles as any[]).filter(
          (r) =>
            r &&
            typeof r === 'object' &&
            r.id &&
            String(r.name || '').trim().length > 0
        )
      : [];

    let targetIndex = slotIndex;
    if (targetIndex !== undefined && targetIndex >= 0) {
      if (targetIndex < currentStageRoles.length) {
        const currentOccupant = currentStageRoles[targetIndex];
        const isOccupiedByOther =
          (currentOccupant.isTaken || currentOccupant.isOccupied) &&
          (currentOccupant.takenByUserId !== session.userId &&
            currentOccupant.occupiedBy !== session.userId);
        if (isOccupiedByOther) {
          return fail('Este espacio del stage ya está ocupado', 409);
        }
      }
    }

    // Desduplicar únicamente si la misma ficha de personaje ya estaba en otro slot previo (mover la ficha)
    currentStageRoles = currentStageRoles.map((r, idx) => {
      const isSameCharacter =
        r.id === character.id || (r as any).characterId === character.id;
      if (isSameCharacter) {
        return {
          ...r,
          id: r.id.startsWith('slot-') ? r.id : `slot-${idx + 1}`,
          name: r.id.startsWith('slot-') ? r.name : `Slot ${idx + 1}`,
          avatarUrl: null,
          colorHex: '#00E5FF',
          tagline: '',
          description: '',
          language: 'Español',
          isTaken: false,
          isOccupied: false,
          takenByUserId: null,
          takenByUsername: null,
          occupiedBy: null,
          occupiedByName: null,
          characterId: null,
        };
      }
      return r;
    });

    const occupiedRole = {
      id: character.id,
      characterId: character.id,
      name: character.name,
      avatarUrl: character.avatarUrl ?? null,
      colorHex: character.themeColor || '#00E5FF',
      tagline: character.tagline || '',
      description: character.description || '',
      language: 'Español',
      isTaken: true,
      isOccupied: true,
      takenByUserId: session.userId,
      takenByUsername: userName,
      occupiedBy: session.userId,
      occupiedByName: userName,
    };

    if (targetIndex !== undefined && targetIndex >= 0) {
      if (targetIndex < currentStageRoles.length) {
        currentStageRoles[targetIndex] = occupiedRole;
      } else {
        while (currentStageRoles.length < targetIndex) {
          const idx = currentStageRoles.length + 1;
          currentStageRoles.push({
            id: `slot-${idx}`,
            name: `Slot ${idx}`,
            isTaken: false,
            isOccupied: false,
            takenByUserId: null,
            takenByUsername: null,
            occupiedBy: null,
            occupiedByName: null,
            colorHex: '#00E5FF',
            tagline: '',
            description: '',
            language: 'Español',
          });
        }
        currentStageRoles.push(occupiedRole);
      }
    } else {
      const vacantIndex = currentStageRoles.findIndex(
        (r) => !r.isTaken && !r.isOccupied
      );
      if (vacantIndex >= 0) {
        targetIndex = vacantIndex;
        currentStageRoles[vacantIndex] = occupiedRole;
      } else {
        targetIndex = currentStageRoles.length;
        currentStageRoles.push(occupiedRole);
      }
    }

    await prisma.room.update({
      where: { id: roomId },
      data: { stageRoles: currentStageRoles },
    });

    // Actualizar metadata del participante
    await prisma.roomParticipant.updateMany({
      where: { roomId, userId: session.userId },
      data: {
        metadata: {
          activeCharacter: occupiedRole,
        },
      },
    });

    // Emisión por socket en tiempo real
    emitToSala(roomId, 'roleplay:slot_updated', {
      slotIndex: targetIndex,
      role: occupiedRole,
      stageRoles: currentStageRoles,
      userId: session.userId,
    });

    emitToSala(roomId, 'room:stage_role', {
      action: 'take',
      role: occupiedRole,
      stageRoles: currentStageRoles,
      userId: session.userId,
    });

    return ok({
      success: true,
      slotIndex: targetIndex,
      role: occupiedRole,
      stageRoles: currentStageRoles,
    });
  }
);
