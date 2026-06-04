-- CreateEnum
CREATE TYPE "ScheduleItemMode" AS ENUM ('WEEKDAY', 'DATE');

-- CreateTable
CREATE TABLE "ScheduleItem" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "mode" "ScheduleItemMode" NOT NULL,
    "weekday" INTEGER,
    "date" TIMESTAMP(3),
    "time" TEXT NOT NULL,
    "cards" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleItem_familyId_idx" ON "ScheduleItem"("familyId");

-- CreateIndex
CREATE INDEX "ScheduleItem_familyId_mode_idx" ON "ScheduleItem"("familyId", "mode");

-- CreateIndex
CREATE INDEX "ScheduleItem_familyId_weekday_idx" ON "ScheduleItem"("familyId", "weekday");

-- CreateIndex
CREATE INDEX "ScheduleItem_familyId_date_idx" ON "ScheduleItem"("familyId", "date");

-- AddForeignKey
ALTER TABLE "ScheduleItem" ADD CONSTRAINT "ScheduleItem_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
