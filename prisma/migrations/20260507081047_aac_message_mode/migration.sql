-- CreateEnum
CREATE TYPE "AacMessageMode" AS ENUM ('NORMAL', 'SEQUENCE');

-- AlterTable
ALTER TABLE "AacMessage" ADD COLUMN     "mode" "AacMessageMode" NOT NULL DEFAULT 'NORMAL';
