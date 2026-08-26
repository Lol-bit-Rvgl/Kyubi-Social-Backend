import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postFullInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';
import { reactionKey, serializePost } from '@/lib/serialize';

async function membershipFor(circleId: string, userId: string) {
  return prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    select: { role: true },
  });
}

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { circleId } = await params;

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, isPrivate: true },
  });
  if (!circle) return fail('Círculo no encontrado', 404);

  const membership = await membershipFor(circleId, session.userId);
  if (circle.isPrivate && !membership) return fail('Este círculo es privado', 403);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
  const cursor = url.searchParams.get('cursor');

  const posts = await prisma.post.findMany({
    where: { circleId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    skip: cursor ? 1 : 0,
    ...(cursor ? { cursor: { id: cursor } } : {}),
    include: postFullInclude,
  });

  const hasMore = posts.length > limit;
  const pagePosts = posts.slice(0, limit);
  const nextCursor = hasMore && pagePosts.length > 0 ? pagePosts[pagePosts.length - 1].id : null;

  const myReactions = await prisma.reaction.findMany({
    where: { userId: session.userId, postId: { in: pagePosts.map((p) => p.id) } },
    select: { postId: true, type: true },
  });
  const myReactionMap = new Map(myReactions.map((r) => [r.postId, r.type]));

  return ok({
    data: pagePosts.map((post) =>
      serializePost(post, {
        myReactionKey: myReactionMap.has(post.id) ? reactionKey(myReactionMap.get(post.id)!) : null,
      })
    ),
    nextCursor,
    total: await prisma.post.count({ where: { circleId } }),
  });
});

const createSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  title: z.string().trim().max(300).optional(),
  mediaUrls: z.array(z.string()).optional(),
  tags: z.array(z.string().max(40)).optional(),
  bgImageUrl: z.string().nullable().optional(),
  bgOverlay: z.number().min(0).max(1).optional(),
  bgBlur: z.boolean().optional(),
  warnViolence: z.boolean().optional(),
  warnAdult: z.boolean().optional(),
  warnDark: z.boolean().optional(),
  warnSpoiler: z.boolean().optional(),
  themeBgColor: z.string().nullable().optional(),
  themeAccent: z.string().nullable().optional(),
  fontFamily: z.string().nullable().optional(),

  // ── Firma de rol (OC) ──
  characterId: z.string().max(64).nullable().optional(),
  characterName: z.string().max(80).nullable().optional(),
  characterAvatarUrl: z.string().max(2048).nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ circleId: string }> }) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { circleId } = await params;

  const membership = await membershipFor(circleId, session.userId);
  if (!membership) return fail('Debes ser miembro del círculo para publicar', 403);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Publicación inválida', 400);

  const { body: rawBody, ...rest } = body.data;
  const post = await prisma.post.create({
    data: {
      ...rest,
      content: rawBody,
      circleId,
      visibility: 'CIRCLE',
      authorId: session.userId,
      publishedAt: new Date(),
    },
    include: postFullInclude,
  });

  return ok(serializePost(post, { myReactionKey: null }), 201);
});
