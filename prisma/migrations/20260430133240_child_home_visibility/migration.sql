-- AlterTable
ALTER TABLE "ChildHomeNode" ADD COLUMN     "isVisible" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "blinkSeconds" SET DEFAULT 10;
