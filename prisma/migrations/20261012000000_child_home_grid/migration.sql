-- AlterTable: fixed-grid position and word-class colour for CONVERSATION nodes (null for HOME)
ALTER TABLE "ChildHomeNode" ADD COLUMN "gridRow" INTEGER;
ALTER TABLE "ChildHomeNode" ADD COLUMN "gridCol" INTEGER;
ALTER TABLE "ChildHomeNode" ADD COLUMN "color" TEXT;

-- Both set or both null; 0..99 so sortOrder = gridRow * 100 + gridCol stays unique and ordered.
-- Cell uniqueness per (family, section, parent) is enforced in code under a transaction lock.
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_grid_pair_check"
  CHECK (("gridRow" IS NULL) = ("gridCol" IS NULL));
ALTER TABLE "ChildHomeNode" ADD CONSTRAINT "ChildHomeNode_grid_range_check"
  CHECK ("gridRow" IS NULL OR ("gridRow" BETWEEN 0 AND 99 AND "gridCol" BETWEEN 0 AND 99));
