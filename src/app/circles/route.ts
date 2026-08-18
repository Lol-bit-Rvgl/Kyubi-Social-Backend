import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { circleInclude, memberRoles, serializeCircle } from '@/lib/social';

export const GET = withErrorHandling(async (request: Request) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '30', 10) || 30));
  const q = (url.searchParams.get('q') ?? '').trim();
  const onlyMine = url.searchParams.get('mine') === 'true';

  const where = {
    isPrivate: false,
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] } : {}),
    ...(onlyMine ? { members: { some: { userId: session.userId } } } : {}),
  };

  const circles = await prisma.circle.findMany({
    where,
    orderBy: [{ members: { _count: 'desc' } }, { createdAt: 'desc' }],
    take: limit,
    include: circleInclude,
  });

  const roles = await memberRoles(prisma, circles.map((c) => c.id), session.userId);

  return ok({
    data: circles.map((circle) => serializeCircle(circle, { myUserId: session.userId, role: roles.get(circle.id) ?? null })),
    total: await prisma.circle.count({ where }),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).optional(),
  avatarUrl: z.string().nullable().optional(),
  bannerUrl: z.string().nullable().optional(),
  isPrivate: z.boolean().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Círculo inválido', 400);

  const circle = await prisma.$transaction(async (tx) => {
    const created = await tx.circle.create({
      data: {
        name: body.data.name,
        description: body.data.description ?? null,
        avatarUrl: body.data.avatarUrl ?? null,
        bannerUrl: body.data.bannerUrl ?? null,
        isPrivate: body.data.isPrivate ?? false,
        creatorId: session.userId,
        members: { create: { userId: session.userId, role: 'OWNER' } },
      },
      include: circleInclude,
    });
    return created;
  });

  return ok(serializeCircle(circle, { myUserId: session.userId, role: 'OWNER' }), 201);
});
