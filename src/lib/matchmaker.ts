import { prisma as defaultPrisma } from '@/lib/prisma';

export interface MatchQueueEntry {
  socketId: string;
  userId: string;
  joinedAt: Date;
  category?: string;
}

export interface MatchPartnerProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  level?: number;
  bio?: string | null;
  interests?: string[];
}

/**
 * Cola en memoria de usuarios esperando emparejamiento aleatorio.
 * Mapea userId -> MatchQueueEntry.
 */
const matchQueue = new Map<string, MatchQueueEntry>();

/**
 * Inserta un usuario en la cola de matchmaking evitando duplicados.
 */
export function addToQueue(userId: string, socketId: string, category = 'general'): boolean {
  if (!userId || !socketId) return false;
  matchQueue.set(userId, {
    socketId,
    userId,
    joinedAt: new Date(),
    category,
  });
  return true;
}

/**
 * Remueve a un usuario de la cola si cancela o se desconecta.
 */
export function removeFromQueue(userId: string): boolean {
  if (!userId) return false;
  return matchQueue.delete(userId);
}

/**
 * Devuelve la cantidad de usuarios esperando en la cola.
 */
export function getQueueSize(): number {
  return matchQueue.size;
}

/**
 * Limpia la cola por completo (útil en pruebas).
 */
export function clearQueue(): void {
  matchQueue.clear();
}

/**
 * Obtiene la referencia directa del mapa de la cola.
 */
export function getQueue(): Map<string, MatchQueueEntry> {
  return matchQueue;
}

/**
 * Intenta encontrar una pareja entre los usuarios en cola.
 * Comprueba que no existan bloqueos mutuos en DB.
 * Crea una conversación directa provisional con metadata { isMatch: true, status: 'pending', acceptedBy: [] }.
 * Emite `match:found` a ambos sockets y los une al room `conversation:${id}`.
 */
export async function tryFindMatch(
  io: any,
  prismaClient: any = defaultPrisma
): Promise<{ conversationId: string; userAId: string; userBId: string } | null> {
  if (matchQueue.size < 2) return null;

  const entries = Array.from(matchQueue.values());
  let candidatePair: [MatchQueueEntry, MatchQueueEntry] | null = null;

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.userId === b.userId) continue;

      // Comprobar bloqueo mutuo en base de datos
      const block = await prismaClient.block.findFirst({
        where: {
          OR: [
            { blockerId: a.userId, blockedId: b.userId },
            { blockerId: b.userId, blockedId: a.userId },
          ],
        },
      });

      if (!block) {
        candidatePair = [a, b];
        break;
      }
    }
    if (candidatePair) break;
  }

  if (!candidatePair) return null;

  const [a, b] = candidatePair;
  // Desencolar ambos usuarios
  matchQueue.delete(a.userId);
  matchQueue.delete(b.userId);

  // Obtener datos públicos de ambos usuarios
  const [userA, userB] = await Promise.all([
    prismaClient.user.findUnique({
      where: { id: a.userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        bio: true,
        interests: true,
      },
    }),
    prismaClient.user.findUnique({
      where: { id: b.userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        level: true,
        bio: true,
        interests: true,
      },
    }),
  ]);

  // Crear conversación directa provisional
  const conversation = await prismaClient.conversation.create({
    data: {
      type: 'DIRECT',
      metadata: {
        isMatch: true,
        status: 'pending',
        acceptedBy: [],
      },
      members: {
        create: [
          { userId: a.userId, role: 'MEMBER' },
          { userId: b.userId, role: 'MEMBER' },
        ],
      },
    },
  });

  const convRoom = `conversation:${conversation.id}`;

  // Unir sockets al room
  if (io) {
    try {
      if (typeof io.in === 'function') {
        io.in(a.socketId)?.socketsJoin?.(convRoom);
        io.in(b.socketId)?.socketsJoin?.(convRoom);
      }
      const sockA = io.sockets?.sockets?.get?.(a.socketId);
      if (sockA?.join) sockA.join(convRoom);
      const sockB = io.sockets?.sockets?.get?.(b.socketId);
      if (sockB?.join) sockB.join(convRoom);
    } catch (_) {}
  }

  const partnerA: MatchPartnerProfile = {
    id: userB?.id ?? b.userId,
    username: userB?.username ?? '',
    displayName: userB?.displayName || userB?.username || 'Usuario',
    avatarUrl: userB?.avatarUrl ?? null,
    level: userB?.level ?? 1,
    bio: userB?.bio ?? null,
    interests: Array.isArray(userB?.interests) ? userB.interests : [],
  };

  const partnerB: MatchPartnerProfile = {
    id: userA?.id ?? a.userId,
    username: userA?.username ?? '',
    displayName: userA?.displayName || userA?.username || 'Usuario',
    avatarUrl: userA?.avatarUrl ?? null,
    level: userA?.level ?? 1,
    bio: userA?.bio ?? null,
    interests: Array.isArray(userA?.interests) ? userA.interests : [],
  };

  // Emitir match:found a cada participante
  if (io) {
    const payloadA = {
      conversationId: conversation.id,
      partner: partnerA,
      peer: partnerA,
      category: a.category || 'general',
    };
    const payloadB = {
      conversationId: conversation.id,
      partner: partnerB,
      peer: partnerB,
      category: b.category || 'general',
    };

    io.to?.(a.socketId)?.emit?.('match:found', payloadA);
    io.to?.(`user:${a.userId}`)?.emit?.('match:found', payloadA);

    io.to?.(b.socketId)?.emit?.('match:found', payloadB);
    io.to?.(`user:${b.userId}`)?.emit?.('match:found', payloadB);
  }

  return {
    conversationId: conversation.id,
    userAId: a.userId,
    userBId: b.userId,
  };
}

