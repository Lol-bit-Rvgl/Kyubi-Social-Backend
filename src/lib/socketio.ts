type SocketServer = {
  to(room: string): { emit(event: string, payload: unknown): void };
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
