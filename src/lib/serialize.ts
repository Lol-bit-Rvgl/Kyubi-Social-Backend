import { Prisma } from '@prisma/client';

export type ReactionKey = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry';

const REACTION_KEY: Record<string, ReactionKey> = {
  LIKE: 'like',
  LOVE: 'love',
  LAUGH: 'laugh',
  WOW: 'wow',
  SAD: 'sad',
  ANGRY: 'angry',
};

const EMOJI_TO_KEY: Record<string, ReactionKey> = {
  '👍': 'like',
  '❤': 'love',
  '❤️': 'love',
  '😂': 'laugh',
  '😮': 'wow',
  '😢': 'sad',
  '😡': 'angry',
  like: 'like',
  love: 'love',
  laugh: 'laugh',
  wow: 'wow',
  sad: 'sad',
  angry: 'angry',
};

export function normalizeReactionKey(input?: string | null): ReactionKey {
  const key = EMOJI_TO_KEY[(input ?? 'like').trim().toLowerCase()];
  return key ?? 'like';
}

export function reactionKey(type: string): ReactionKey {
  return REACTION_KEY[type] ?? 'like';
}

export function emptyReactionCounts(): Record<ReactionKey, number> {
  return { like: 0, love: 0, laugh: 0, wow: 0, sad: 0, angry: 0 };
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return 'hace un momento';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `hace ${weeks} sem`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months > 1 ? 'es' : ''}`;
  const years = Math.floor(days / 365);
  return `hace ${years} año${years > 1 ? 's' : ''}`;
}

export function toIso(date?: Date | string | null): string | undefined {
  if (!date) return undefined;
  const d = typeof date === 'string' ? new Date(date) : date;
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

type AuthorPayload = {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  usernameColor?: string | null;
  avatarFrame?: string | null;
  level?: number | null;
  isOnline?: boolean | null;
  gender?: string | null;
  showGender?: boolean | null;
};

export function serializeAuthor(author: AuthorPayload) {
  return {
    id: author.id,
    username: author.username,
    displayName: author.displayName ?? author.username,
    avatarUrl: author.avatarUrl,
    usernameColor: author.usernameColor,
    avatarFrame: author.avatarFrame,
    level: author.level ?? 1,
    showOnline: true,
    isOnline: author.isOnline ?? false,
    gender: author.gender,
    showGender: author.showGender ?? true,
  };
}

type PostWithRelations = Prisma.PostGetPayload<{
  include: {
    author: true;
    reactions: true;
    comments: { select: { id: true } };
    _count: { select: { comments: true; reactions: true } };
  };
}>;

export function serializePost(
  post: PostWithRelations,
  opts: { myReactionKey?: ReactionKey | null; views?: number } = {}
) {
  const reactionCounts = emptyReactionCounts();
  for (const r of post.reactions) {
    reactionCounts[reactionKey(r.type)] += 1;
  }
  const myReaction = opts.myReactionKey ?? null;
  const publishedAt = post.publishedAt ?? post.createdAt;

  return {
    id: post.id,
    type: post.type || 'TEXT',
    title: post.title ?? '',
    body: post.content,
    coverImageUrl: post.coverImageUrl,
    coverImageHash: null,
    bgImageUrl: post.bgImageUrl,
    bgOverlay: post.bgOverlay ?? 0.55,
    bgBlur: post.bgBlur ?? false,
    tags: post.tags ?? [],
    genres: post.genres ?? [],
    mediaUrls: post.mediaUrls ?? [],
    audioUrl: post.audioUrl,
    author: serializeAuthor(post.author),
    coAuthors: [],
    characters: [],

    // ── Firma de rol (OC) en publicaciones de círculo ──
    characterId: post.characterId ?? null,
    characterName: post.characterName ?? null,
    characterAvatarUrl: post.characterAvatarUrl ?? null,

    circles: [],
    stats: {
      likes: reactionCounts.like,
      comments: post._count?.comments ?? post.comments?.length ?? 0,
      views: opts.views ?? post.views ?? 0,
      shares: post.shares ?? 0,
    },
    reactions: reactionCounts,
    isLiked: myReaction === 'like' || myReaction != null,
    hasJoinRPButton: false,
    chapterMode: post.chapterMode ?? false,
    chapterNumber: post.chapterNumber,
    warnings:
      post.warnViolence || post.warnAdult || post.warnDark || post.warnSpoiler
        ? {
            violence: post.warnViolence ?? false,
            adult: post.warnAdult ?? false,
            dark: post.warnDark ?? false,
            spoiler: post.warnSpoiler ?? false,
          }
        : null,
    publishedAt: toIso(publishedAt),
    timeAgo: timeAgo(publishedAt),
    themeBgColor: post.themeBgColor,
    themeAccent: post.themeAccent,
    fontFamily: post.fontFamily,
  };
}

type CommentWithRelations = Prisma.CommentGetPayload<{
  include: {
    author: true;
    replies: { include: { author: true; _count: { select: { reactions: true } } } };
    _count: { select: { reactions: true } };
  };
}>;

function serializeCommentCore(
  comment: {
    id: string;
    postId: string;
    body: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    parentId?: string | null;
    isEdited?: boolean | null;
    createdAt: Date | string;
    author: AuthorPayload;
    _count?: { reactions?: number };
  },
  opts: { myReaction?: ReactionKey | null; isAuthor?: boolean; likeCount?: number } = {}
) {
  return {
    id: comment.id,
    postId: comment.postId,
    body: comment.body,
    mediaUrl: comment.mediaUrl ?? null,
    mediaType: comment.mediaType ?? null,
    author: serializeAuthor(comment.author),
    likeCount: opts.likeCount ?? comment._count?.reactions ?? 0,
    isLiked: opts.myReaction != null,
    myReaction: opts.myReaction ?? null,
    isAuthor: opts.isAuthor ?? false,
    replies: [] as unknown[],
    parentId: comment.parentId ?? null,
    isEdited: comment.isEdited ?? false,
    timeAgo: timeAgo(comment.createdAt),
    createdAt: toIso(comment.createdAt)!,
  };
}

export function serializeComment(comment: CommentWithRelations, opts: { myReaction?: ReactionKey | null; postAuthorId?: string; myUserId?: string } = {}) {
  const base = serializeCommentCore(comment, {
    myReaction: opts.myReaction,
    isAuthor: comment.author.id === opts.postAuthorId,
  });
  return {
    ...base,
    replies: (comment.replies ?? []).map((r) =>
      serializeCommentCore(r, {
        myReaction: null,
        isAuthor: r.author.id === opts.postAuthorId,
        likeCount: r._count?.reactions ?? 0,
      })
    ),
  };
}

export type PublicUser = {
  id: string;
  email?: string | null;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
  usernameColor?: string | null;
  avatarFrame?: string | null;
  level?: number | null;
  isOnline?: boolean | null;
  gender?: string | null;
  showGender?: boolean | null;
  emailVerifiedAt?: Date | null;
  onboardingCompleted?: boolean | null;
  createdAt?: Date | string;
  _count?: { followers?: number; following?: number; posts?: number } | null;
};

export function serializeUser(user: PublicUser, opts: { isFollowing?: boolean; isMe?: boolean } = {}) {
  const followers = user._count?.followers ?? 0;
  const following = user._count?.following ?? 0;
  return {
    id: user.id,
    email: opts.isMe ? user.email ?? null : undefined,
    username: user.username,
    displayName: user.displayName ?? user.username,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    bio: user.bio,
    usernameColor: user.usernameColor,
    avatarFrame: user.avatarFrame,
    level: user.level ?? 1,
    isOnline: user.isOnline ?? false,
    gender: user.gender,
    showGender: user.showGender ?? true,
    emailVerifiedAt: opts.isMe ? toIso(user.emailVerifiedAt) ?? null : undefined,
    onboardingCompleted: opts.isMe ? (user.onboardingCompleted ?? false) : undefined,
    createdAt: toIso(user.createdAt),
    isFollowing: opts.isFollowing ?? false,
    followersCount: followers,
    followingCount: following,
    hasPaymentPassword: opts.isMe ? false : undefined,
  };
}
