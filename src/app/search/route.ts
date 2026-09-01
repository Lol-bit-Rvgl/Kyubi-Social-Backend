import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

/**
 * GET /search?q=&type=all|posts|users|rooms&limit=&offset=
 *
 * Búsqueda full-text PostgreSQL (tsvector/tsquery) con ranking de relevancia
 * `ts_rank` sobre los índices GIN de posts, usuarios y salas. Fallback suave
 * con ILIKE cuando el full-text no arroja suficientes resultados (p.ej.
 * términos con caracteres especiales, prefijos o coincidencias parciales).
 */

const SEARCH_CONFIG = 'spanish';

/** Limpia la query: remueve #, comillas y caracteres especiales de plainto_tsquery. */
function sanitizeQuery(raw: string): string {
  return raw
    .replace(/[#"'`]/g, '')       // caracteres problemáticos
    .replace(/\s+/g, ' ')         // colapsa espacios múltiples
    .trim();
}

interface RawPostRow {
  id: string;
  content: string;
  title: string | null;
  tags: string[];
  coverImageUrl: string | null;
  authorId: string;
  authorName: string | null;
  authorUsername: string;
  authorAvatar: string | null;
  rank: number;
}

interface RawUserRow {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  usernameColor: string | null;
  avatarFrame: string | null;
  level: number | null;
  isOnline: boolean | null;
  rank: number;
}

interface RawRoomRow {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  hostName: string | null;
  participantCount: bigint | number;
  rank: number;
}

const POST_FIELDS = `p."id", p."content", p."title", p."tags", p."coverImageUrl",
  p."authorId", u."displayName" AS "authorName", u."username" AS "authorUsername",
  u."avatarUrl" AS "authorAvatar"`;
const USER_FIELDS = `u."id", u."username", u."displayName", u."avatarUrl",
  u."bio", u."usernameColor", u."avatarFrame",
  u."level", u."isOnline"`;
const ROOM_FIELDS = `r."id", r."name", r."description", r."imageUrl",
  (SELECT u2."displayName" FROM "User" u2 WHERE u2."id" = r."hostId") AS "hostName",
  (SELECT COUNT(*) FROM "RoomParticipant" rp WHERE rp."roomId" = r."id") AS "participantCount"`;

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const qClean = sanitizeQuery(q);
  const type = (url.searchParams.get('type') ?? 'all').toLowerCase();
  const requested = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 50) : 20;
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    if (q.length < 2) {
    return ok({ data: [], posts: [], users: [], rooms: [], query: q, type, total: 0 });
  }

  const wantPosts = type === 'all' || type === 'posts';
  const wantUsers = type === 'all' || type === 'users';
  const wantRooms = type === 'all' || type === 'rooms';

  const [posts, users, rooms] = await Promise.all([
    wantPosts ? searchPosts(qClean, limit, offset) : Promise.resolve([] as RawPostRow[]),
    wantUsers
      ? searchUsers(qClean, limit, offset, session.userId)
      : Promise.resolve([] as (RawUserRow & { isFollowing: boolean })[]),
    wantRooms ? searchRooms(qClean, limit, offset) : Promise.resolve([] as RawRoomRow[]),
  ]);

  return ok({
    data: [...posts, ...users, ...rooms],
    posts,
    users,
    rooms,
    query: q,
    type,
    total: posts.length + users.length + rooms.length,
  });

  // ── Full-text + fallback ILIKE ──────────────────────────────────────────

  async function searchPosts(query: string, take: number, skip: number): Promise<RawPostRow[]> {
    const tsRows = await prisma.$queryRawUnsafe<RawPostRow[]>(
      `SELECT ${POST_FIELDS}, ts_rank(
          to_tsvector($1, coalesce(p."content", '') || ' ' || array_to_string(p."tags", ' ')),
          plainto_tsquery($1, $2)) AS rank
       FROM "Post" p JOIN "User" u ON u."id" = p."authorId"
       WHERE to_tsvector($1, coalesce(p."content", '') || ' ' || array_to_string(p."tags", ' '))
             @@ plainto_tsquery($1, $2)
       ORDER BY rank DESC, p."createdAt" DESC
       LIMIT $3 OFFSET $4`,
      SEARCH_CONFIG,
      query,
      take,
      skip,
    );
    if (tsRows.length >= Math.min(take, 5)) return tsRows;

    // Fallback ILIKE (prefijos, caracteres especiales, coincidencia parcial).
    const likeRows = await prisma.$queryRawUnsafe<RawPostRow[]>(
      `SELECT ${POST_FIELDS}, 0 AS rank
       FROM "Post" p JOIN "User" u ON u."id" = p."authorId"
       WHERE p."content" ILIKE $1 OR EXISTS (
         SELECT 1 FROM unnest(p."tags") t WHERE t ILIKE $2)
       ORDER BY p."createdAt" DESC
       LIMIT $3 OFFSET $4`,
      `%${query}%`,
      `${query}%`,
      take,
      skip,
    );
    return mergeRows(tsRows, likeRows, (r) => r.id);
  }

  async function searchUsers(
    query: string,
    take: number,
    skip: number,
    viewerId: string,
  ): Promise<(RawUserRow & { isFollowing: boolean })[]> {
    const tsRows = await prisma.$queryRawUnsafe<RawUserRow[]>(
      `SELECT ${USER_FIELDS}, ts_rank(
          to_tsvector('simple', coalesce(u."username", '') || ' ' ||
            coalesce(u."displayName", '') || ' ' || coalesce(u."bio", '')),
          plainto_tsquery('simple', $1)) AS rank
       FROM "User" u
       WHERE to_tsvector('simple', coalesce(u."username", '') || ' ' ||
               coalesce(u."displayName", '') || ' ' || coalesce(u."bio", ''))
             @@ plainto_tsquery('simple', $1)
       ORDER BY rank DESC, u."username" ASC
       LIMIT $2 OFFSET $3`,
      query,
      take,
      skip,
    );

    // Fallback ILIKE con prefijo (importante para @usernames).
    const likeRows = await prisma.$queryRawUnsafe<RawUserRow[]>(
      `SELECT ${USER_FIELDS}, 0 AS rank
       FROM "User" u
       WHERE u."username" ILIKE $1 OR u."displayName" ILIKE $1 OR u."bio" ILIKE $2
       ORDER BY u."username" ASC
       LIMIT $3 OFFSET $4`,
      `${query}%`,
      `%${query}%`,
      take,
      skip,
    );

    const merged = mergeRows(tsRows, likeRows, (r) => r.id).slice(0, take);
    if (merged.length === 0) return [];

    const ids = merged.map((u) => u.id);
    const follows = await prisma.follow.findMany({
      where: { followerId: viewerId, followingId: { in: ids } },
      select: { followingId: true },
    });
    const followed = new Set(follows.map((f) => f.followingId));
    return merged.map((u) => ({
      ...u,
      isFollowing: followed.has(u.id) && u.id !== viewerId,
    }));
  }

  async function searchRooms(query: string, take: number, skip: number): Promise<RawRoomRow[]> {
    const tsRows = await prisma.$queryRawUnsafe<RawRoomRow[]>(
      `SELECT ${ROOM_FIELDS}, ts_rank(
          to_tsvector($1, coalesce(r."name", '') || ' ' || coalesce(r."description", '')),
          plainto_tsquery($1, $2)) AS rank
       FROM "Room" r
       WHERE r."status" = 'ACTIVE' AND r."access" = 'PUBLIC'
         AND to_tsvector($1, coalesce(r."name", '') || ' ' || coalesce(r."description", ''))
             @@ plainto_tsquery($1, $2)
       ORDER BY rank DESC, r."createdAt" DESC
       LIMIT $3 OFFSET $4`,
      SEARCH_CONFIG,
      query,
      take,
      skip,
    );
    if (tsRows.length >= Math.min(take, 5)) return tsRows;

    const likeRows = await prisma.$queryRawUnsafe<RawRoomRow[]>(
      `SELECT ${ROOM_FIELDS}, 0 AS rank
       FROM "Room" r
       WHERE r."status" = 'ACTIVE' AND r."access" = 'PUBLIC'
         AND (r."name" ILIKE $1 OR r."description" ILIKE $2)
       ORDER BY r."createdAt" DESC
       LIMIT $3 OFFSET $4`,
      `%${query}%`,
      `%${query}%`,
      take,
      skip,
    );
    return mergeRows(tsRows, likeRows, (r) => r.id);
  }

  function mergeRows<T>(primary: T[], fallback: T[], key: (row: T) => string): T[] {
    const seen = new Set(primary.map(key));
    return [...primary, ...fallback.filter((r) => !seen.has(key(r)))];
  }
});

