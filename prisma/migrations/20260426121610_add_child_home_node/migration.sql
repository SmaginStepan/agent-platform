-- CreateTable
CREATE TABLE "ChildHomeNode" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "targetMode" TEXT NOT NULL DEFAULT 'ALL_PARENTS',
    "blinkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "blinkSeconds" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildHomeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildHomeNodeTarget" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ChildHomeNodeTarget_pkey" PRIMARY KEY ("id")
);
