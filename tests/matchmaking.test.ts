import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addToQueue,
  clearQueue,
  getQueue,
  getQueueSize,
  handleMatchAccept,
  handleMatchReject,
  removeFromQueue,
  tryFindMatch,
} from '@/lib/matchmaker';
import type { PrismaMock } from './helpers';

describe('Matchmaker Unit Tests', () => {
  let mockPrisma: any;
  let mockIo: any;

  beforeEach(() => {
    clearQueue();
    vi.clearAllMocks();

    mockPrisma = {
      user: {
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          if (where.id === 'user-1') {
            return Promise.resolve({
              id: 'user-1',
              username: 'user_one',
              displayName: 'User One',
              avatarUrl: 'https://avatar1.png',
              level: 5,
              bio: 'Bio one',
              interests: ['Anime', 'Gaming'],
            });
          }
          if (where.id === 'user-2') {
            return Promise.resolve({
              id: 'user-2',
              username: 'user_two',
              displayName: 'User Two',
              avatarUrl: 'https://avatar2.png',
              level: 8,
              bio: 'Bio two',
              interests: ['Roleplay'],
            });
          }
          return Promise.resolve({
            id: where.id,
            username: `user_${where.id}`,
            displayName: `User ${where.id}`,
            avatarUrl: null,
            level: 1,
            bio: null,
            interests: [],
          });
        }),
      },
      block: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      conversation: {
        create: vi.fn().mockImplementation(({ data }: any) => {
          return Promise.resolve({
            id: 'conv-123',
            type: data.type,
            metadata: data.metadata,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }),
        findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
          return Promise.resolve({
            id: where.id,
            type: 'DIRECT',
            metadata: {
              isMatch: true,
              status: 'pending',
              acceptedBy: [],
            },
            members: [
              { userId: 'user-1', role: 'MEMBER' },
              { userId: 'user-2', role: 'MEMBER' },
            ],
          });
        }),
        update: vi.fn().mockImplementation(({ where, data }: any) => {
          return Promise.resolve({
            id: where.id,
            type: 'DIRECT',
            metadata: data.metadata,
            updatedAt: new Date(),
          });
        }),
      },
    };

    mockIo = {
      to: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnValue({
        socketsJoin: vi.fn(),
      }),
      emit: vi.fn(),
      sockets: {
        sockets: new Map([
          ['socket-1', { join: vi.fn(), emit: vi.fn() }],
          ['socket-2', { join: vi.fn(), emit: vi.fn() }],
        ]),
      },
    };
  });

  describe('Queue Management', () => {
    it('agrega usuarios a la cola y previene duplicados con el mismo userId', () => {
      expect(getQueueSize()).toBe(0);

      const added1 = addToQueue('user-1', 'socket-1', 'anime');
      expect(added1).toBe(true);
      expect(getQueueSize()).toBe(1);

      // Mismo usuario con nuevo socketId actualiza la entrada
      const added2 = addToQueue('user-1', 'socket-1-new', 'anime');
      expect(added2).toBe(true);
      expect(getQueueSize()).toBe(1);

      const entry = getQueue().get('user-1');
      expect(entry?.socketId).toBe('socket-1-new');
    });

    it('remueve usuarios de la cola limpiamente', () => {
      addToQueue('user-1', 'socket-1');
      addToQueue('user-2', 'socket-2');
      expect(getQueueSize()).toBe(2);

      const removed = removeFromQueue('user-1');
      expect(removed).toBe(true);
      expect(getQueueSize()).toBe(1);
      expect(getQueue().has('user-1')).toBe(false);
      expect(getQueue().has('user-2')).toBe(true);
    });

    it('no falla al remover un usuario inexistente', () => {
      expect(removeFromQueue('unknown-user')).toBe(false);
    });
  });

  describe('tryFindMatch', () => {
    it('no empareja si hay menos de 2 usuarios en cola', async () => {
      addToQueue('user-1', 'socket-1');
      const result = await tryFindMatch(mockIo, mockPrisma);
      expect(result).toBeNull();
      expect(getQueueSize()).toBe(1);
    });

    it('empareja exitosamente a 2 usuarios no bloqueados y crea conversación directa provisional', async () => {
      addToQueue('user-1', 'socket-1', 'Roleplay');
      addToQueue('user-2', 'socket-2', 'Roleplay');

      const match = await tryFindMatch(mockIo, mockPrisma);
      expect(match).not.toBeNull();
      expect(match?.conversationId).toBe('conv-123');
      expect(match?.userAId).toBe('user-1');
      expect(match?.userBId).toBe('user-2');

      // Ambos fueron removidos de la cola
      expect(getQueueSize()).toBe(0);

      // Se creó la conversación directa con metadatos de match provisional
      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: {
          type: 'DIRECT',
          metadata: {
            isMatch: true,
            status: 'pending',
            acceptedBy: [],
          },
          members: {
            create: [
              { userId: 'user-1', role: 'MEMBER' },
              { userId: 'user-2', role: 'MEMBER' },
            ],
          },
        },
      });

      // Se emitieron eventos match:found a ambos sockets y usuarios
      expect(mockIo.to).toHaveBeenCalledWith('socket-1');
      expect(mockIo.to).toHaveBeenCalledWith('user:user-1');
      expect(mockIo.to).toHaveBeenCalledWith('socket-2');
      expect(mockIo.to).toHaveBeenCalledWith('user:user-2');
      expect(mockIo.emit).toHaveBeenCalledWith(
        'match:found',
        expect.objectContaining({
          conversationId: 'conv-123',
          partner: expect.objectContaining({
            id: 'user-2',
            username: 'user_two',
            displayName: 'User Two',
          }),
        })
      );
    });

    it('descarta emparejamiento si existe un bloqueo mutuo entre los usuarios', async () => {
      addToQueue('user-1', 'socket-1');
      addToQueue('user-2', 'socket-2');

      // Simular bloqueo mutuo en base de datos
      mockPrisma.block.findFirst.mockResolvedValueOnce({
        id: 'block-1',
        blockerId: 'user-2',
        blockedId: 'user-1',
      });

      const match = await tryFindMatch(mockIo, mockPrisma);
      // No debe emparejar y deben seguir en cola
      expect(match).toBeNull();
      expect(getQueueSize()).toBe(2);
      expect(mockPrisma.conversation.create).not.toHaveBeenCalled();

      // Si entra un tercer usuario sin bloqueo, se empareja
      addToQueue('user-3', 'socket-3');
      mockPrisma.block.findFirst.mockResolvedValue(null);

      const matchWithThird = await tryFindMatch(mockIo, mockPrisma);
      expect(matchWithThird).not.toBeNull();
      expect(getQueueSize()).toBe(1); // Queda 1 usuario en cola
    });
  });

  describe('handleMatchAccept', () => {
    it('gestiona la aceptación unilateral (esperando al compañero)', async () => {
      const res = await handleMatchAccept(mockIo, mockPrisma, 'conv-123', 'user-1');
      expect(res).not.toBeNull();
      expect(res?.status).toBe('pending');
      expect(res?.acceptedBy).toEqual(['user-1']);

      // Persistencia en DB
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: {
          metadata: {
            isMatch: true,
            status: 'pending',
            acceptedBy: ['user-1'],
          },
        },
      });

      // Emite match:peer_accepted al compañero
      expect(mockIo.to).toHaveBeenCalledWith('user:user-2');
      expect(mockIo.emit).toHaveBeenCalledWith('match:peer_accepted', {
        conversationId: 'conv-123',
        acceptedByUserId: 'user-1',
      });
    });

    it('gestiona la aceptación mutua y emite match:mutual_accept', async () => {
      // Simular que user-1 ya aceptó
      mockPrisma.conversation.findUnique.mockResolvedValueOnce({
        id: 'conv-123',
        type: 'DIRECT',
        metadata: {
          isMatch: true,
          status: 'pending',
          acceptedBy: ['user-1'],
        },
        members: [
          { userId: 'user-1', role: 'MEMBER' },
          { userId: 'user-2', role: 'MEMBER' },
        ],
      });

      const res = await handleMatchAccept(mockIo, mockPrisma, 'conv-123', 'user-2');
      expect(res).not.toBeNull();
      expect(res?.status).toBe('accepted');
      expect(res?.acceptedBy).toContain('user-1');
      expect(res?.acceptedBy).toContain('user-2');

      // Persistencia en DB con status accepted
      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: {
          metadata: {
            isMatch: true,
            status: 'accepted',
            acceptedBy: ['user-1', 'user-2'],
          },
        },
      });

      // Emite match:mutual_accept a la sala y a los usuarios
      expect(mockIo.to).toHaveBeenCalledWith('conversation:conv-123');
      expect(mockIo.emit).toHaveBeenCalledWith('match:mutual_accept', {
        conversationId: 'conv-123',
      });
    });
  });

  describe('handleMatchReject', () => {
    it('cierra el match y emite match:closed con motivo partner_left', async () => {
      const res = await handleMatchReject(mockIo, mockPrisma, 'conv-123', 'user-1', false);
      expect(res).not.toBeNull();
      expect(res?.status).toBe('closed');

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-123' },
        data: {
          metadata: expect.objectContaining({
            isMatch: true,
            status: 'closed',
          }),
        },
      });

      expect(mockIo.to).toHaveBeenCalledWith('conversation:conv-123');
      expect(mockIo.emit).toHaveBeenCalledWith('match:closed', {
        conversationId: 'conv-123',
        reason: 'partner_left',
        closedByUserId: 'user-1',
      });
    });

    it('en match:next cierra el actual y vuelve a encolar al usuario buscando nueva pareja', async () => {
      addToQueue('user-3', 'socket-3'); // Alguien esperando en cola

      const res = await handleMatchReject(
        mockIo,
        mockPrisma,
        'conv-123',
        'user-1',
        true,
        'socket-1',
        'Gaming'
      );
      expect(res?.status).toBe('closed');

      // Se intentó emparejar a user-1 (re-encolado) con user-3
      expect(mockPrisma.conversation.create).toHaveBeenCalled();
    });
  });
});
