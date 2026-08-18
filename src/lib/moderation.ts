import { Prisma, ModerationAction, ModerationTargetType } from '@prisma/client';
import { prisma } from './prisma';
import { toIso } from './serialize';

/**
 * Moderation data layer.
 *
 * This module intentionally does NOT import from `./auth` so it can be used
 * from the authentication layer without creating a circular dependency.
 *
 * "Active" ban/mute = revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now).
 * expiresAt null  -> permanent
 * revokedAt null  -> currently in effect
 */

const now = () => new Date();

function activeWhere(userId: string) {
  return {
    userId,
    revokedAt: null as Date | null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
  };
}

export async function getActiveBan(userId: string) {
  return prisma.ban.findFirst({
    where: activeWhere(userId),
    orderBy: { createdAt: 'desc' },
  });
}

export async function getActiveMute(userId: string) {
  return prisma.mute.findFirst({
    where: activeWhere(userId),
    orderBy: { createdAt: 'desc' },
  });
}

export const moderationActorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  role: true,
} as const;

export const muteInclude = {
  user: { select: moderationActorSelect },
  moderator: { select: moderationActorSelect },
} satisfies Prisma.MuteInclude;

export const banInclude = {
  user: { select: moderationActorSelect },
  moderator: { select: moderationActorSelect },
} satisfies Prisma.BanInclude;

export const moderationLogInclude = {
  moderator: { select: moderationActorSelect },
} satisfies Prisma.ModerationLogInclude;

export const reportDetailInclude = {
  reporter: { select: moderationActorSelect },
  handledBy: { select: moderationActorSelect },
} satisfies Prisma.ReportInclude;

export type MuteWithRelations = Prisma.MuteGetPayload<{ include: typeof muteInclude }>;
export type BanWithRelations = Prisma.BanGetPayload<{ include: typeof banInclude }>;
export type ModerationLogWithRelations = Prisma.ModerationLogGetPayload<{ include: typeof moderationLogInclude }>;
export type ReportWithRelations = Prisma.ReportGetPayload<{ include: typeof reportDetailInclude }>;

function serializeActor(actor: { id: string; username: string; displayName: string | null; avatarUrl: string | null; role: string }) {
  return {
    id: actor.id,
    username: actor.username,
    displayName: actor.displayName ?? actor.username,
    avatarUrl: actor.avatarUrl,
    role: actor.role,
  };
}

export function serializeMute(mute: MuteWithRelations) {
  const active = mute.revokedAt == null && (mute.expiresAt == null || mute.expiresAt > now());
  return {
    id: mute.id,
    userId: mute.userId,
    user: serializeActor(mute.user),
    moderatorId: mute.moderatorId,
    moderator: serializeActor(mute.moderator),
    reason: mute.reason,
    expiresAt: toIso(mute.expiresAt),
    revokedAt: toIso(mute.revokedAt),
    revokedById: mute.revokedById ?? null,
    permanent: mute.expiresAt == null,
    active,
    createdAt: toIso(mute.createdAt)!,
  };
}

export function serializeBan(ban: BanWithRelations) {
  const active = ban.revokedAt == null && (ban.expiresAt == null || ban.expiresAt > now());
  return {
    id: ban.id,
    userId: ban.userId,
    user: serializeActor(ban.user),
    moderatorId: ban.moderatorId,
    moderator: serializeActor(ban.moderator),
    reason: ban.reason,
    expiresAt: toIso(ban.expiresAt),
    revokedAt: toIso(ban.revokedAt),
    revokedById: ban.revokedById ?? null,
    permanent: ban.expiresAt == null,
    active,
    createdAt: toIso(ban.createdAt)!,
  };
}

export function serializeModerationLog(log: ModerationLogWithRelations) {
  return {
    id: log.id,
    moderatorId: log.moderatorId,
    moderator: serializeActor(log.moderator),
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    reason: log.reason,
    metadata: log.metadata ?? null,
    createdAt: toIso(log.createdAt)!,
  };
}

export function serializeReportDetail(report: ReportWithRelations) {
  return {
    id: report.id,
    reporterId: report.reporterId,
    reporter: report.reporter ? serializeActor(report.reporter) : null,
    reason: report.reason,
    details: report.details,
    targetType: report.targetType,
    targetId: report.targetId,
    status: report.status,
    handledById: report.handledById ?? null,
    handledBy: report.handledBy ? serializeActor(report.handledBy) : null,
    resolutionNote: report.resolutionNote,
    resolvedAt: toIso(report.resolvedAt),
    createdAt: toIso(report.createdAt)!,
  };
}

