import { prisma } from './prisma';

export async function canAccessPost(postId: string, userId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return null;
  // Posts ocultos por moderación: solo accesibles para su autor o miembros del staff.
  if (post.isHidden && post.authorId !== userId) {
    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isStaff = viewer && (viewer.role === 'MODERATOR' || viewer.role === 'ADMIN' || viewer.role === 'OWNER');
    if (!isStaff) return null;
    return post;
  }
  if (post.authorId === userId || post.visibility === 'PUBLIC') return post;
  if (post.visibility === 'PRIVATE') return false;
  if (post.visibility === 'CIRCLE') {
    // Posts de círculo: solo accesibles para miembros del círculo (o para
    // cualquiera si el círculo es público). Evita el 403 falso que el chequeo
    // de follow producía al caer por el caso genérico.
    if (!post.circleId) return false;
    const circle = await prisma.circle.findUnique({
      where: { id: post.circleId },
      select: { isPrivate: true },
    });
    if (!circle) return false;
    if (!circle.isPrivate) return post;
    const member = await prisma.circleMember.findUnique({
      where: { circleId_userId: { circleId: post.circleId, userId } },
    });
    return member ? post : false;
  }
  const follows = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: userId, followingId: post.authorId } },
  });
  return follows ? post : false;
}

export const authorPublicSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

export const postInclude = {
  author: { select: authorPublicSelect },
  _count: { select: { reactions: true } },
} as const;

export const postFullInclude = {
  author: true,
  reactions: true,
  comments: { select: { id: true } },
  _count: { select: { comments: true, reactions: true } },
} as const;

export async function getPostWithRelations(postId: string, userId: string) {
  return prisma.post.findUnique({
    where: { id: postId },
    include: {
      ...postFullInclude,
      reactions: { select: { type: true } },
    },
  });
}

export async function myReactionOnPost(postId: string, userId: string) {
  const r = await prisma.reaction.findUnique({
    where: { postId_userId: { postId, userId } },
    select: { type: true },
  });
  return r?.type ?? null;
}
