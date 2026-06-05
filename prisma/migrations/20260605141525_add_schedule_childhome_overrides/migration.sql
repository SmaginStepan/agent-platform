-- AlterTable
ALTER TABLE "ScheduleItem" ADD COLUMN     "forceHideChildHomeNodeIds" JSONB,
ADD COLUMN     "forceShowChildHomeNodeIds" JSONB;
