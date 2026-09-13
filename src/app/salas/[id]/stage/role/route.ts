import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const roleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  avatarUrl: z.string().nullable().optional(),
  colorHex: z.string().optional().default('#00E5FF'),
  tagline: z.string().optional().default(''),
  description: z.string().optional().default(''),
  language: z.string().optional().default('Español'),
  isTaken: z.boolean().optional().default(false),
  takenByUserId: z.string().nullable().optional(),
  takenByUsername: z.string().nullable().optional(),
});

const bodySchema = z.object({
  action: z.enum(['take', 'leave']).optional(),
  role: roleSchema.nullable().optional(),
  roleId: z.string().optional(),
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

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail('Datos inválidos', 400);

    const { action, role, roleId } = parsed.data;
    const isTake = action === 'take' || (role != null && (role.isTaken || role.takenByUserId === session.userId));

    // Obtener participante
    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: session.userId } },
    });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, displayName: true },
    });
    const userName = user?.displayName || user?.username || 'Usuario';

    let currentStageRoles = Array.isArray(room.stageRoles) ? [...(room.stageRoles as any[])] : [];

    if (isTake && role) {
      // Tomar rol:
      const updatedRole = {
        ...role,
        isTaken: true,
        takenByUserId: session.userId,
        takenByUsername: userName,
      };

      // Si el participante existe, actualizar sus metadatos
      if (participant) {
        const currentMeta = (participant.metadata as Record<string, any>) || {};
        await prisma.roomParticipant.update({
          where: { id: participant.id },
          data: {
            metadata: {
              ...currentMeta,
              activeCharacter: updatedRole,
            },
          },
        });
      }

      // Actualizar o insertar en room.stageRoles
      const roleIndex = currentStageRoles.findIndex((r) => r.id === role.id);
      if (roleIndex >= 0) {
        currentStageRoles[roleIndex] = updatedRole;
      } else {
        currentStageRoles.push(updatedRole);
      }

      await prisma.room.update({
        where: { id: roomId },
        data: { stageRoles: currentStageRoles },
      });

      // Emitir evento socket a la sala
      emitToSala(roomId, 'room:stage_role', {
        action: 'take',
        role: updatedRole,
        userId: session.userId,
      });

      return ok({
        success: true,
        action: 'take',
        role: updatedRole,
      });
    } else {
      // Liberar rol (leave):
      const targetRoleId = role?.id || roleId;

      if (participant) {
        const currentMeta = (participant.metadata as Record<string, any>) || {};
        await prisma.roomParticipant.update({
          where: { id: participant.id },
          data: {
            metadata: {
              ...currentMeta,
              activeCharacter: null,
            },
          },
        });
      }

      // Liberar en room.stageRoles
      if (targetRoleId) {
        currentStageRoles = currentStageRoles.map((r) => {
          if (r.id === targetRoleId) {
            return {
              ...r,
              isTaken: false,
              takenByUserId: null,
              takenByUsername: null,
            };
          }
          return r;
        });
      } else {
        // Liberar todos los roles ocupados por este usuario en la sala
        currentStageRoles = currentStageRoles.map((r) => {
          if (r.takenByUserId === session.userId) {
            return {
              ...r,
              isTaken: false,
              takenByUserId: null,
              takenByUsername: null,
            };
          }
          return r;
        });
      }

      await prisma.room.update({
        where: { id: roomId },
        data: { stageRoles: currentStageRoles },
      });

      // Emitir evento socket a la sala
      emitToSala(roomId, 'room:stage_role', {
        action: 'leave',
        roleId: targetRoleId,
        userId: session.userId,
      });

      return ok({
        success: true,
        action: 'leave',
        roleId: targetRoleId,
      });
    }
  }
);