/**
 * Maneja la aceptación del match por parte de un usuario.
 * Si ambos aceptan: status = 'accepted' y emite `match:mutual_accept`.
 * Si solo uno acepta: status = 'pending' y emite `match:peer_accepted` al compañero.
 */
export async function handleMatchAccept(
  io: any,
  prismaClient: any = defaultPrisma,
  conversationId: string,
  userId: string
): Promise<{ conversationId: string; status: string; acceptedBy: string[] } | null> {
  if (!conversationId || !userId) return null;

  const conv = await prismaClient.conversation.findUnique({
    where: { id: conversationId },
    include: { members: true },
  });

  if (!conv) return null;
  const meta = (conv.metadata as Record<string, any>) || {};
  if (!meta.isMatch || meta.status === 'closed') return null;

  const acceptedBy = Array.isArray(meta.acceptedBy) ? [...meta.acceptedBy] : [];
  if (!acceptedBy.includes(userId)) {
    acceptedBy.push(userId);
  }

  const isMutual = acceptedBy.length >= 2;
  const newStatus = isMutual ? 'accepted' : 'pending';

  await prismaClient.conversation.update({
    where: { id: conversationId },
    data: {
      metadata: {
        ...meta,
        isMatch: true,
        status: newStatus,
        acceptedBy,
      },
    },
  });

  if (io) {
    const convRoom = `conversation:${conversationId}`;
    if (isMutual) {
      io.to?.(convRoom)?.emit?.('match:mutual_accept', { conversationId });
      if (conv.members) {
        for (const m of conv.members) {
          io.to?.(`user:${m.userId}`)?.emit?.('match:mutual_accept', { conversationId });
        }
      }
    } else {
      const partner = conv.members?.find((m: any) => m.userId !== userId);
      if (partner) {
        io.to?.(`user:${partner.userId}`)?.emit?.('match:peer_accepted', {
          conversationId,
          acceptedByUserId: userId,
        });
      }
      io.to?.(convRoom)?.emit?.('match:peer_accepted', {
        conversationId,
        acceptedByUserId: userId,
      });
    }
  }

  return { conversationId, status: newStatus, acceptedBy };
}

/**
 * Maneja el rechazo o cancelación de un match por parte de un usuario.
 * Marca la conversación como 'closed' y emite `match:closed`.
 * Si isNext es true y se proporciona socketId, vuelve a meter al usuario en la cola.
 */
export async function handleMatchReject(
  io: any,
  prismaClient: any = defaultPrisma,
  conversationId: string,
  userId: string,
  isNext = false,
  socketId?: string,
  category = 'general'
): Promise<{ conversationId: string; status: string } | null> {
  if (!conversationId) return null;

  const conv = await prismaClient.conversation.findUnique({
    where: { id: conversationId },
    include: { members: true },
  });

  if (conv) {
    const meta = (conv.metadata as Record<string, any>) || {};
    await prismaClient.conversation.update({
      where: { id: conversationId },
      data: {
        metadata: {
          ...meta,
          isMatch: true,
          status: 'closed',
        },
      },
    });
  }

  if (io) {
    const convRoom = `conversation:${conversationId}`;
    io.to?.(convRoom)?.emit?.('match:closed', {
      conversationId,
      reason: 'partner_left',
      closedByUserId: userId,
    });
    if (conv?.members) {
      for (const m of conv.members) {
        io.to?.(`user:${m.userId}`)?.emit?.('match:closed', {
          conversationId,
          reason: 'partner_left',
          closedByUserId: userId,
        });
      }
    }
  }

  if (isNext && socketId && userId) {
    addToQueue(userId, socketId, category);
    await tryFindMatch(io, prismaClient);
  }

  return { conversationId, status: 'closed' };
}
