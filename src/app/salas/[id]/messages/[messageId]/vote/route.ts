import { z } from 'zod';
import { requireSession } from '@/lib/auth';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToSala } from '@/lib/socketio';

const voteSchema = z
  .object({
    optionId: z.string().optional(),
    optionIndex: z.number().int().min(0).max(10).optional(),
  })
  .refine((data) => data.optionId !== undefined || data.optionIndex !== undefined, {
    message: 'Debes proporcionar optionId o optionIndex',
  });

export const POST = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    const session = await requireSession(request);
    if (!session) return fail('No autorizado', 401);
    const { id: roomId, messageId } = await params;

    const message = await prisma.roomMessage.findUnique({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!message || message.roomId !== roomId) {
      return fail('Mensaje no encontrado en esta sala', 404);
    }

    if (message.type !== 'POLL') {
      return fail('El mensaje no es una encuesta', 400);
    }

    const body = voteSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return fail(body.error.issues[0]?.message || 'Voto inválido', 400);
    }

    const extensions = ((message.extensions ?? {}) as Record<string, any>) || {};
    const rawOptions = Array.isArray(extensions.options) ? extensions.options : [];

    // Normalizar opciones
    const options = rawOptions.map((opt, idx) => {
      if (typeof opt === 'string') {
        return { id: String(idx), text: opt, votes: 0 };
      }
      return {
        id: String(opt?.id ?? idx),
        text: String(opt?.text ?? ''),
        votes: Number(opt?.votes ?? 0),
      };
    });

    // Determinar optionId y optionIndex
    let targetOptionIndex = -1;
    let targetOptionId = '';

    if (body.data.optionIndex !== undefined && body.data.optionIndex < options.length) {
      targetOptionIndex = body.data.optionIndex;
      targetOptionId = options[targetOptionIndex].id;
    } else if (body.data.optionId !== undefined) {
      const idx = options.findIndex((o) => o.id === body.data.optionId || o.text === body.data.optionId);
      if (idx !== -1) {
        targetOptionIndex = idx;
        targetOptionId = options[idx].id;
      }
    }

    if (targetOptionIndex === -1) {
      return fail('Opción de encuesta inválida', 400);
    }

    // Mapa de votos: userId -> optionId
    const votes: Record<string, string> = { ...(extensions.votes || {}) };
    votes[session.userId] = targetOptionId;

    // Recalcular conteo de votos por opción
    const voteCounts: number[] = new Array(options.length).fill(0);
    let totalVotes = 0;

    for (const [, votedOptId] of Object.entries(votes)) {
      const optIdx = options.findIndex((o) => o.id === votedOptId);
      if (optIdx !== -1) {
        voteCounts[optIdx]++;
        totalVotes++;
      }
    }

    // Actualizar options con votes actualizados
    const updatedOptions = options.map((opt, idx) => ({
      ...opt,
      votes: voteCounts[idx],
    }));

    const updatedExtensions = {
      ...extensions,
      options: updatedOptions,
      votes,
      totalVotes,
      voteCounts,
    };

    await prisma.roomMessage.update({
      where: { id: messageId },
      data: { extensions: updatedExtensions },
    });

    // Emitir evento Socket.IO a todos los usuarios de la sala
    emitToSala(roomId, 'room:poll_voted', {
      roomId,
      messageId,
      userId: session.userId,
      optionId: targetOptionId,
      optionIndex: targetOptionIndex,
      totalVotes,
      voteCounts,
      options: updatedOptions,
    });

    return ok({
      success: true,
      messageId,
      userVotedOptionId: targetOptionId,
      userVotedOptionIndex: targetOptionIndex,
      totalVotes,
      voteCounts,
      options: updatedOptions,
    });
  }
);
