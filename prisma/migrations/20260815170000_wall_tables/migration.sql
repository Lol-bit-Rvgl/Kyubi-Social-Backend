-- CreateTable
CREATE TABLE "WallEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "imageUrl" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WallEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WallLike" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ReactionType" NOT NULL DEFAULT 'LIKE',

    CONSTRAINT "WallLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WallEntry_ownerId_createdAt_idx" ON "WallEntry"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WallEntry_parentId_idx" ON "WallEntry"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "WallLike_entryId_userId_key" ON "WallLike"("entryId", "userId");

-- AddForeignKey
ALTER TABLE "WallEntry" ADD CONSTRAINT "WallEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallEntry" ADD CONSTRAINT "WallEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallEntry" ADD CONSTRAINT "WallEntry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WallEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallLike" ADD CONSTRAINT "WallLike_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WallEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallLike" ADD CONSTRAINT "WallLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

