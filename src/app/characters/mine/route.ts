import { requireSession } from '@/lib/auth';
import { serializeCharacter } from '@/lib/character';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

/**
 * GET /characters/mine
 *
 * Devuelve las Fichas de Rol (OCs) del usuario autenticado:
 * id, name, avatarUrl, tagline, lore, powerLevel (level), atributos
 * (abilities/weaknesses) y tags (universes/genres).
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const characters = await prisma.character.findMany({
    where: { userId: session.userId },
    orderBy: [{ createdAt: 'asc' }],
  });

  return ok({
    data: characters.map(serializeCharacter),
    total: characters.length,
  });
});
