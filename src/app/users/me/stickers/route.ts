import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

const addSchema = z.object({ stickerUrl: z.string().url() });
const removeSchema = z.object({ stickerUrl: z.string().url() });

export const POST = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = addSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Sticker inválido');
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { stickers: true } });
  if (!user) return fail('Usuario no encontrado', 404);
  const stickers = user.stickers.includes(body.data.stickerUrl)
    ? user.stickers
    : [...user.stickers, body.data.stickerUrl];
  await prisma.user.update({ where: { id: session.userId }, data: { stickers } });
  return ok({ stickers }, 201);
});

export const DELETE = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const body = removeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Sticker inválido');
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { stickers: true } });
  if (!user) return fail('Usuario no encontrado', 404);
  const stickers = user.stickers.filter((s) => s !== body.data.stickerUrl);
  await prisma.user.update({ where: { id: session.userId }, data: { stickers } });
  return ok({ stickers });
});
