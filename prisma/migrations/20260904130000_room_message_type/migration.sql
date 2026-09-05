-- Tipo de contenido de los mensajes de sala (TEXT | VOICE | IMAGE | POLL).

-- CreateEnum
CREATE TYPE "RoomMessageType" AS ENUM ('TEXT', 'VOICE', 'IMAGE', 'POLL');

-- AlterTable
ALTER TABLE "RoomMessage" ADD COLUMN "type" "RoomMessageType" NOT NULL DEFAULT 'TEXT';