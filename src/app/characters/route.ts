import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { serializeCharacter } from '@/lib/character';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const stringList = (max = 40) => z.array(z.string().trim().min(1).max(max)).max(20).optional();

/**
 * POST /characters
 *
 * Crea una Ficha de Rol (OC) para el usuario autenticado.
 * Requerido: `name`. El resto de campos son opcionales; las listas
 * (abilities/weaknesses/universes/genres) se guardan como JSON.
 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(20),
  alias: z.string().trim().max(40).nullable().optional(),
  tagline: z.string().trim().max(30).nullable().optional(),
  avatarUrl: z.string().max(2048).nullable().optional(),
  bannerUrl: z.string().max(2048).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  lore: z.string().trim().max(20000).nullable().optional(),
  appearance: z.string().trim().max(20000).nullable().optional(),
  abilities: stringList(),
  weaknesses: stringList(),
  universes: stringList(),
  genres: stringList(),
  faceClaim: z.string().trim().max(120).nullable().optional(),
  voiceClaim: z.string().trim().max(120).nullable().optional(),
  powerLevel: z.number().int().min(1).max(100).optional(),
  // Acepta etiqueta textual ('Novato'...) o nivel numérico (1..4).
  roleplayLevel: z
    .union([z.string().trim().max(24), z.number().int().min(1).max(4)])
    .optional(),
  themeColor: z.string().trim().max(9).nullable().optional(),
  themeAccent: z.string().trim().max(9).nullable().optional(),
});

const ROLEPLAY_LEVELS = ['Novato', 'Intermedio', 'Avanzado', 'Bíblico'] as const;

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Ficha de personaje inválida', 400);
  const data = body.data;

  const roleplayLevel =
    typeof data.roleplayLevel === 'number'
      ? ROLEPLAY_LEVELS[data.roleplayLevel - 1]
      : (data.roleplayLevel ?? 'Novato');

  const character = await prisma.character.create({
    data: {
      userId: session.userId,
      name: data.name,
      alias: data.alias ?? null,
      tagline: data.tagline ?? null,
      avatarUrl: data.avatarUrl ?? null,
      bannerUrl: data.bannerUrl ?? null,
      description: data.description ?? null,
      lore: data.lore ?? null,
      appearance: data.appearance ?? null,
      abilities: data.abilities ?? [],
      weaknesses: data.weaknesses ?? [],
      universes: data.universes ?? [],
      genres: data.genres ?? [],
      faceClaim: data.faceClaim ?? null,
      voiceClaim: data.voiceClaim ?? null,
      powerLevel: data.powerLevel ?? 1,
      roleplayLevel,
      themeColor: data.themeColor ?? null,
      themeAccent: data.themeAccent ?? null,
    },
  });

  return ok(serializeCharacter(character), 201);
});
