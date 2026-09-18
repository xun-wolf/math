/*
  Warnings:

  - You are about to drop the column `draftContent` on the `ReviewDraft` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "ReviewDraftVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "versionNum" INTEGER NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewDraftVersion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReviewDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReviewDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'AI',
    "modelTag" TEXT,
    "aiFailReason" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "errorCauses" TEXT,
    "explanation" TEXT,
    "workedExample" TEXT,
    "basedOnQuestionSnapshot" TEXT NOT NULL,
    "basedOnAnswerSnapshot" TEXT,
    "basedOnErrorSummary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewDraft_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewDraft_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReviewDraft" ("assignmentId", "basedOnAnswerSnapshot", "basedOnErrorSummary", "basedOnQuestionSnapshot", "createdAt", "id", "modelTag", "questionId", "status", "updatedAt") SELECT "assignmentId", "basedOnAnswerSnapshot", "basedOnErrorSummary", "basedOnQuestionSnapshot", "createdAt", "id", "modelTag", "questionId", "status", "updatedAt" FROM "ReviewDraft";
DROP TABLE "ReviewDraft";
ALTER TABLE "new_ReviewDraft" RENAME TO "ReviewDraft";
CREATE INDEX "ReviewDraft_assignmentId_status_idx" ON "ReviewDraft"("assignmentId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ReviewDraftVersion_draftId_idx" ON "ReviewDraftVersion"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDraftVersion_draftId_versionNum_key" ON "ReviewDraftVersion"("draftId", "versionNum");
