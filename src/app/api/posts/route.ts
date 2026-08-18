import { z } from 'zod';
import { assertCanCreateContent } from '@/lib/authz';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { postInclude } from '@/lib/posts';
import { prisma } from '@/lib/prisma';

const input = z.object({
  content: z.string().trim().min(1).max(5000),
  visibility: z.enum(['PUBLIC', 'FOLLOWERS', 'PRIVATE']).default('PUBLIC'),
});

export const POST = withErrorHandling(async (request: Request) => {
  const session = await assertCanCreateContent(request);
  if (session instanceof Response) return session;

  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('Publicación inválida');

  const post = await prisma.post.create({
    data: { authorId: session.userId, ...body.data },
    include: postInclude,
  });
  return ok(post, 201);
});
