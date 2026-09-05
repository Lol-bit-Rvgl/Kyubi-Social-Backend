
-- AlterEnum
BEGIN;
CREATE TYPE "ModerationAction_new" AS ENUM ('MUTE_USER', 'UNMUTE_USER', 'BAN_USER', 'UNBAN_USER', 'DELETE_POST', 'DELETE_CIRCLE', 'DELETE_SALA', 'REVIEW_REPORT', 'RESOLVE_REPORT', 'DISMISS_REPORT', 'CHANGE_ROLE', 'WARN', 'SUSPEND_USER', 'UNSUSPEND_USER', 'HIDE_POST', 'UNHIDE_POST', 'HIDE_COMMENT', 'UNHIDE_COMMENT', 'HIDE_MESSAGE', 'UNHIDE_MESSAGE', 'PIN_POST', 'UNPIN_POST', 'FEATURE_POST', 'UNFEATURE_POST', 'HIDE_PROFILE', 'UNHIDE_PROFILE', 'ASSIGN_TITLE', 'REMOVE_TITLE');
ALTER TABLE "ModerationLog" ALTER COLUMN "action" TYPE "ModerationAction_new" USING ("action"::text::"ModerationAction_new");
ALTER TYPE "ModerationAction" RENAME TO "ModerationAction_old";
ALTER TYPE "ModerationAction_new" RENAME TO "ModerationAction";
DROP TYPE "ModerationAction_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ModerationTargetType_new" AS ENUM ('USER', 'POST', 'CIRCLE', 'ROOM', 'REPORT', 'COMMENT', 'MESSAGE');
ALTER TABLE "ModerationLog" ALTER COLUMN "targetType" TYPE "ModerationTargetType_new" USING ("targetType"::text::"ModerationTargetType_new");
ALTER TYPE "ModerationTargetType" RENAME TO "ModerationTargetType_old";
ALTER TYPE "ModerationTargetType_new" RENAME TO "ModerationTargetType";
DROP TYPE "ModerationTargetType_old";
COMMIT;

-- AlterEnum
ALTER TYPE "ReportTargetType" ADD VALUE 'CIRCLE';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ModerationLog" ADD COLUMN     "target_post_id" TEXT,
ADD COLUMN     "target_user_id" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "featured_until" TIMESTAMP(3),
ADD COLUMN     "hidden_by_user_id" TEXT,
ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "reported_user_id" TEXT,
ADD COLUMN     "resolution_notes" VARCHAR(2000),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "is_profile_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_suspended" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderation_notes" TEXT,
ADD COLUMN     "suspended_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserTitle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title_text" VARCHAR(80) NOT NULL,
    "color_hex" VARCHAR(9) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTitle_userId_display_order_idx" ON "UserTitle"("userId", "display_order");

-- CreateIndex
CREATE INDEX "ModerationLog_target_user_id_idx" ON "ModerationLog"("target_user_id");

-- CreateIndex
CREATE INDEX "ModerationLog_target_post_id_idx" ON "ModerationLog"("target_post_id");

-- CreateIndex
CREATE INDEX "Post_is_pinned_idx" ON "Post"("is_pinned");

-- CreateIndex
CREATE INDEX "Post_is_hidden_idx" ON "Post"("is_hidden");

-- CreateIndex
CREATE INDEX "Post_featured_until_idx" ON "Post"("featured_until");

-- CreateIndex
CREATE INDEX "Report_reported_user_id_idx" ON "Report"("reported_user_id");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_hidden_by_user_id_fkey" FOREIGN KEY ("hidden_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_target_post_id_fkey" FOREIGN KEY ("target_post_id") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTitle" ADD CONSTRAINT "UserTitle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
