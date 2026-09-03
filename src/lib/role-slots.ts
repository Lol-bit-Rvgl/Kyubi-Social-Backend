import { Prisma } from '@prisma/client';

/**
 * Include estándar para RoleSlot con los datos de la vacante, el personaje
 * asignado y el usuario al que se asignó.
 */
export const roleSlotInclude = {
  assignedCharacter: {
    select: {
      id: true,
      name: true,
      alias: true,
      avatarUrl: true,
      tagline: true,
    },
  },
  assignedUser: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.RoleSlotInclude;

export type RoleSlotWithRelations = Prisma.RoleSlotGetPayload<{
  include: typeof roleSlotInclude;
}>;

export function serializeRoleSlot(slot: RoleSlotWithRelations) {
  return {
    id: slot.id,
    postId: slot.postId,
    title: slot.title,
    description: slot.description ?? null,
    requirements: slot.requirements ?? null,
    isOpen: slot.isOpen,
    assignedCharacterId: slot.assignedCharacterId ?? null,
    assignedUserId: slot.assignedUserId ?? null,
    assignedCharacter: slot.assignedCharacter ?? null,
    assignedUser: slot.assignedUser ?? null,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString(),
  };
}
