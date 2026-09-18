-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loginName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoginAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loginName" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "ip" TEXT,
    "ua" TEXT,
    "reason" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClassRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassRoom_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassEnrollment" (
    "classId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("classId", "studentId"),
    CONSTRAINT "ClassEnrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClassEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "subject" TEXT NOT NULL DEFAULT 'math',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgePoint_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgePoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassRoom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stemText" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "sourceNote" TEXT,
    CONSTRAINT "Question_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionKnowledgePoint" (
    "questionId" TEXT NOT NULL,
    "kpId" TEXT NOT NULL,

    PRIMARY KEY ("questionId", "kpId"),
    CONSTRAINT "QuestionKnowledgePoint_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionKnowledgePoint_kpId_fkey" FOREIGN KEY ("kpId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StandardAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "rubricText" TEXT NOT NULL,
    "commonMistakeNote" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StandardAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Grading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "verdict" TEXT NOT NULL,
    "teacherNote" TEXT,
    "teacherId" TEXT NOT NULL,
    "gradedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Grading_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Grading_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assignmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "knowledgePointId" TEXT,
    "total" INTEGER NOT NULL,
    "wrongCount" INTEGER NOT NULL,
    "partialCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorStat_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorStat_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorStat_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "basedOnQuestionSnapshot" TEXT NOT NULL,
    "basedOnAnswerSnapshot" TEXT,
    "basedOnErrorSummary" TEXT NOT NULL,
    "draftContent" TEXT,
    "modelTag" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewDraft_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewDraft_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewDraftKnowledge" (
    "draftId" TEXT NOT NULL,
    "kpId" TEXT NOT NULL,

    PRIMARY KEY ("draftId", "kpId"),
    CONSTRAINT "ReviewDraftKnowledge_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReviewDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewDraftKnowledge_kpId_fkey" FOREIGN KEY ("kpId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "questionRefText" TEXT NOT NULL,
    "rationale" TEXT,
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PracticeSuggestion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReviewDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishedReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "finalContent" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedReview_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReviewDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishedReview_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedReviewId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "submissionId" TEXT,
    "correctedAnswerText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "teacherResolvedNote" TEXT,
    "resolvedBy" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Correction_publishedReviewId_fkey" FOREIGN KEY ("publishedReviewId") REFERENCES "PublishedReview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Correction_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Correction_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudentQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishedReviewId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "teacherReply" TEXT,
    "repliedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repliedAt" DATETIME,
    CONSTRAINT "StudentQuestion_publishedReviewId_fkey" FOREIGN KEY ("publishedReviewId") REFERENCES "PublishedReview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentQuestion_repliedBy_fkey" FOREIGN KEY ("repliedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_loginName_key" ON "User"("loginName");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAudit_loginName_at_idx" ON "LoginAudit"("loginName", "at");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_code_key" ON "KnowledgePoint"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Question_assignmentId_seq_key" ON "Question"("assignmentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "StandardAnswer_questionId_key" ON "StandardAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_questionId_studentId_key" ON "Submission"("questionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Grading_submissionId_key" ON "Grading"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorStat_questionId_knowledgePointId_key" ON "ErrorStat"("questionId", "knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedReview_draftId_key" ON "PublishedReview"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "Correction_publishedReviewId_studentId_key" ON "Correction"("publishedReviewId", "studentId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
