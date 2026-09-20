import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireSession } from '@/lib/auth';
import { messageInclude, serializeMessage } from '@/lib/chat';
import { fail, ok, withErrorHandling } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { emitToConversation, emitToUser } from '@/lib/socketio';

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

    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: roomId, userId: session.userId } },
      select: { id: true },
    });
    if (!membership) return fail('No autorizado', 403);

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });

    if (!message || message.conversationId !== roomId) {
      return fail('Mensaje no encontrado en esta conversación', 404);
    }

    const extensions = ((message.extensions ?? {}) as Record<string, any>) || {};
    const poll = (extensions.poll ?? {}) as Record<string, any>;
    const rawOptions = Array.isArray(poll.options)
      ? poll.options
      : (Array.isArray(extensions.options) ? extensions.options : []);

    if (message.mediaType !== 'poll' && !extensions.poll && rawOptions.length === 0) {
      return fail('El mensaje no es una encuesta', 400);
    }

    const body = voteSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return fail(body.error.issues[0]?.message || 'Voto inválido', 400);
    }

    // Normalizar opciones de la encuesta
    const options = rawOptions.map((opt: any, idx: number) => {
      if (typeof opt === 'string') {
        return { id: `opt_${idx + 1}`, text: opt, votes: 0 };
      }
      return {
        id: String(opt?.id ?? `opt_${idx + 1}`),
        text: String(opt?.text ?? `Opción ${idx + 1}`),
        votes: Number(opt?.votes ?? 0),
      };
    });

    if (options.length === 0) {
      return fail('La encuesta no tiene opciones válidas', 400);
    }

    // Determinar optionId y optionIndex
    let targetOptionIndex = -1;
    let targetOptionId = '';

    if (
      body.data.optionIndex !== undefined &&
      body.data.optionIndex >= 0 &&
      body.data.optionIndex < options.length
    ) {
      targetOptionIndex = body.data.optionIndex;
      targetOptionId = options[targetOptionIndex].id;
    } else if (body.data.optionId !== undefined) {
      const idx = options.findIndex(
        (o) => o.id === body.data.optionId || o.text === body.data.optionId
      );
      if (idx !== -1) {
        targetOptionIndex = idx;
        targetOptionId = options[idx].id;
      }
    }

    if (targetOptionIndex === -1) {
      return fail('Opción de encuesta inválida', 400);
    }

    // Registrar o actualizar voto en diccionario: userId -> optionId
    const votes: Record<string, string> = { ...(poll.votes || extensions.votes || {}) };
    votes[session.userId] = targetOptionId;

    // Recalcular conteo de votos por opción y total
    const voteCounts: number[] = new Array(options.length).fill(0);
    let totalVotes = 0;

    for (const [, votedOptId] of Object.entries(votes)) {
      const optIdx = options.findIndex((o) => o.id === votedOptId);
      if (optIdx !== -1) {
        voteCounts[optIdx]++;
        totalVotes++;
      }
    }

    // Actualizar options con los votos acumulados
    const updatedOptions = options.map((opt, idx) => ({
      ...opt,
      votes: voteCounts[idx],
    }));

    const updatedPoll = {
      ...poll,
      question: poll.question || 'Encuesta',
      options: updatedOptions,
      votes,
      totalVotes,
      voteCounts,
    };

    const updatedExtensions = {
      ...extensions,
      poll: updatedPoll,
      options: updatedOptions,
      votes,
      totalVotes,
      voteCounts,
    };

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: { extensions: updatedExtensions as Prisma.InputJsonValue },
      include: messageInclude,
    });

    const serialized = serializeMessage(updatedMessage);

    // Emitir eventos Socket.IO para sincronizar tanto a la sala de conversación
    // como a las salas personales de los miembros ausentes o sin foco
    emitToConversation(roomId, 'message:updated', serialized);
    emitToConversation(roomId, 'conversation:message_updated', serialized);

    const memberIds = await prisma.conversationMember.findMany({
      where: { conversationId: roomId, userId: { not: session.userId } },
      select: { userId: true },
    });
    for (const member of memberIds) {
      emitToUser(member.userId, 'message:updated', serialized);
      emitToUser(member.userId, 'conversation:message_updated', serialized);
    }

    return ok(serialized);
  }
);
