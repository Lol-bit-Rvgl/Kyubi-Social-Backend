import { UserRole, ModerationAction, Prisma } from '@prisma/client';
import { requireUser, hasRoleAtLeast, ROLE_RANK, type AuthUser } from './authz';
import { fail } from './http';
import { prisma } from './prisma';
import { emitToUser, emitToRoom } from './socketio';

/** Acciones válidas del enum `ModerationAction` (validación runtime sin `as any`). */
const VALID_MODERATION_ACTIONS: ReadonlySet<string> = new Set(
  Object.values(ModerationAction)
);

/**
 * Require the caller to be at least MODERATOR (or higher).
 * Returns the AuthUser or a 403 Response.
 *
 * Usage:
 *   const auth = await requireStaffRole(request, 'MODERATOR'); // at least moderator
 *   const auth = await requireStaffRole(request, ['ADMIN', 'OWNER']); // only admin/owner
 */
export async function requireStaffRole(
  request: Request,
  minRole: UserRole | UserRole[] = 'MODERATOR'
): Promise<Response | AuthUser> {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  // Jerarquía única (ROLE_RANK/hasRoleAtLeast de authz.ts): con una lista se
  // exige el rango del rol más bajo de la lista; con un rol, ese mismo rango.
  const minRankedRole: UserRole = Array.isArray(minRole)
    ? minRole.reduce((a, b) => (ROLE_RANK[b] < ROLE_RANK[a] ? b : a))
    : minRole;

  if (!hasRoleAtLeast(auth.role, minRankedRole)) {
    return fail('Permisos insuficientes. Se requiere ser miembro del staff.', 403);
  }

  return auth;
}

/** Special guard for destructive actions requiring ADMIN or higher */
export function requireAdminRole(request: Request) {
  return requireStaffRole(request, 'ADMIN');
}

/** Special guard for system-critical actions requiring OWNER */
export function requireOwnerRole(request: Request) {
  return requireStaffRole(request, 'OWNER');
}

/**
 * Jerarquía de objetivos: un staff no puede sancionar/alterar a un usuario
 * de rango igual o superior. Solo el propio OWNER puede tocar a un OWNER.
 *
 * Ejemplos:
 *  - MODERATOR → no puede tocar MODERATOR, ADMIN ni OWNER
 *  - ADMIN → no puede tocar ADMIN ni OWNER (sí MODERATOR/USER)
 *  - OWNER → puede tocar a cualquiera (incluido otro OWNER)
 */
export function canTargetUser(
  actorRole: UserRole,
  targetRole: UserRole
): boolean {
  if (actorRole === 'OWNER') return true;
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

export function assertCanTargetUser(
  actorRole: UserRole,
  targetRole: UserRole
): Response | null {
  if (!canTargetUser(actorRole, targetRole)) {
    return fail(
      'No puedes aplicar esta acción a un usuario de rango igual o superior.',
      403
    );
  }
  return null;
}

/**
 * Write an entry to ModerationLog with extended fields for the admin panel.
 */
export async function writeModerationLog(
  db: Prisma.TransactionClient | typeof prisma,
  args: {
    moderatorId: string;
    action: string; // e.g. 'BAN_USER', 'WARN', 'PIN_POST', etc.
    targetType: 'USER' | 'POST' | 'REPORT' | 'CIRCLE' | 'ROOM' | 'COMMENT' | 'MESSAGE';
    targetId: string;
    targetUserId?: string | null;
    targetPostId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  // Validación runtime explícita contra el enum de Prisma en lugar de
  // `action as any`, para no perder type-safety ni registrar basura en auditoría.
  if (!VALID_MODERATION_ACTIONS.has(args.action)) {
    throw new Error(`MODERATION_ACTION_INVALID:${args.action}`);
  }
  return db.moderationLog.create({
    data: {
      moderatorId: args.moderatorId,
      action: args.action as ModerationAction,
      targetType: args.targetType,
      targetId: args.targetId,
      targetUserId: args.targetUserId ?? null,
      targetPostId: args.targetPostId ?? null,
      reason: args.reason ?? null,
      metadata: (args.metadata ?? null) as Prisma.InputJsonValue,
    },
  });
}

/**
 * Emit user:sanctioned event to force logout in Flutter client.
 * Payload includes type of sanction for client-side handling.
 */
export function emitUserSanctioned(
  targetUserId: string,
  payload: {
    action: string;
    reason: string;
    expiresAt?: Date | null;
    moderatorId: string;
  }
) {
  emitToUser(targetUserId, 'user:sanctioned', {
    type: payload.action,
    reason: payload.reason,
    expiresAt: payload.expiresAt?.toISOString() ?? null,
    moderatorId: payload.moderatorId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit post-related events for feed updates
 */
export function emitPostModeration(
  event: 'post:pinned' | 'post:unpinned' | 'post:hidden' | 'post:unhidden',
  postId: string,
  payload: { action: string; reason?: string; moderatorId: string }
) {
  // Es un evento global de feed: emitir a un ROOM del servidor (broadcast a
  // todos los sockets suscritos), no a un "usuario" individual como hacía
  // `emitToUser('moderation:feed', ...)`.
  emitToRoom('moderation:feed', event, {
    postId,
    action: payload.action,
    reason: payload.reason,
    moderatorId: payload.moderatorId,
    timestamp: new Date().toISOString(),
  });
}
