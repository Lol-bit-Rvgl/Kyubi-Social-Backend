import { Prisma } from '@prisma/client';

export type CharacterPayload = Prisma.CharacterGetPayload<Record<string, never>>;

/** Convierte un campo JSON de la BD en lista de strings segura. */
function toStringList(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Serializa una Ficha de Rol (OC) para el frontend.
 * Las claves coinciden con `Character.fromJson` en kyubi_Frontend.
 */
export function serializeCharacter(character: CharacterPayload) {
  return {
    id: character.id,
    userId: character.userId,
    name: character.name,
    alias: character.alias,
    tagline: character.tagline,
    avatarUrl: character.avatarUrl,
    bannerUrl: character.bannerUrl,
    description: character.description,
    lore: character.lore,
    appearance: character.appearance,
    abilities: toStringList(character.abilities),
    weaknesses: toStringList(character.weaknesses),
    universes: toStringList(character.universes),
    genres: toStringList(character.genres),
    faceClaim: character.faceClaim,
    voiceClaim: character.voiceClaim,
    powerLevel: character.powerLevel,
    roleplayLevel: character.roleplayLevel,
    themeColor: character.themeColor,
    themeAccent: character.themeAccent,
    createdAt: character.createdAt.toISOString(),
    updatedAt: character.updatedAt.toISOString(),
  };
}
