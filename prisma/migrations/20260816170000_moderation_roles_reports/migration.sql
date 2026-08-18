-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('MUTE_USER', 'UNMUTE_USER', 'BAN_USER', 'UNBAN_USER', 'DELETE_POST', 'DELETE_CIRCLE', 'DELETE_SALA', 'REVIEW_REPORT', 'RESOLVE_REPORT', 'DISMISS_REPORT', 'CHANGE_ROLE');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('USER', 'POST', 'CIRCLE', 'ROOM', 'REPORT');

-- AlterTable: add system-wide role to users (defaults to USER)
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- AlterTable: add moderation fields to reports
ALTER TABLE "Report" ADD COLUMN "handledById" TEXT;
ALTER TABLE "Report" ADD COLUMN "resolutionNote" VARCHAR(2000);

-- AlterTable: convert Report.status from TEXT to ReportStatus enum.
-- SAFE: every existing value is 'OPEN' (the only value ever written), which is a valid enum member.
-- No data is lost; the index Report_status_idx is preserved by Postgres across the type change.
ALTER TABLE "Report" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Report" ALTER COLUMN "status" TYPE "ReportStatus" USING ("status"::"ReportStatus");
ALTER TABLE "Report" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- CreateTable: user-level mute records (active when revokedAt IS NULL; permanent when expiresAt IS NULL)
CREATE TABLE "Mute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" VARCHAR(1000),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mute_pkey" PRIMARY KEY ("id")
);

-- CreateTable: user-level ban records
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "reason" VARCHAR(1000),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

-- CreateTable: append-only moderation audit log
CREATE TABLE "ModerationLog" (
    "id" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mute_userId_revokedAt_idx" ON "Mute"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Mute_moderatorId_idx" ON "Mute"("moderatorId");

-- CreateIndex
CREATE INDEX "Mute_createdAt_idx" ON "Mute"("createdAt");

-- CreateIndex
CREATE INDEX "Ban_userId_revokedAt_idx" ON "Ban"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Ban_moderatorId_idx" ON "Ban"("moderatorId");

-- CreateIndex
CREATE INDEX "Ban_createdAt_idx" ON "Ban"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_moderatorId_createdAt_idx" ON "ModerationLog"("moderatorId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationLog_targetType_targetId_idx" ON "ModerationLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationLog_createdAt_idx" ON "ModerationLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
