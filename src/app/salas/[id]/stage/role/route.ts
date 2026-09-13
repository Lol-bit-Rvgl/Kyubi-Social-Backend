import { z } from 'zod';
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

const roleSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(20),
  avatarUrl: z.string().nullable().optional(),
  colorHex: z.string().optional().default('#00E5FF'),
  tagline: z.string().trim().max(30).optional().default(''),
  description: z.string().trim().max(300).optional().default(''),
  language: z.string().optional().default('Español'),
  isTaken: z.boolean().optional(),
  takenByUserId: z.string().nullable().optional(),
  takenByUsername: z.string().nullable().optional(),
});

const bodySchema = z.object({
  action: z.enum(['take', 'leave', 'create', 'update', 'delete']).optional(),
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

    let currentStageRoles = Array.isArray(room.stageRoles) ? [...(room.stageRoles as any[])] : [];

    // ── GESTIÓN DE ROLES (CREAR / EDITAR / ELIMINAR) ──
    if (action === 'create' || action === 'update') {
      const canManage = await canManageRoom(roomId, session.userId);
      if (!canManage) return fail('No tienes permiso para gestionar roles en esta sala', 403);
      if (!role) return fail('Datos de rol requeridos', 400);

      const roleIndex = currentStageRoles.findIndex((r) => r.id === role.id);
      let updatedRole: any;

      if (roleIndex >= 0) {
        const existing = currentStageRoles[roleIndex];
        updatedRole = {
          ...existing,
          ...role,
          isTaken: role.isTaken !== undefined ? role.isTaken : (existing.isTaken ?? false),
          takenByUserId: role.takenByUserId !== undefined ? role.takenByUserId : (existing.takenByUserId ?? null),
          takenByUsername: role.takenByUsername !== undefined ? role.takenByUsername : (existing.takenByUsername ?? null),
        };
        currentStageRoles[roleIndex] = updatedRole;
      } else {
        updatedRole = {
          ...role,
          isTaken: role.isTaken ?? false,
          takenByUserId: role.takenByUserId ?? null,
          takenByUsername: role.takenByUsername ?? null,
        };
        currentStageRoles.push(updatedRole);
      }

      await prisma.room.update({
        where: { id: roomId },
        data: { stageRoles: currentStageRoles },
      });

      emitToSala(roomId, 'room:stage_role', {
        action: action === 'create' ? 'create' : 'update',
        role: updatedRole,
        stageRoles: currentStageRoles,
        userId: session.userId,
      });

      return ok({
        success: true,
        action: action === 'create' ? 'create' : 'update',
        role: updatedRole,
        stageRoles: currentStageRoles,
      });
    }

    if (action === 'delete') {
      const canManage = await canManageRoom(roomId, session.userId);
      if (!canManage) return fail('No tienes permiso para gestionar roles en esta sala', 403);
      const targetRoleId = roleId || role?.id;
      if (!targetRoleId) return fail('ID de rol requerido', 400);

      currentStageRoles = currentStageRoles.filter((r) => r.id !== targetRoleId);

      // Limpiar rol si algún participante lo tenía equipado
      const affectedParticipants = await prisma.roomParticipant.findMany({
        where: { roomId },
      });
      for (const p of affectedParticipants) {
        const meta = (p.metadata as Record<string, any>) || {};
        if (meta.activeCharacter?.id === targetRoleId) {
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

      return ok({
        success: true,
        action: 'delete',
        roleId: targetRoleId,
        stageRoles: currentStageRoles,
      });
    }

    // ── ADOPCIÓN O LIBERACIÓN DE ROL POR PARTICIPANTE ──
    const isTake = action === 'take' || (role != null && (role.isTaken || role.takenByUserId === session.userId));

    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId, userId: session.userId } },
    });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, username: true, displayName: true },
    });
    const userName = user?.displayName || user?.username || 'Usuario';

    if (isTake && role) {
      // Tomar rol:
      const updatedRole = {
        ...role,
        isTaken: true,
        takenByUserId: session.userId,
        takenByUsername: userName,
      };

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

      emitToSala(roomId, 'room:stage_role', {
        action: 'take',
        role: updatedRole,
        stageRoles: currentStageRoles,
        userId: session.userId,
      });

      return ok({
        success: true,
        action: 'take',
        role: updatedRole,
        stageRoles: currentStageRoles,
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

      emitToSala(roomId, 'room:stage_role', {
        action: 'leave',
        roleId: targetRoleId,
        stageRoles: currentStageRoles,
        userId: session.userId,
      });

      return ok({
        success: true,
        action: 'leave',
        roleId: targetRoleId,
        stageRoles: currentStageRoles,
      });
    }
  }
);
