import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { serializeStory, storyInclude, type SerializedStory } from '@/lib/stories';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const now = new Date();

  const stories = await prisma.story.findMany({
    where: { expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' },
    include: storyInclude,
  });

  // Colección de ids de historias que el usuario actual ya ha visto.
  const viewerIds = new Set([session.userId]);
  const seenStoryIds = new Set<string>();
  for (const story of stories) {
    for (const view of story.views) {
      if (view.viewerId === session.userId) seenStoryIds.add(story.id);
    }
  }

  // Agrupa por autor, preservando el orden por `createdAt` (más antiguo primero).
  const groupsById = new Map<string, {
    author: { id: string; username: string; displayName: string; avatarUrl: string | null };
    stories: SerializedStory[];
    hasUnseen: boolean;
  }>();

  for (const story of stories) {
    const bucket = groupsById.get(story.userId);
    const serialized = serializeStory(story, viewerIds);
    if (!bucket) {
      groupsById.set(story.userId, {
        author: {
          id: story.user.id,
          username: story.user.username,
          displayName: story.user.displayName ?? story.user.username,
          avatarUrl: story.user.avatarUrl,
        },
        stories: [serialized],
        hasUnseen: !seenStoryIds.has(story.id),
      });
    } else {
      bucket.stories.push(serialized);
      bucket.hasUnseen = bucket.hasUnseen || !seenStoryIds.has(story.id);
    }
  }

  // Ordena: primero autores con historias no vistas; se mantiene el orden
  // de aparición original como desempate (estable).
  const groups = [...groupsById.values()].sort((a, b) => {
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return 0;
  });

  return ok({ groups });
});