-- AddForeignKey
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FamilyLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChildHomeNodeTarget" ADD CONSTRAINT "ChildHomeNodeTarget_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ChildHomeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
