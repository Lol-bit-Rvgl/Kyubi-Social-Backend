import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const MANAGEABLE_ROLES = new Set(['HOST', 'CO_HOST', 'MODERATOR', 'ADMIN']);

async function canManageRoom(roomId: string, userId: string): Promise<boolean> {
  const [room, participant] = await Promise.all([
    prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, hostId: true },
    }),
    prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { role: true },
    }),
  ]);
  if (!room || room.status !== 'ACTIVE') return false;
  if (room.hostId === userId) return true;
  return Boolean(participant && MANAGEABLE_ROLES.has(participant.role.toUpperCase()));
}

export const DELETE = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; roleId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId, roleId } = await params;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, status: true, hostId: true, stageRoles: true },
    });
    if (!room) return fail('Sala no encontrada', 404);
    if (room.status !== 'ACTIVE') return fail('La sala ha terminado', 400);

    const canManage = await canManageRoom(roomId, session.userId);
    if (!canManage) return fail('No tienes permiso para gestionar roles en esta sala', 403);

    const targetRoleId = String(roleId).trim();
    let currentStageRoles = Array.isArray(room.stageRoles)
      ? (room.stageRoles as any[]).filter(
          (r) =>
            r &&
            typeof r === 'object' &&
            r.id &&
            String(r.name || '').trim().length > 0
        )
      : [];

    currentStageRoles = currentStageRoles.filter(
      (r: any) => String(r.id).trim() !== targetRoleId
    );

    // Limpiar rol si algún participante lo tenía equipado
    const affectedParticipants = await prisma.roomParticipant.findMany({
      where: { roomId },
    });
    for (const p of affectedParticipants) {
      const meta = (p.metadata as Record<string, any>) || {};
      if (
        meta.activeCharacter &&
        String(meta.activeCharacter.id).trim() === targetRoleId
      ) {
        await prisma.roomParticipant.update({
          where: { id: p.id },
          data: {
            metadata: {
              ...meta,
              activeCharacter: null,
            },
          },
        });
      }
    }

    await prisma.room.update({
      where: { id: roomId },
      data: { stageRoles: currentStageRoles },
    });

    emitToSala(roomId, 'room:stage_role', {
      action: 'delete',
      roleId: targetRoleId,
      stageRoles: currentStageRoles,
      userId: session.userId,
    });

    emitToSala(roomId, 'roleplay:slot_updated', {
      action: 'delete',
      roleId: targetRoleId,
      stageRoles: currentStageRoles,
    });

    return ok({
      success: true,
      action: 'delete',
      roleId: targetRoleId,
      stageRoles: currentStageRoles,
    });
  }
);
