import { requireSession } from '@/lib/auth';
import { serializeCharacter } from '@/lib/character';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';

/**
 * GET /users/[username]/characters
 *
 * Devuelve las Fichas de Rol (OCs) de un usuario.
 * Acepta `username`, `id` de usuario o `me` (usuario autenticado).
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { username } = await params;

    const target =
      username === 'me'
        ? await prisma.user.findUnique({
            where: { id: session.userId },
            select: { id: true },
          })
        : await findUserByIdOrUsername(username);
    if (!target) return fail('Usuario no encontrado', 404);

    const characters = await prisma.character.findMany({
      where: { userId: target.id },
      orderBy: [{ createdAt: 'asc' }],
    });

    return ok({
      data: characters.map(serializeCharacter),
      total: characters.length,
    });
  }
);
