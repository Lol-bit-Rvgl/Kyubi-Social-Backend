import { requireSession } from '@/lib/auth';
import { messageInclude, serializeMessage } from '@/lib/chat';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandling(async (request: Request, { params }: { params: Promise<{ conversationId: string }> }) => {
  const session = await requireSession(request);
  if (!session) return fail('No autorizado', 401);
  const { conversationId } = await params;

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: session.userId } },
    select: { id: true },
  });
  if (!membership) return fail('No autorizado', 403);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return ok({ data: [], results: [], query: q });

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      body: { contains: q, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: messageInclude,
  });

  return ok({ data: messages.map(serializeMessage), results: messages.map(serializeMessage), query: q });
});
