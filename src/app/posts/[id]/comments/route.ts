import { z } from 'zod';
import { canAccessPost } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { notify, notifyMentions } from '@/lib/notifications';
import { reactionKey, serializeComment, type ReactionKey } from '@/lib/serialize';
import { optionalSafeHttpUrl } from '@/lib/validation';

const commentInclude = {
  author: true,
  replies: {
    include: {
      author: true,
      _count: { select: { reactions: true } },
    },
  },
  _count: { select: { reactions: true } },
} as const;

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));

  const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true } });
  if (!post) return fail('Publicación no encontrada', 404);

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where: { postId: id, parentId: null },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit + 1,
      include: commentInclude,
    }),
    prisma.comment.count({ where: { postId: id, parentId: null } }),
  ]);

  const hasMore = comments.length > limit;
  const pageComments = comments.slice(0, limit);

  const allIds = pageComments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]);
  const myReactions = await prisma.commentReaction.findMany({
    where: { userId: session.userId, commentId: { in: allIds } },
    select: { commentId: true, type: true },
  });
  const reactionMap = new Map(myReactions.map((r) => [r.commentId, reactionKey(r.type) as ReactionKey]));

  return ok({
    comments: pageComments.map((c) =>
      serializeComment(c, {
        myReaction: reactionMap.get(c.id) ?? null,
        postAuthorId: post.authorId,
      })
    ),
    total,
    hasMore,
    page,
  });
});

const createSchema = z.object({
  body: z.string().trim().max(2000).optional(),
  content: z.string().trim().max(2000).optional(),
  parentId: z.string().nullable().optional(),
  // Media sanitizada: URL solo http(s) y tipo acotado a un enum explícito.
  mediaUrl: optionalSafeHttpUrl,
  mediaType: z.enum(['IMAGE', 'AUDIO', 'GIF']).nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  // Bloquea usuarios baneados/silenciados: no solo dependemos del JWT (15 min).
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;
  const { id } = await params;
  const access = await canAccessPost(id, session.userId);
  if (access === null) return fail('Publicación no encontrada', 404);
  if (access === false) return fail('No tienes acceso a esta publicación', 403);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Comentario inválido');

  const commentText = (body.data.body || body.data.content || '').trim();
  if (!commentText && !body.data.mediaUrl) return fail('Comentario inválido', 400);

  const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true, allowComments: true } });
  if (!post) return fail('Publicación no encontrada', 404);
  if (post.allowComments === false) return fail('Los comentarios están deshabilitados', 403);

  // Integridad: el comentario padre (si hay respuesta) debe pertenecer a ESTE post.
  if (body.data.parentId) {
    const parent = await prisma.comment.findFirst({
      where: { id: body.data.parentId, postId: id },
      select: { id: true },
    });
    if (!parent) return fail('El comentario padre no pertenece a esta publicación', 400);
  }

  const comment = await prisma.comment.create({
    data: {
      postId: id,
      userId: session.userId,
      body: commentText || '[Multimedia]',
      parentId: body.data.parentId ?? null,
      mediaUrl: body.data.mediaUrl ?? null,
      mediaType: body.data.mediaType ?? null,
    },
    include: commentInclude,
  });

  if (post.authorId !== session.userId) {
    await notify({
      userId: post.authorId,
      actorId: session.userId,
      type: 'COMMENT',
      target: { type: 'POST', id },
      text: comment.body.slice(0, 200),
    });
  }

  if (body.data.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.data.parentId },
      select: { userId: true },
    });
    if (parent && parent.userId !== session.userId && parent.userId !== post.authorId) {
      await notify({
        userId: parent.userId,
        actorId: session.userId,
        type: 'COMMENT',
        target: { type: 'POST', id },
        text: comment.body.slice(0, 200),
      });
    }
  }

  await notifyMentions(comment.body, session.userId, { type: 'POST', id });

  return ok(serializeComment(comment, { postAuthorId: post.authorId }), 201);
});
