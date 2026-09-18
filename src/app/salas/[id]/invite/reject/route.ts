import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const session = await requireSession(request);
    if (!session?.userId) return fail('No autorizado', 401);
    const { id } = await params;

    const participant = await prisma.roomParticipant.findUnique({
      where: { roomId_userId: { roomId: id, userId: session.userId } },
      select: { id: true, role: true },
    });

    if (!participant) {
      return fail('No tienes una invitación para esta sala', 404);
    }

    if (participant.role === 'INVITED') {
      await prisma.roomParticipant.delete({
        where: { id: participant.id },
      });
    }

    return ok({ success: true });
  }
);
