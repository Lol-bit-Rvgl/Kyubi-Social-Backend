import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { findUserByIdOrUsername } from '@/lib/users';
import { notify, notifyMentions } from '@/lib/notifications';
import { reactionKey } from '@/lib/serialize';

function wallEntryToJson(entry: any, myId: string, wallOwnerId: string) {
  const liked = entry.likes.some((l: any) => l.userId === myId);
  return {
    id: entry.id,
    authorId: entry.author.id,
    authorName: entry.author.displayName ?? entry.author.username,
    authorAvatarUrl: entry.author.avatarUrl,
    authorEmoji: '🐾',
    isAuthor: entry.author.id === wallOwnerId,
    text: entry.body,
    imageUrl: entry.imageUrl,
    parentId: entry.parentId,
    replyToUsername: null,
    likes: entry.likes.length,
    isLikedByMe: liked,
    myReaction: liked ? reactionKey(entry.likes.find((l: any) => l.userId === myId).type) : null,
    createdAt: entry.createdAt.toISOString(),
    repliesCount: entry._count?.replies ?? 0,
  };
}

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { userId } = await params;
  const target = userId === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(userId);
  if (!target) return fail('Usuario no encontrado', 404);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = 20;

  const [entries, total] = await Promise.all([
    prisma.wallEntry.findMany({
      where: { ownerId: target.id, parentId: null },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        likes: { select: { userId: true, type: true } },
        _count: { select: { replies: true } },
      },
    }),
    prisma.wallEntry.count({ where: { ownerId: target.id, parentId: null } }),
  ]);

  return ok({
    data: entries.map((e) => wallEntryToJson(e, session.userId, target.id)),
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    page,
  });
});

const createSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  imageUrl: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export const POST = withErrorHandling(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { userId } = await params;
  const target = userId === 'me' ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true } }) : await findUserByIdOrUsername(userId);
  if (!target) return fail('Usuario no encontrado', 404);

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Mensaje inválido');

  const entry = await prisma.wallEntry.create({
    data: {
      ownerId: target.id,
      authorId: session.userId,
      body: body.data.text,
      imageUrl: body.data.imageUrl ?? null,
      parentId: body.data.parentId ?? null,
    },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      likes: { select: { userId: true, type: true } },
      _count: { select: { replies: true } },
    },
  });

  if (target.id !== session.userId) {
    await notify({
      userId: target.id,
      actorId: session.userId,
      type: 'WALL',
      target: { type: 'WALL_ENTRY', id: entry.id },
      text: body.data.text.slice(0, 200),
    });
  }

  if (body.data.parentId) {
    const parent = await prisma.wallEntry.findUnique({
      where: { id: body.data.parentId },
      select: { authorId: true },
    });
    if (parent && parent.authorId !== session.userId && parent.authorId !== target.id) {
      await notify({
        userId: parent.authorId,
        actorId: session.userId,
        type: 'WALL',
        target: { type: 'WALL_ENTRY', id: body.data.parentId },
        text: body.data.text.slice(0, 200),
      });
    }
  }

  await notifyMentions(body.data.text, session.userId, { type: 'WALL_ENTRY', id: entry.id });

  return ok(wallEntryToJson(entry, session.userId, target.id), 201);
});

export const DELETE = withErrorHandling(async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { userId } = await params;
  const entry = await prisma.wallEntry.findUnique({
    where: { id: userId },
    select: { authorId: true, ownerId: true },
  });
  if (!entry) return fail('Mensaje no encontrado', 404);
  if (entry.authorId !== session.userId && entry.ownerId !== session.userId) return fail('No autorizado', 403);
  await prisma.wallEntry.delete({ where: { id: userId } });
  return ok({ success: true });
});
