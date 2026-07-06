-- AlterTable: add isReusable flag to Invite (default false, no effect on existing invites)
ALTER TABLE "Invite" ADD COLUMN "isReusable" BOOLEAN NOT NULL DEFAULT false;
