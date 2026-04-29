-- AlterTable
ALTER TABLE "ChildHomeNode" ADD COLUMN     "labelOverride" TEXT;

-- AddForeignKey
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChildHomeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildHomeNodeTarget" ADD CONSTRAINT "ChildHomeNodeTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
