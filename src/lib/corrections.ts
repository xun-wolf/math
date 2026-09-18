import { prisma } from "./db";
import { getProvider, type CorrectionAdviceInput } from "./ai/provider";

// 教师端订正 / 提问跟踪：按作业聚合本班记录。
// 授权由调用方（页面/Action）用 assertTeacherOwnsAssignment 保证；
// 此处按 assignmentId 过滤，assignment→class.teacherId 链在守卫里校验。

export type CorrectionRow = {
  id: string;
  studentId: string;
  studentName: string;
  questionSeq: number;
  reviewId: string;
  status: string; // PENDING | RESOLVED | STILL_WRONG
  correctedAnswerText: string;
  teacherResolvedNote: string | null;
  updatedAt: Date;
};

export type StudentQuestionRow = {
  id: string;
  studentId: string;
  studentName: string;
  questionSeq: number;
  reviewId: string;
  questionText: string;
  teacherReply: string | null;
  createdAt: Date;
  repliedAt: Date | null;
};

export type CorrectionStats = {
  total: number;
  pending: number;
  resolved: number;
  stillWrong: number;
  resolveRate: number; // RESOLVED / total
};

async function nameMap(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function getAssignmentCorrections(
  assignmentId: string
): Promise<CorrectionRow[]> {
  const rows = await prisma.correction.findMany({
    where: { review: { draft: { assignmentId } } },
    include: { review: { include: { draft: { include: { question: { select: { seq: true } } } } } } },
    orderBy: { updatedAt: "desc" },
  });
  const names = await nameMap(rows.map((r) => r.studentId));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: names.get(r.studentId) ?? "学生",
    questionSeq: r.review.draft.question.seq,
    reviewId: r.publishedReviewId,
    status: r.status,
    correctedAnswerText: r.correctedAnswerText,
    teacherResolvedNote: r.teacherResolvedNote,
    updatedAt: r.updatedAt,
  }));
}

export async function getAssignmentStudentQuestions(
  assignmentId: string
): Promise<StudentQuestionRow[]> {
  const rows = await prisma.studentQuestion.findMany({
    where: { review: { draft: { assignmentId } } },
    include: { review: { include: { draft: { include: { question: { select: { seq: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  const names = await nameMap(rows.map((r) => r.studentId));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.studentId,
    studentName: names.get(r.studentId) ?? "学生",
    questionSeq: r.review.draft.question.seq,
    reviewId: r.publishedReviewId,
    questionText: r.questionText,
    teacherReply: r.teacherReply,
    createdAt: r.createdAt,
    repliedAt: r.repliedAt,
  }));
}

export async function getCorrectionStats(assignmentId: string): Promise<CorrectionStats> {
  const rows = await prisma.correction.findMany({
    where: { review: { draft: { assignmentId } } },
    select: { status: true },
  });
  let pending = 0;
  let resolved = 0;
  let stillWrong = 0;
  for (const r of rows) {
    if (r.status === "RESOLVED") resolved++;
    else if (r.status === "STILL_WRONG") stillWrong++;
    else pending++;
  }
  const total = rows.length;
  return { total, pending, resolved, stillWrong, resolveRate: total === 0 ? 0 : resolved / total };
}

export type AdviceResult =
  | { status: "OK"; advice: string; modelTag: string }
  | { status: "NEEDS_MANUAL"; reason: string };

/**
 * 针对某条订正生成「教师点评建议」。AI 原生约束（PLAN §5.4/§6.3）：
 * - 缺依据（该题无标准答案或 rubric 为空）→ 直接不调 AI，返回 NEEDS_MANUAL；
 * - Provider 抛错（含 MOCK_AI_FAIL / 未接入）→ 捕获后 NEEDS_MANUAL，流程不中断，教师仍可手工填写；
 * - 输入仅去标识化文本（订正内容/题面/批改评语），不含姓名/学号；输出仅回给教师，不直接触达学生。
 */
export async function suggestCorrectionAdvice(correctionId: string): Promise<AdviceResult> {
  const corr = await prisma.correction.findUnique({
    where: { id: correctionId },
    include: {
      review: {
        include: {
          draft: {
            include: { question: { include: { standardAnswer: true } } },
          },
        },
      },
    },
  });
  if (!corr) return { status: "NEEDS_MANUAL", reason: "订正记录不存在" };

  const q = corr.review.draft.question;
  const ans = q.standardAnswer;
  if (!ans || !ans.rubricText.trim()) {
    return {
      status: "NEEDS_MANUAL",
      reason: !ans ? "缺依据：该题尚无标准答案，无法生成点评建议" : "缺依据：评分说明（rubric）为空",
    };
  }

  const sub = corr.submissionId
    ? await prisma.submission.findUnique({
        where: { id: corr.submissionId },
        include: { grading: { select: { verdict: true, teacherNote: true } } },
      })
    : await prisma.submission.findUnique({
        where: { questionId_studentId: { questionId: q.id, studentId: corr.studentId } },
        include: { grading: { select: { verdict: true, teacherNote: true } } },
      });

  const input: CorrectionAdviceInput = {
    questionSeq: q.seq,
    stemText: q.stemText,
    answerText: ans.answerText,
    rubricText: ans.rubricText,
    studentCorrectedText: corr.correctedAnswerText,
    myVerdict: sub?.grading?.verdict ?? null,
    teacherNote: sub?.grading?.teacherNote ?? null,
  };

  try {
    const out = await getProvider().generateCorrectionAdvice(input);
    return { status: "OK", advice: out.advice, modelTag: out.modelTag };
  } catch (e) {
    return {
      status: "NEEDS_MANUAL",
      reason: "AI 建议不可用：" + (e instanceof Error ? e.message : String(e)) + "（教师仍可手工填写复核说明）",
    };
  }
}
