-- ── Roleplay / OCs ──────────────────────────────────────────────────────
-- Metadatos de identidad de rol en mensajes (chat DM y salas) + tabla
-- Character para las Fichas de Rol del usuario.

-- AlterTable: metadatos de rol en Message
ALTER TABLE "Message" ADD COLUMN "characterId" VARCHAR(64),
ADD COLUMN "characterName" VARCHAR(80),
ADD COLUMN "characterAvatarUrl" TEXT,
ADD COLUMN "extensions" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: metadatos de rol en RoomMessage
ALTER TABLE "RoomMessage" ADD COLUMN "characterId" VARCHAR(64),
ADD COLUMN "characterName" VARCHAR(80),
ADD COLUMN "characterAvatarUrl" TEXT,
ADD COLUMN "extensions" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: firma de rol (OC) en Post (publicaciones de círculos)
ALTER TABLE "Post" ADD COLUMN "characterId" VARCHAR(64),
ADD COLUMN "characterName" VARCHAR(80),
ADD COLUMN "characterAvatarUrl" TEXT;

-- CreateTable: Character (Fichas de Rol / OCs)
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "alias" VARCHAR(40),
    "tagline" VARCHAR(140),
    "avatarUrl" TEXT,
    "bannerUrl" TEXT,
    "description" VARCHAR(2000),
    "lore" TEXT,
    "appearance" TEXT,
    "abilities" JSONB NOT NULL DEFAULT '[]',
    "weaknesses" JSONB NOT NULL DEFAULT '[]',
    "universes" JSONB NOT NULL DEFAULT '[]',
    "genres" JSONB NOT NULL DEFAULT '[]',
    "faceClaim" VARCHAR(120),
    "voiceClaim" VARCHAR(120),
    "powerLevel" INTEGER NOT NULL DEFAULT 1,
    "roleplayLevel" VARCHAR(24) NOT NULL DEFAULT 'Novato',
    "themeColor" VARCHAR(9),
    "themeAccent" VARCHAR(9),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Character_userId_createdAt_idx" ON "Character"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
