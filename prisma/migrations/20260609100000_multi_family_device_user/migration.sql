-- CreateTable: DeviceUser join table for multi-family device membership
CREATE TABLE "DeviceUser" (
  "deviceId" TEXT NOT NULL,
  "userId"   TEXT NOT NULL,
  CONSTRAINT "DeviceUser_pkey" PRIMARY KEY ("deviceId", "userId")
);

-- Migrate existing Device.userId data into DeviceUser
INSERT INTO "DeviceUser" ("deviceId", "userId")
SELECT "deviceId", "userId" FROM "Device" WHERE "userId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "DeviceUser" ADD CONSTRAINT "DeviceUser_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("deviceId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeviceUser" ADD CONSTRAINT "DeviceUser_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DeviceUser_userId_idx" ON "DeviceUser"("userId");

-- DropIndex
DROP INDEX IF EXISTS "Device_userId_idx";
DROP INDEX IF EXISTS "Device_userId_createdAt_idx";

-- AlterTable: drop the now-redundant userId column from Device
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_userId_fkey";
ALTER TABLE "Device" DROP COLUMN "userId";