/**
 * Append-only audit log writer. Accepts a transaction client so it can run
 * atomically with the action it is recording.
 */
export async function logAction(
  db: Prisma.TransactionClient,
  args: {
    moderatorId: string;
    action: ModerationAction;
    targetType: ModerationTargetType;
    targetId: string;
    reason?: string | null;
    metadata?: Record<string, string | number | boolean | null> | null;
  }
) {
  return db.moderationLog.create({
    data: {
      moderatorId: args.moderatorId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason ?? null,
      metadata: (args.metadata ?? null) as Prisma.InputJsonValue,
    },
  });
}

/** Create (or replace) an active mute for a user. Any prior active mute is revoked first. */
export async function createMute(
  db: Prisma.TransactionClient,
  args: { userId: string; moderatorId: string; reason?: string | null; expiresAt?: Date | null }
) {
  await db.mute.updateMany({
    where: { userId: args.userId, revokedAt: null },
    data: { revokedAt: now(), revokedById: args.moderatorId },
  });
  const mute = await db.mute.create({
    data: {
      userId: args.userId,
      moderatorId: args.moderatorId,
      reason: args.reason ?? null,
      expiresAt: args.expiresAt ?? null,
    },
    include: muteInclude,
  });
  await logAction(db, {
    moderatorId: args.moderatorId,
    action: 'MUTE_USER',
    targetType: 'USER',
    targetId: args.userId,
    reason: args.reason ?? null,
    metadata: { muteId: mute.id, expiresAt: args.expiresAt ? args.expiresAt.toISOString() : null },
  });
  return mute;
}

/** Revoke the active mute for a user (unmute). Returns the revoked mute or null if none active. */
export async function revokeMute(
  db: Prisma.TransactionClient,
  args: { userId: string; moderatorId: string; reason?: string | null }
) {
  const active = await db.mute.findFirst({
    where: activeWhere(args.userId),
    orderBy: { createdAt: 'desc' },
  });
  if (!active) return null;
  await db.mute.update({
    where: { id: active.id },
    data: { revokedAt: now(), revokedById: args.moderatorId },
  });
  await logAction(db, {
    moderatorId: args.moderatorId,
    action: 'UNMUTE_USER',
    targetType: 'USER',
    targetId: args.userId,
    reason: args.reason ?? null,
    metadata: { muteId: active.id },
  });
  return active;
}

/** Create (or replace) an active ban for a user. Any prior active ban is revoked first. */
export async function createBan(
  db: Prisma.TransactionClient,
  args: { userId: string; moderatorId: string; reason?: string | null; expiresAt?: Date | null }
) {
  await db.ban.updateMany({
    where: { userId: args.userId, revokedAt: null },
    data: { revokedAt: now(), revokedById: args.moderatorId },
  });
  const ban = await db.ban.create({
    data: {
      userId: args.userId,
      moderatorId: args.moderatorId,
      reason: args.reason ?? null,
      expiresAt: args.expiresAt ?? null,
    },
    include: banInclude,
  });
  await logAction(db, {
    moderatorId: args.moderatorId,
    action: 'BAN_USER',
    targetType: 'USER',
    targetId: args.userId,
    reason: args.reason ?? null,
    metadata: { banId: ban.id, expiresAt: args.expiresAt ? args.expiresAt.toISOString() : null },
  });
  return ban;
}

/** Revoke the active ban for a user (unban). Returns the revoked ban or null if none active. */
export async function revokeBan(
  db: Prisma.TransactionClient,
  args: { userId: string; moderatorId: string; reason?: string | null }
) {
  const active = await db.ban.findFirst({
    where: activeWhere(args.userId),
    orderBy: { createdAt: 'desc' },
  });
  if (!active) return null;
  await db.ban.update({
    where: { id: active.id },
    data: { revokedAt: now(), revokedById: args.moderatorId },
  });
  await logAction(db, {
    moderatorId: args.moderatorId,
    action: 'UNBAN_USER',
    targetType: 'USER',
    targetId: args.userId,
    reason: args.reason ?? null,
    metadata: { banId: active.id },
  });
  return active;
}
