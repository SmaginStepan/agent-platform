-- DropForeignKey
ALTER TABLE "AacMessage" DROP CONSTRAINT "AacMessage_familyId_fkey";

-- DropForeignKey
ALTER TABLE "AacMessage" DROP CONSTRAINT "AacMessage_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "AacMessage" DROP CONSTRAINT "AacMessage_toUserId_fkey";

-- DropForeignKey
ALTER TABLE "AacReply" DROP CONSTRAINT "AacReply_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "AacReply" DROP CONSTRAINT "AacReply_messageId_fkey";

-- DropForeignKey
ALTER TABLE "AacReply" DROP CONSTRAINT "AacReply_toUserId_fkey";

-- DropForeignKey
ALTER TABLE "ChildHomeNode" DROP CONSTRAINT "ChildHomeNode_itemId_fkey";

-- DropForeignKey
ALTER TABLE "FamilyLibraryItem" DROP CONSTRAINT "FamilyLibraryItem_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "FamilyLibraryItem" DROP CONSTRAINT "FamilyLibraryItem_familyId_fkey";

-- DropForeignKey
ALTER TABLE "FamilyLibrarySet" DROP CONSTRAINT "FamilyLibrarySet_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "FamilyLibrarySet" DROP CONSTRAINT "FamilyLibrarySet_familyId_fkey";

-- AddForeignKey
ALTER TABLE "AacMessage" ADD CONSTRAINT "AacMessage_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AacMessage" ADD CONSTRAINT "AacMessage_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AacMessage" ADD CONSTRAINT "AacMessage_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AacReply" ADD CONSTRAINT "AacReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AacMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AacReply" ADD CONSTRAINT "AacReply_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AacReply" ADD CONSTRAINT "AacReply_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibraryItem" ADD CONSTRAINT "FamilyLibraryItem_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibraryItem" ADD CONSTRAINT "FamilyLibraryItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySet" ADD CONSTRAINT "FamilyLibrarySet_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyLibrarySet" ADD CONSTRAINT "FamilyLibrarySet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FamilyLibraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
