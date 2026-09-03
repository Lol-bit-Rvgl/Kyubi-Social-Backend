-- CreateTable
CREATE TABLE "RoleSlot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requirements" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "assignedCharacterId" TEXT,
    "assignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleSlot_postId_idx" ON "RoleSlot"("postId");

-- CreateIndex
CREATE INDEX "RoleSlot_assignedUserId_idx" ON "RoleSlot"("assignedUserId");

-- AddForeignKey
ALTER TABLE "RoleSlot" ADD CONSTRAINT "RoleSlot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleSlot" ADD CONSTRAINT "RoleSlot_assignedCharacterId_fkey" FOREIGN KEY ("assignedCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleSlot" ADD CONSTRAINT "RoleSlot_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
