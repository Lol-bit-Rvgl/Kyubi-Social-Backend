-- Añade el valor 'SYSTEM' al enum RoomMessageType para los mensajes automáticos
-- de actividad (inicio/fin de voz, cine y roleplay) que se persisten en BD.
ALTER TYPE "RoomMessageType" ADD VALUE IF NOT EXISTS 'SYSTEM';