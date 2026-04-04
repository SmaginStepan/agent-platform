-- AlterTable
ALTER TABLE "FamilyLibrarySet" ADD COLUMN     "coverItemId" TEXT;

-- CreateIndex
CREATE INDEX "FamilyLibrarySet_coverItemId_idx" ON "FamilyLibrarySet"("coverItemId");

-- AddForeignKey
ALTER TABLE "FamilyLibrarySet" ADD CONSTRAINT "FamilyLibrarySet_coverItemId_fkey" FOREIGN KEY ("coverItemId") REFERENCES "FamilyLibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
