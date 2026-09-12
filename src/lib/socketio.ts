type SocketServer = {
  to(room: string): { emit(event: string, payload: unknown): void };
  emit(event: string, payload: unknown): void;
};

declare global {
  // eslint-disable-next-line no-var
  var __kyubiIo: SocketServer | undefined;
}

export function getSocketIO(): SocketServer | undefined {
  return globalThis.__kyubiIo;
}

export function emitToConversation(conversationId: string, event: string, payload: unknown) {
  const io = getSocketIO();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  const io = getSocketIO();
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToSala(roomId: string, event: string, payload: unknown) {
  const io = getSocketIO();
  if (!io) return;
  io.to(`sala:${roomId}`).emit(event, payload);
}

/** Emite a un room arbitrario (p. ej. canales globales como `moderation:feed`). */
export function emitToRoom(room: string, event: string, payload: unknown) {
  const io = getSocketIO();
  if (!io) return;
  io.to(room).emit(event, payload);
}

/** Emite a todos los clientes conectados (broadcast global). */
export function emitBroadcast(event: string, payload: unknown) {
  const io = getSocketIO();
  if (!io) return;
  io.emit(event, payload);
}
