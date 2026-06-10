-- AlterTable: add timezone column to Family with UTC default
ALTER TABLE "Family" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
