import { Prisma } from '@prisma/client';
import { toIso } from './serialize';

/**
 * Data layer de historias efímeras (stories 24h).
 *
 * No importa desde `./auth` para evitar dependencias circulares; las rutas
 * resuelven la sesión y pasan el `userId` resultante.
 */

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export function storyExpiresAt(createdAt = new Date()): Date {
  return new Date(createdAt.getTime() + STORY_TTL_MS);
}

export const storyAuthorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
} as const;

export const storyInclude = {
  user: { select: storyAuthorSelect },
  views: { select: { viewerId: true } },
} as const;

export type StoryWithRelations = Prisma.StoryGetPayload<{ include: typeof storyInclude }>;

export type SerializedStory = ReturnType<typeof serializeStory>;

export function serializeStory(story: StoryWithRelations, viewerIds: Set<string>) {
  return {
    id: story.id,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    caption: story.caption ?? null,
    createdAt: toIso(story.createdAt),
    expiresAt: toIso(story.expiresAt),
    seen: [...story.views].some((v) => viewerIds.has(v.viewerId)),
    author: {
      id: story.user.id,
      username: story.user.username,
      displayName: story.user.displayName ?? story.user.username,
      avatarUrl: story.user.avatarUrl,
    },
    // `hasUnseen` global se resuelve al agrupar; se deja false por story.
    hasUnseen: false,
  };
}