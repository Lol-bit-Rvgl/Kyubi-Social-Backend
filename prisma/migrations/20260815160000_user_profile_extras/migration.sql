-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availability" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ProfileVisit_visitorId_visitedId_key" ON "ProfileVisit"("visitorId", "visitedId");

