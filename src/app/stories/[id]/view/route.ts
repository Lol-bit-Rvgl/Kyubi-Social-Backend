import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);

    const { id } = await params;
    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return fail('Historia no encontrada', 404);
    if (story.expiresAt <= new Date()) return fail('La historia ya expiró', 410);

    await prisma.storyView.upsert({
      where: { storyId_viewerId: { storyId: id, viewerId: session.userId } },
      create: { storyId: id, viewerId: session.userId },
      update: { viewedAt: new Date() },
    });

    return ok({ success: true });
  }
);