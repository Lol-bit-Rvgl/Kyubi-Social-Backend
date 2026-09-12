-- Añade los valores 'DICE' y 'RPS' al enum RoomMessageType para la persistencia
-- nativa de tiradas de dados y juego de morra (piedra, papel o tijeras) en salas.
ALTER TYPE "RoomMessageType" ADD VALUE IF NOT EXISTS 'DICE';
ALTER TYPE "RoomMessageType" ADD VALUE IF NOT EXISTS 'RPS';
