/*
  Warnings:

  - You are about to drop the `FamilyPhotoCard` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "LibraryItemSource" AS ENUM ('FAMILY_PHOTO', 'ARASAAC');

-- DropForeignKey
ALTER TABLE "FamilyPhotoCard" DROP CONSTRAINT "FamilyPhotoCard_familyId_fkey";

-- DropForeignKey
ALTER TABLE "FamilyPhotoCard" DROP CONSTRAINT "FamilyPhotoCard_uploadedByUserId_fkey";

-- DropTable
DROP TABLE "FamilyPhotoCard";

-- CreateTable
CREATE TABLE "FamilyLibraryItem" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "source" "LibraryItemSource" NOT NULL,
    "sourceRef" TEXT,
    "storageKey" TEXT,
    "imageUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyLibrarySet" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamilyLibrarySet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyLibrarySetItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FamilyLibrarySetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyLibraryItem_storageKey_key" ON "FamilyLibraryItem"("storageKey");

-- CreateIndex
CREATE INDEX "FamilyLibraryItem_familyId_createdAt_idx" ON "FamilyLibraryItem"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyLibraryItem_familyId_source_createdAt_idx" ON "FamilyLibraryItem"("familyId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyLibraryItem_createdByUserId_createdAt_idx" ON "FamilyLibraryItem"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyLibrarySet_familyId_createdAt_idx" ON "FamilyLibrarySet"("familyId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyLibrarySet_createdByUserId_createdAt_idx" ON "FamilyLibrarySet"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "FamilyLibrarySetItem_setId_sortOrder_idx" ON "FamilyLibrarySetItem"("setId", "sortOrder");

-- CreateIndex
CREATE INDEX "FamilyLibrarySetItem_itemId_idx" ON "FamilyLibrarySetItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FamilyLibrarySetItem_setId_itemId_key" ON "FamilyLibrarySetItem"("setId", "itemId");

-- AddForeignKey
ALTER TABLE "FamilyLibraryItem" ADD CONSTRAINT "FamilyLibraryItem_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibraryItem" ADD CONSTRAINT "FamilyLibraryItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySet" ADD CONSTRAINT "FamilyLibrarySet_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySet" ADD CONSTRAINT "FamilyLibrarySet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySetItem" ADD CONSTRAINT "FamilyLibrarySetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "FamilyLibrarySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySetItem" ADD CONSTRAINT "FamilyLibrarySetItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FamilyLibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
