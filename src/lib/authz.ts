import { UserRole } from '@prisma/client';
import { requireSession, type Session } from './auth';
import { fail } from './http';
import { prisma } from './prisma';
import { getActiveMute, getBlockingSanction } from './moderation';

/**
 * Authorization layer.
 *
 * `requireSession` (pure JWT verification, untouched) is the only auth entry
 * point. These helpers add role + ban/mute enforcement on top of it so the
 * existing 68 tests — which run `requireSession` for real against mocked Prisma
 * — keep passing without changes to the session contract.
 *
 * Guards return either a `Response` (already-built error) or the resolved
 * principal; routes check with `if (result instanceof Response) return result;`.
 */

export type AuthUser = Session & { role: UserRole };

/** Jerarquía de roles — única fuente de verdad para todo el backend. */
export const ROLE_RANK: Record<UserRole, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasRoleAtLeast(role: UserRole | null | undefined, min: UserRole): boolean {
  const r = (role ?? 'USER') as UserRole;
  return (ROLE_RANK[r] ?? 0) >= ROLE_RANK[min];
}

const authUserSelect = { id: true, email: true, username: true, role: true } as const;

/** Resolve the session + load the user's role + reject if the account is banned. */
export async function requireUser(request: Request): Promise<Response | AuthUser> {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: authUserSelect,
  });
  if (!user) return fail('Usuario no encontrado', 404);
  const sanction = await getBlockingSanction(user.id);
  if (sanction) {
    return fail(
      sanction.kind === 'SUSPEND' && sanction.until
        ? `Tu cuenta está suspendida hasta ${sanction.until.toISOString()}`
        : 'Tu cuenta ha sido suspendida',
      403,
    );
  }
  return { ...session, role: user.role };
}

/** Require the session user to hold at least `min`. */
export async function requireRole(request: Request, min: UserRole): Promise<Response | AuthUser> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!hasRoleAtLeast(auth.role, min)) return fail('Permisos insuficientes', 403);
  return auth;
}

export function requireModerator(request: Request) {
  return requireRole(request, 'MODERATOR');
}
export function requireAdmin(request: Request) {
  return requireRole(request, 'ADMIN');
}
export function requireOwner(request: Request) {
  return requireRole(request, 'OWNER');
}

/**
 * Lighter guard for public content-creation endpoints (posts, circle posts,
 * circles, salas). Verifies session + blocks banned and muted users. Does not
 * load the full user record, so existing creation tests only need ban/mute
 * mocks (which default to "no record found").
 */
export async function assertCanCreateContent(request: Request): Promise<Response | Session> {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const sanction = await getBlockingSanction(session.userId);
  if (sanction) {
    return fail(
      sanction.kind === 'SUSPEND' && sanction.until
        ? `Tu cuenta está suspendida hasta ${sanction.until.toISOString()}`
        : 'Tu cuenta ha sido suspendida',
      403,
    );
  }
  const mute = await getActiveMute(session.userId);
  if (mute) return fail('Estás silenciado y no puedes publicar contenido', 403);
  return session;
}
