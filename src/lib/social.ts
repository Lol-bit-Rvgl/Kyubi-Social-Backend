import { Prisma } from '@prisma/client';
import { serializeAuthor } from './serialize';

export type CirclePayload = Prisma.CircleGetPayload<{
  include: {
    creator: true;
    _count: { select: { members: true; posts: true; rooms: true } };
  };
}>;

export type CircleDetailPayload = Prisma.CircleGetPayload<{
  include: {
    creator: true;
    members: { include: { user: true }; orderBy: { joinedAt: 'asc' }; take?: number };
    _count: { select: { members: true; posts: true; rooms: true } };
  };
}>;

export type CircleMemberPayload = Prisma.CircleMemberGetPayload<{
  include: { user: true };
}>;

export const circleInclude = {
  creator: true,
  _count: { select: { members: true, posts: true, rooms: true } },
} satisfies Prisma.CircleInclude;

export function serializeCircle(
  circle: CirclePayload,
  opts: { myUserId?: string; role?: CircleRoleLike | null } = {}
) {
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description,
    avatarUrl: circle.avatarUrl,
    bannerUrl: circle.bannerUrl,
    isPrivate: circle.isPrivate,
    creator: serializeAuthor(circle.creator),
    isCreator: circle.creatorId === opts.myUserId,
    isMember: opts.role != null,
    role: opts.role ?? null,
    memberCount: circle._count.members,
    postCount: circle._count.posts,
    roomCount: circle._count.rooms,
    createdAt: circle.createdAt.toISOString(),
  };
}

export function serializeCircleMember(member: CircleMemberPayload) {
  return {
    ...serializeAuthor(member.user),
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

export type RoomPayload = Prisma.RoomGetPayload<{
  include: {
    host: true;
    circle: { select: { id: true; name: true; avatarUrl: true } };
    _count: { select: { participants: true } };
  };
}>;

export type RoomDetailPayload = Prisma.RoomGetPayload<{
  include: {
    host: true;
    circle: { select: { id: true; name: true; avatarUrl: true } };
    participants: { include: { user: true }; orderBy: { joinedAt: 'asc' }; take?: number };
    _count: { select: { participants: true } };
  };
}>;

export type RoomParticipantPayload = Prisma.RoomParticipantGetPayload<{
  include: { user: true };
}>;

export const roomInclude = {
  host: true,
  circle: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { participants: true } },
} satisfies Prisma.RoomInclude;

export function serializeRoom(
  room: RoomPayload,
  opts: { myUserId?: string; isParticipant?: boolean; fullParticipants?: RoomParticipantPayload[] } = {}
) {
  const participants = opts.fullParticipants ?? [];
  const myParticipant = opts.myUserId
    ? participants.find((p) => (p as any).userId === opts.myUserId || p.user?.id === opts.myUserId)
    : null;
  const rawStageRoles = (room as any).stageRoles ?? [];
  const stageRoles = Array.isArray(rawStageRoles)
    ? rawStageRoles.map((r: any) => {
        const assignedUserId = r.takenByUserId ?? r.occupiedBy ?? null;
        const assignedUsername = r.takenByUsername ?? r.occupiedByName ?? null;
        const isOccupied = Boolean(assignedUserId && (r.isTaken || r.isOccupied));
        return {
          ...r,
          isTaken: isOccupied,
          isOccupied: isOccupied,
          takenByUserId: isOccupied ? assignedUserId : null,
          occupiedBy: isOccupied ? assignedUserId : null,
          takenByUsername: isOccupied ? assignedUsername : null,
          occupiedByName: isOccupied ? assignedUsername : null,
        };
      })
    : [];
  const myParticipantCharacter = (myParticipant as any)?.metadata?.activeCharacter ?? null;
  const myActiveCharacter =
    myParticipantCharacter &&
    stageRoles.some(
      (r: any) =>
        r.id === myParticipantCharacter.id &&
        r.isTaken &&
        (r.takenByUserId === opts.myUserId || r.occupiedBy === opts.myUserId)
    )
      ? myParticipantCharacter
      : stageRoles.find(
          (r: any) =>
            r.isTaken &&
            (r.takenByUserId === opts.myUserId || r.occupiedBy === opts.myUserId)
        ) ?? null;

  return {
    id: room.id,
    name: room.name,
    description: room.description,
    imageUrl: room.imageUrl,
    chatBackgroundUrl: room.chatBackgroundUrl,
    rules: Array.isArray((room as any).rules) ? (room as any).rules : [],
    cinemaVideoId: room.cinemaVideoId,
    cinemaState: room.cinemaState,
    cinemaCurrentTime: room.cinemaCurrentTime,
    cinemaUpdatedAt: room.cinemaUpdatedAt?.toISOString() ?? null,
    currentMode: (room as any).currentMode ?? 'standard',
    stageRoles,
    activeCharacter: myActiveCharacter,
    host: serializeAuthor(room.host),
    status: room.status,
    access: room.access,
    kind: room.kind,
    capacity: room.capacity,
    isHost: room.hostId === opts.myUserId,
    isParticipant: opts.isParticipant ?? false,
    participantCount: room._count.participants,
    participants: participants.map((p) => ({
      ...serializeAuthor(p.user),
      role: p.role,
      activeCharacter: (p as any).metadata?.activeCharacter ?? null,
      joinedAt: p.joinedAt.toISOString(),
    })),
    circle: room.circle,
    createdAt: room.createdAt.toISOString(),
    endedAt: room.endedAt?.toISOString() ?? null,
  };
}

type CircleRoleLike = 'OWNER' | 'ADMIN' | 'MEMBER';

/** Mapa círculoId -> rol para el usuario actual. */
export async function memberRoles(
  prisma: Prisma.TransactionClient | typeof import('@/lib/prisma').prisma,
  circleIds: string[],
  userId: string
): Promise<Map<string, CircleRoleLike>> {
  if (circleIds.length === 0) return new Map();
  const memberships = await prisma.circleMember.findMany({
    where: { userId, circleId: { in: circleIds } },
    select: { circleId: true, role: true },
  });
  return new Map(memberships.map((m) => [m.circleId, m.role as CircleRoleLike]));
}
