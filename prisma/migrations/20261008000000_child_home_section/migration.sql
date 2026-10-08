-- AlterTable: split child-home nodes into HOME (default, all existing rows) and CONVERSATION
ALTER TABLE "ChildHomeNode" ADD COLUMN "section" TEXT NOT NULL DEFAULT 'HOME';

-- CreateIndex: list nodes by family + section + level
CREATE INDEX "ChildHomeNode_familyId_section_parentId_idx" ON "ChildHomeNode"("familyId", "section", "parentId");
