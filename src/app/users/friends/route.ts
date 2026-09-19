import { Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { toIso } from '@/lib/serialize';

/**
 * Campos públicos del amigo devueltos por `GET /users/friends`.
 * Se declara como `satisfies Prisma.UserSelect` para que el payload quede
 * tipado y cualquier cambio de esquema rompa la compilación, no el runtime.
 */
const friendSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  usernameColor: true,
  avatarFrame: true,
  level: true,
  isOnline: true,
} satisfies Prisma.UserSelect;

type FriendPayload = Prisma.UserGetPayload<{ select: typeof friendSelect }>;

/**
 * GET /users/friends
 *
 * "Amigo" = seguimiento mutuo bilateral ESTRICTO:
 *   1. El usuario autenticado sigue a X → `Follow(followerId = me, followingId = X)`
 *   2. X sigue al usuario autenticado  → `Follow(followerId = X, followingId = me)`
 *
 * En este esquema la fila `Follow` solo se crea al seguir directamente
 * (`POST /users/follow/:id`) o al ACEPTAR una `FollowRequest`
 * (`POST /users/me/follow-requests/:id`), por lo que su existencia equivale a
 * una relación aceptada/activa. Las relaciones unidireccionales (yo sigo pero
 * X no, o X me sigue pero yo no) quedan excluidas de la lista.
 *
 * Respuesta: `{ items: [...], total }` (formato compatible con el cliente,
 * que también acepta arrays planos mediante `_decodeObject`).
 */
export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const parsedLimit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
  const limit = Math.min(
    Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 100, 1),
    200,
  );

  // 1. A quién sigue el usuario autenticado (y desde cuándo, para ordenar).
  const followingRows = await prisma.follow.findMany({
    where: { followerId: session.userId },
    select: { followingId: true, createdAt: true },
  });
  if (followingRows.length === 0) return ok({ items: [], total: 0 });

  const followingSince = new Map<string, Date>();
  for (const row of followingRows) {
    // Defensa: nunca consideres al propio usuario como su amigo.
    if (row.followingId && row.followingId !== session.userId) {
      followingSince.set(row.followingId, row.createdAt);
    }
  }

  // 2. Quién sigue al usuario autenticado.
  const followerRows = await prisma.follow.findMany({
    where: { followingId: session.userId },
    select: { followerId: true },
  });

  // 3. Intersección → seguimiento recíproco; descarta unidireccionales.
  const mutualIds = Array.from(
    new Set(followerRows.map((row) => row.followerId)),
  ).filter(
    (id) => id && id !== session.userId && followingSince.has(id),
  );

  if (mutualIds.length === 0) return ok({ items: [], total: 0 });

  const users = await prisma.user.findMany({
    where: { id: { in: mutualIds } },
    select: friendSelect,
  });

  const byId = new Map<string, FriendPayload>(
    users.map((user) => [user.id, user]),
  );

  const items = mutualIds
    .map((id) => ({ id, user: byId.get(id), since: followingSince.get(id) }))
    .filter(
      (
        entry,
      ): entry is { id: string; user: FriendPayload; since: Date | undefined } =>
        entry.user != null,
    )
    .sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0))
    .slice(0, limit)
    .map(({ user, since }) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      usernameColor: user.usernameColor,
      avatarFrame: user.avatarFrame,
      level: user.level ?? 1,
      isOnline: user.isOnline ?? false,
      // El esquema de `User` aún no persiste un `lastSeenAt` real; se expone
      // explícitamente como `null` para que el cliente pueda tipar el campo.
      lastSeen: null as string | null,
      isFriend: true,
      friendsSince: toIso(since) ?? null,
    }));

  return ok({ items, total: items.length });
});