import { z } from 'zod';
import { canAccessPost, postInclude } from '@/lib/posts';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const editable = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  content: z.string().trim().min(1).max(10000).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE']).optional(),
  mediaUrls: z.array(z.string()).optional(),
});

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const { id } = await params;
  const post = await canAccessPost(id, session.userId);
  if (post === null) return fail('Publicación no encontrada', 404);
  if (post === false) return fail('No tienes acceso a esta publicación', 403);

  const full = await prisma.post.findUnique({
    where: { id },
    include: { ...postInclude, reactions: { where: { userId: session.userId }, select: { type: true } } },
  });
  if (!full) return fail('Publicación no encontrada', 404);
  const { reactions, ...rest } = full;
  return ok({ ...rest, myReaction: reactions[0]?.type ?? null });
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
    data: {
      ...data,
      isEdited: true,
    },
    include: postInclude,
  });
  return ok(updated);
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
