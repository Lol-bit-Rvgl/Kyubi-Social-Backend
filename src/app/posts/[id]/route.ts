import { z } from 'zod';
import { canAccessPost, postFullInclude } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { reactionKey, serializePost } from '@/lib/serialize';

const editable = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().trim().min(1).max(10000).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE', 'CIRCLE', 'PRIVATE_LINK']).optional(),
  coverImageUrl: z.string().nullable().optional(),
  bgImageUrl: z.string().nullable().optional(),
  bgOverlay: z.number().min(0).max(1).optional(),
  bgBlur: z.boolean().optional(),
  audioUrl: z.string().nullable().optional(),
  mediaUrls: z.array(z.string()).optional(),
  tags: z.array(z.string().max(40)).optional(),
  genres: z.array(z.string().max(40)).optional(),
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
});

/**
 * Deduplicación de vistas por sesión de usuario (TTL en memoria).
 * Clave `userId:postId`; expira a los 30 min o al reiniciar el servidor.
 */
const VIEW_TTL_MS = 30 * 60 * 1000;
const recentViews = new Map<string, number>();

function shouldCountView(userId: string, postId: string): boolean {
  const key = `${userId}:${postId}`;
  const now = Date.now();
  const last = recentViews.get(key);
  if (last !== undefined && now - last < VIEW_TTL_MS) return false;
  recentViews.set(key, now);
  return true;
}

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const post = await prisma.post.findUnique({
    where: { id },
    include: postFullInclude,
  });
  if (!post) return fail('Publicación no encontrada', 404);

  // No incrementa si el visitor es el autor o si ya registró vista reciente.
  const isAuthor = post.authorId === session.userId;
  const counts = !isAuthor && shouldCountView(session.userId, id);
  if (counts) {
    await prisma.post.update({ where: { id }, data: { views: { increment: 1 } } });
  }

  const myReaction = await prisma.reaction.findUnique({
    where: { postId_userId: { postId: id, userId: session.userId } },
    select: { type: true },
  });

  const serialized = serializePost(
    { ...post, views: (post.views ?? 0) + (counts ? 1 : 0) },
    { myReactionKey: myReaction ? reactionKey(myReaction.type) : null }
  );
  return ok(serialized);
});

export const PATCH = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = editable.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Publicación inválida');

  const { id } = await params;
  const post = await canAccessPost(id, session.userId);
  if (post === null) return fail('Publicación no encontrada', 404);
  if (post === false || post.authorId !== session.userId) return fail('No autorizado', 403);

  const { body: rawBody, ...rest } = body.data;
  const data = { ...rest, ...(rawBody !== undefined ? { content: rawBody } : {}) };
  const updated = await prisma.post.update({
    where: { id },
    data,
    include: postFullInclude,
  });
  return ok(serializePost(updated, { myReactionKey: null }));
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const post = await canAccessPost(id, session.userId);
  if (post === null) return fail('Publicación no encontrada', 404);
  if (post === false || post.authorId !== session.userId) return fail('No autorizado', 403);
  await prisma.post.delete({ where: { id } });
  return ok({ success: true });
});
