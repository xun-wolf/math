import { prisma } from "./db";
import { AuthError } from "./auth-guard";

// 学生端取数：只查 PublishedReview，绝不暴露 ReviewDraft。
// studentId 一律由会话（服务端）传入，URL 参数只作过滤不作授权。
// 越权 / 未发布 / 非本人班级 / 无本人答题记录 → 统一 404，防枚举。

export type MyReviewItem = {
  reviewId: string;
  assignmentId: string;
  assignmentTitle: string;
  questionSeq: number;
  stemText: string;
  finalContent: string;
  publishedAt: Date;
  myVerdict: string | null; // CORRECT | WRONG | PARTIAL
  correctionStatus: string | null; // PENDING | RESOLVED | STILL_WRONG | null(未提交订正)
};

/** 学生"我的讲评"列表：本人所在班级已发布、且本人有该题答题记录的讲评。 */
export async function getMyReviews(studentId: string): Promise<MyReviewItem[]> {
  const enrollments = await prisma.classEnrollment.findMany({
    where: { studentId },
    select: { classId: true },
  });
  const classIds = enrollments.map((e) => e.classId);
  if (classIds.length === 0) return [];

  const reviews = await prisma.publishedReview.findMany({
    where: { classId: { in: classIds } },
    include: {
      draft: {
        include: {
          question: { select: { id: true, seq: true, stemText: true } },
          assignment: { select: { id: true, title: true } },
        },
      },
      corrections: { where: { studentId }, select: { status: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  const questionIds = reviews.map((r) => r.draft.questionId);
  // 仅保留本人有答题记录的题：防止把未作答/非本人相关的讲评泄漏给学生
  const mySubs = await prisma.submission.findMany({
    where: { studentId, questionId: { in: questionIds } },
    include: { grading: { select: { verdict: true } } },
  });
  const subByQuestion = new Map(mySubs.map((s) => [s.questionId, s]));

  const items: MyReviewItem[] = [];
  for (const r of reviews) {
    const sub = subByQuestion.get(r.draft.questionId);
    if (!sub) continue; // 无本人答题记录 → 不展示
    items.push({
      reviewId: r.id,
      assignmentId: r.draft.assignment.id,
      assignmentTitle: r.draft.assignment.title,
      questionSeq: r.draft.question.seq,
      stemText: r.draft.question.stemText,
      finalContent: r.finalContent,
      publishedAt: r.publishedAt,
      myVerdict: sub.grading?.verdict ?? null,
      correctionStatus: r.corrections[0]?.status ?? null,
    });
  }
  return items;
}

export type MyReviewDetail = {
  reviewId: string;
  assignmentTitle: string;
  questionSeq: number;
  stemText: string;
  finalContent: string;
  publishedAt: Date;
  myVerdict: string | null;
  myAnswerText: string | null;
  teacherNote: string | null;
  correction: { correctedAnswerText: string; status: string } | null;
  questions: { id: string; questionText: string; teacherReply: string | null; createdAt: Date }[];
};

/** 授权：学生可对该讲评提交订正/提问吗？须在本班、且有本人答题记录。返回题目 id。 */
export async function assertStudentCanAct(
  studentId: string,
  reviewId: string
): Promise<{ questionId: string }> {
  const review = await prisma.publishedReview.findUnique({
    where: { id: reviewId },
    include: { draft: { select: { questionId: true } } },
  });
  if (!review) throw new AuthError(404, "讲评不存在或无权访问");
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { classId_studentId: { classId: review.classId, studentId } },
  });
  if (!enrolled) throw new AuthError(404, "讲评不存在或无权访问");
  const sub = await prisma.submission.findUnique({
    where: { questionId_studentId: { questionId: review.draft.questionId, studentId } },
    select: { id: true },
  });
  if (!sub) throw new AuthError(404, "讲评不存在或无权访问");
  return { questionId: review.draft.questionId };
}

/** 学生查看单条讲评详情；越权 / 无本人答题记录 → 404。 */
export async function getMyReviewDetail(
  studentId: string,
  reviewId: string
): Promise<MyReviewDetail> {
  const review = await prisma.publishedReview.findUnique({
    where: { id: reviewId },
    include: {
      draft: {
        include: {
          question: { select: { id: true, seq: true, stemText: true } },
          assignment: { select: { title: true } },
        },
      },
      corrections: { where: { studentId } },
      questions: {
        where: { studentId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          questionText: true,
          teacherReply: true,
          createdAt: true,
        },
      },
    },
  });
  if (!review) throw new AuthError(404, "讲评不存在或无权访问");

  // 授权：本人必须在该讲评发布到的班级
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { classId_studentId: { classId: review.classId, studentId } },
  });
  if (!enrolled) throw new AuthError(404, "讲评不存在或无权访问");

  // 本人须有该题答题记录
  const sub = await prisma.submission.findUnique({
    where: { questionId_studentId: { questionId: review.draft.questionId, studentId } },
    include: { grading: { select: { verdict: true, teacherNote: true } } },
  });
  if (!sub) throw new AuthError(404, "讲评不存在或无权访问");

  const c = review.corrections[0] ?? null;
  return {
    reviewId: review.id,
    assignmentTitle: review.draft.assignment.title,
    questionSeq: review.draft.question.seq,
    stemText: review.draft.question.stemText,
    finalContent: review.finalContent,
    publishedAt: review.publishedAt,
    myVerdict: sub.grading?.verdict ?? null,
    myAnswerText: sub.answerText,
    teacherNote: sub.grading?.teacherNote ?? null,
    correction: c ? { correctedAnswerText: c.correctedAnswerText, status: c.status } : null,
    questions: review.questions,
  };
}
