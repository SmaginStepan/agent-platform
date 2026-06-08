-- AlterTable: replace nullable scalar weekday with integer array weekdays
ALTER TABLE "ScheduleItem" ADD COLUMN "weekdays" INTEGER[] NOT NULL DEFAULT '{}';
UPDATE "ScheduleItem" SET "weekdays" = ARRAY["weekday"] WHERE "weekday" IS NOT NULL;
ALTER TABLE "ScheduleItem" DROP COLUMN "weekday";

-- DropIndex
DROP INDEX IF EXISTS "ScheduleItem_familyId_weekday_idx";
