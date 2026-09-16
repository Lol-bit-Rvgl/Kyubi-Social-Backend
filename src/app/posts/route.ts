import { z } from 'zod';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { serializePost } from '@/lib/serialize';
import { optionalSafeHttpUrl, safeHttpUrl } from '@/lib/validation';

const createSchema = z.object({
  type: z.string().max(30).optional(),
  title: z.string().trim().max(300).optional(),
  body: z.string().trim().max(2000).optional(),
  content: z.string().trim().max(2000).optional(),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE', 'CIRCLE', 'PRIVATE_LINK']).default('PUBLIC'),
  // URLs externas sanitizadas: solo http(s), se rechaza javascript:/data:/etc.
  coverImageUrl: optionalSafeHttpUrl,
  bgImageUrl: optionalSafeHttpUrl,
  bgOverlay: z.number().min(0).max(1).optional(),
  bgBlur: z.boolean().optional(),
  audioUrl: optionalSafeHttpUrl,
  mediaUrls: z.array(safeHttpUrl).max(10).optional(),
  tags: z.array(z.string().trim().max(30)).max(10).optional(),
  genres: z.array(z.string().trim().max(40)).max(10).optional(),
  chapterMode: z.boolean().optional(),
  chapterNumber: z.number().int().optional(),
  fontFamily: z.string().nullable().optional(),
  themeBgColor: z.string().nullable().optional(),
  themeAccent: z.string().nullable().optional(),
  warnViolence: z.boolean().optional(),
  warnAdult: z.boolean().optional(),
  warnDark: z.boolean().optional(),
  warnSpoiler: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowReactions: z.boolean().optional(),
  circleId: z.string().trim().nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Publicación inválida', 400);

  const rawBody = (body.data.body || body.data.content || '').trim();
  if (!rawBody) return fail('El contenido no puede estar vacío', 400);

  const { body: _b, content: _c, circleId: rawCircleId, ...rest } = body.data;
  const circleId = rawCircleId?.trim() || null;
  const post = await prisma.post.create({
    data: {
      ...rest,
      content: rawBody,
      authorId: session.userId,
      publishedAt: new Date(),
      ...(circleId ? { circleId } : {}),
    },
    include: postFullInclude,
  });

  return ok(serializePost(post, { myReactionKey: null }), 201);
});
