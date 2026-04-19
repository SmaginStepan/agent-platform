/*
  Warnings:

  - You are about to drop the column `avatarUrl` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "avatarUrl",
ADD COLUMN     "avatarItemId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarItemId_fkey" FOREIGN KEY ("avatarItemId") REFERENCES "FamilyLibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
