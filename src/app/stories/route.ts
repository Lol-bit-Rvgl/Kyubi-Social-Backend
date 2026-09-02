import { z } from 'zod';
import { StoryMediaType } from '@prisma/client';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { storyExpiresAt, storyInclude, serializeStory } from '@/lib/stories';

const createSchema = z.object({
  mediaUrl: z.string().trim().url().max(2000),
  mediaType: z.enum(['IMAGE', 'VIDEO']).default('IMAGE'),
  caption: z.string().trim().max(500).optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Historia inválida', 400);

  const { mediaType, ...rest } = body.data;
  const story = await prisma.story.create({
    data: {
      ...rest,
      mediaType: mediaType as StoryMediaType,
      userId: session.userId,
      expiresAt: storyExpiresAt(),
    },
    include: storyInclude,
  });

  return ok({ story: serializeStory(story, new Set()) }, 201);
});