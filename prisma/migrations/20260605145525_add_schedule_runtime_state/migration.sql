-- CreateTable
CREATE TABLE "ScheduleRuntimeState" (
    "familyId" TEXT NOT NULL,
    "activeScheduleItemId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRuntimeState_pkey" PRIMARY KEY ("familyId")
);

-- AddForeignKey
ALTER TABLE "ScheduleRuntimeState" ADD CONSTRAINT "ScheduleRuntimeState_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
