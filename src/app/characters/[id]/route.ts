import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { serializeCharacter } from '@/lib/character';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const stringList = (max = 40) =>
  z.array(z.string().trim().min(1).max(max)).max(20).optional();

/**
 * Esquema de actualización parcial: los mismos campos que en la creación,
 * pero todos opcionales para permitir PATCH parcial.
 */
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(20),
    alias: z.string().trim().max(40).nullable(),
    tagline: z.string().trim().max(30).nullable(),
    avatarUrl: z.string().max(2048).nullable(),
    bannerUrl: z.string().max(2048).nullable(),
    description: z.string().trim().max(300).nullable(),
    lore: z.string().trim().max(20000).nullable(),
    appearance: z.string().trim().max(20000).nullable(),
    abilities: stringList(),
    weaknesses: stringList(),
    universes: stringList(),
    genres: stringList(),
    faceClaim: z.string().trim().max(120).nullable(),
    voiceClaim: z.string().trim().max(120).nullable(),
    powerLevel: z.number().int().min(1).max(100),
    roleplayLevel: z.union([
      z.string().trim().max(24),
      z.number().int().min(1).max(4),
    ]),
    themeColor: z.string().trim().max(9).nullable(),
    themeAccent: z.string().trim().max(9).nullable(),
  })
  .partial();

const ROLEPLAY_LEVELS = ['Novato', 'Intermedio', 'Avanzado', 'Bíblico'] as const;

/**
 * GET /characters/[id]
 *
 * Devuelve el detalle público de una Ficha de Rol (OC).
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) return fail('Ficha de personaje no encontrada', 404);
    return ok(serializeCharacter(character));
  }
);

/**
 * PATCH /characters/[id]
 *
 * Actualiza los campos de la Ficha de Rol. Solo el dueño puede editarla.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const existing = await prisma.character.findUnique({ where: { id } });
    if (!existing) return fail('Ficha de personaje no encontrada', 404);
    if (existing.userId !== session.userId) {
      return fail('No tienes permiso para editar esta ficha', 403);
    }

    const body = updateSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail('Ficha de personaje inválida', 400);
    const data = body.data;

    const dataToUpdate: Record<string, unknown> = {};
    if (data.name !== undefined) dataToUpdate.name = data.name;
    if (data.alias !== undefined) dataToUpdate.alias = data.alias;
    if (data.tagline !== undefined) dataToUpdate.tagline = data.tagline;
    if (data.avatarUrl !== undefined) dataToUpdate.avatarUrl = data.avatarUrl;
    if (data.bannerUrl !== undefined) dataToUpdate.bannerUrl = data.bannerUrl;
    if (data.description !== undefined) {
      dataToUpdate.description = data.description;
    }
    if (data.lore !== undefined) dataToUpdate.lore = data.lore;
    if (data.appearance !== undefined) dataToUpdate.appearance = data.appearance;
    if (data.abilities !== undefined) dataToUpdate.abilities = data.abilities;
    if (data.weaknesses !== undefined) dataToUpdate.weaknesses = data.weaknesses;
    if (data.universes !== undefined) dataToUpdate.universes = data.universes;
    if (data.genres !== undefined) dataToUpdate.genres = data.genres;
    if (data.faceClaim !== undefined) dataToUpdate.faceClaim = data.faceClaim;
    if (data.voiceClaim !== undefined) dataToUpdate.voiceClaim = data.voiceClaim;
    if (data.powerLevel !== undefined) dataToUpdate.powerLevel = data.powerLevel;
    if (data.roleplayLevel !== undefined) {
      dataToUpdate.roleplayLevel =
        typeof data.roleplayLevel === 'number'
          ? ROLEPLAY_LEVELS[data.roleplayLevel - 1]
          : data.roleplayLevel;
    }
    if (data.themeColor !== undefined) dataToUpdate.themeColor = data.themeColor;
    if (data.themeAccent !== undefined) dataToUpdate.themeAccent = data.themeAccent;

    const character = await prisma.character.update({
      where: { id },
      data: dataToUpdate,
    });

    return ok(serializeCharacter(character));
  }
);

/**
 * DELETE /characters/[id]
 *
 * Elimina la Ficha de Rol. Solo el dueño puede eliminarla.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id } = await params;

    const existing = await prisma.character.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing) return fail('Ficha de personaje no encontrada', 404);
    if (existing.userId !== session.userId) {
      return fail('No tienes permiso para eliminar esta ficha', 403);
    }

    await prisma.character.delete({ where: { id } });

    // Saneamiento en eliminación: purgar o vaciar slots en salas activas que referencien a este personaje
    const activeRooms = await prisma.room.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, stageRoles: true },
    });

    for (const room of activeRooms) {
      if (!Array.isArray(room.stageRoles)) continue;
      let changed = false;
      const updatedStageRoles = (room.stageRoles as any[]).map((r, idx) => {
        if (
          r &&
          (String(r.id).trim() === id ||
            String(r.characterId || '').trim() === id)
        ) {
          changed = true;
          return {
            ...r,
            id: `slot-${idx + 1}`,
            name: `Slot ${idx + 1}`,
            isTaken: false,
            isOccupied: false,
            takenByUserId: null,
            takenByUsername: null,
            occupiedBy: null,
            occupiedByName: null,
            avatarUrl: null,
            tagline: '',
            description: '',
          };
        }
        return r;
      });

      if (changed) {
        await prisma.room.update({
          where: { id: room.id },
          data: { stageRoles: updatedStageRoles },
        });

        // Limpiar en participantes que tenían este personaje equipado
        const participants = await prisma.roomParticipant.findMany({
          where: { roomId: room.id },
        });
        for (const p of participants) {
          const meta = (p.metadata as Record<string, any>) || {};
          if (
            meta.activeCharacter &&
            (String(meta.activeCharacter.id).trim() === id ||
              String(meta.activeCharacter.characterId || '').trim() === id)
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

        emitToSala(room.id, 'roleplay:slot_updated', {
          action: 'delete',
          roleId: id,
          stageRoles: updatedStageRoles,
        });
        emitToSala(room.id, 'room:stage_role', {
          action: 'delete',
          roleId: id,
          stageRoles: updatedStageRoles,
        });
      }
    }

    return ok({ success: true });
  }
);
