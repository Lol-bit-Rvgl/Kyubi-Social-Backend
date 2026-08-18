import { prisma } from './prisma';

export async function canAccessPost(postId: string, userId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return null;
  if (post.authorId === userId || post.visibility === 'PUBLIC') return post;
  if (post.visibility === 'PRIVATE') return false;
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
