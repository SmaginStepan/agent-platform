-- AlterTable: family "adult mode" PIN hash
ALTER TABLE "Family" ADD COLUMN "adultPinHash" TEXT;

-- AlterTable: per-device temporary elevation token
ALTER TABLE "DeviceUser" ADD COLUMN "elevationTokenHash" TEXT,
ADD COLUMN "elevationExpiresAt" TIMESTAMP(3);
