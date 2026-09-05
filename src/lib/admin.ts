import { UserRole, Prisma } from '@prisma/client';
import { requireUser, type AuthUser } from './authz';
import { fail } from './http';
import { prisma } from './prisma';
import { emitToUser } from './socketio';

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

  const allowedRoles: UserRole[] = Array.isArray(minRole) ? minRole : [minRole, 'MODERATOR', 'ADMIN', 'OWNER'];
  
  // Check if user role is in the allowed list
  // For simpler check: if minRole is an array, user.role must be in it
  // If minRole is single, user must be at least that level
  const roleRank: Record<UserRole, number> = {
    USER: 0,
    MODERATOR: 1,
    ADMIN: 2,
    OWNER: 3,
  };

  const userRank = roleRank[auth.role];
  const minRank = Array.isArray(minRole) 
    ? Math.min(...minRole.map(r => roleRank[r]))
    : roleRank[minRole];

  if (userRank < minRank) {
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

const ROLE_RANK: Record<UserRole, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

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
  return db.moderationLog.create({
    data: {
      moderatorId: args.moderatorId,
      action: args.action as any,
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
  // For feed-wide updates, we could emit to a general room or specific channels
  // For now, emit to a global moderation channel
  emitToUser('moderation:feed', event, {
    postId,
    action: payload.action,
    reason: payload.reason,
    moderatorId: payload.moderatorId,
    timestamp: new Date().toISOString(),
  });
}
