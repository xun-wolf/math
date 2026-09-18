import { prisma } from "./db";

type Counts = { total: number; correct: number; wrong: number; partial: number };

function empty(): Counts {
  return { total: 0, correct: 0, wrong: 0, partial: 0 };
}
function bump(c: Counts, verdict: string) {
  c.total++;
  if (verdict === "CORRECT") c.correct++;
  else if (verdict === "WRONG") c.wrong++;
  else if (verdict === "PARTIAL") c.partial++;
}

/**
 * 依据当前 Grading 重算并落库该作业的 ErrorStat。
 * 每次 CSV 批改导入后调用（PLAN-v2 验收场景 1）。可重复执行（幂等：先删后建）。
 */
export async function recomputeErrorStats(assignmentId: string): Promise<number> {
  const questions = await prisma.question.findMany({
    where: { assignmentId },
    include: {
      knowledge: { select: { kpId: true } },
      submissions: { include: { grading: { select: { verdict: true } } } },
    },
  });

  const rows: {
    assignmentId: string;
    questionId: string;
    knowledgePointId: string | null;
    total: number;
    wrongCount: number;
    partialCount: number;
    correctCount: number;
  }[] = [];

  for (const q of questions) {
    const c = empty();
    for (const s of q.submissions) {
      if (s.grading) bump(c, s.grading.verdict);
    }
    // 题目级（knowledgePointId = null）
    rows.push({
      assignmentId,
      questionId: q.id,
      knowledgePointId: null,
      total: c.total,
      wrongCount: c.wrong,
      partialCount: c.partial,
      correctCount: c.correct,
    });
    // 每个关联知识点一条（同题错误计入其每个知识点）
    for (const k of q.knowledge) {
      rows.push({
        assignmentId,
        questionId: q.id,
        knowledgePointId: k.kpId,
        total: c.total,
        wrongCount: c.wrong,
        partialCount: c.partial,
        correctCount: c.correct,
      });
    }
  }

  await prisma.$transaction([
    prisma.errorStat.deleteMany({ where: { assignmentId } }),
    ...(rows.length
      ? [
          prisma.errorStat.createMany({
            data: rows.map((r) => ({ ...r, updatedAt: new Date() })),
          }),
        ]
      : []),
  ]);
  return rows.length;
}

export type QuestionStat = {
  questionId: string;
  seq: number;
  stemText: string;
  difficulty: number;
  hasAnswer: boolean;
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  errorRate: number; // (wrong+partial)/total
};

export type KpStat = {
  kpId: string;
  code: string;
  name: string;
  total: number;
  notMastered: number; // wrong + partial
  rate: number;
};

/** 读看板数据：直接从 Grading 现算，保证与事实层一致（不依赖 ErrorStat 新鲜度）。 */
export async function getAssignmentStats(assignmentId: string) {
  const questions = await prisma.question.findMany({
    where: { assignmentId },
    orderBy: { seq: "asc" },
    include: {
      standardAnswer: { select: { id: true } },
      knowledge: { include: { kp: { select: { id: true, code: true, name: true } } } },
      submissions: { include: { grading: { select: { verdict: true } } } },
    },
  });

  const byQuestion: QuestionStat[] = [];
  const kpMap = new Map<string, KpStat>();

  for (const q of questions) {
    const c = empty();
    for (const s of q.submissions) if (s.grading) bump(c, s.grading.verdict);
    byQuestion.push({
      questionId: q.id,
      seq: q.seq,
      stemText: q.stemText,
      difficulty: q.difficulty,
      hasAnswer: !!q.standardAnswer,
      total: c.total,
      correct: c.correct,
      wrong: c.wrong,
      partial: c.partial,
      errorRate: c.total ? (c.wrong + c.partial) / c.total : 0,
    });
    for (const k of q.knowledge) {
      const kp = k.kp;
      const cur =
        kpMap.get(kp.id) ??
        { kpId: kp.id, code: kp.code, name: kp.name, total: 0, notMastered: 0, rate: 0 };
      cur.total += c.total;
      cur.notMastered += c.wrong + c.partial;
      kpMap.set(kp.id, cur);
    }
  }

  const byKp = [...kpMap.values()]
    .map((k) => ({ ...k, rate: k.total ? k.notMastered / k.total : 0 }))
    .sort((a, b) => b.rate - a.rate);

  const graded = byQuestion.reduce((s, q) => s + q.total, 0);
  const anyError = byQuestion.some((q) => q.total > 0);

  return { byQuestion, byKp, graded, hasData: anyError };
}
