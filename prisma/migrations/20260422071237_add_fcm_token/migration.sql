-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "fcmToken" TEXT,
ADD COLUMN     "fcmTokenUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "lastPushAt" TIMESTAMP(3);
