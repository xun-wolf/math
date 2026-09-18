import { prisma } from "./db";
import { getProvider, type ReviewInput } from "./ai/provider";

export type GenerateResult = {
  draftId: string;
  status: "DRAFT" | "NEEDS_MANUAL";
  reason?: string;
};

/**
 * 为一道题生成（或重新生成）AI 讲评草稿。
 *
 * 关键安全约束（PLAN-v2 §5.4 / §6.3）：
 * 1. 前置校验：缺 StandardAnswer 或 rubricText 为空 → 直接置 NEEDS_MANUAL，绝不调用 AI；
 * 2. AI 任何异常 → 捕获后置 NEEDS_MANUAL，记录失败原因，流程不中断；
 * 3. 生成结果只落 ReviewDraft（教师侧），学生无读路径；发布在 M5。
 */
export async function generateDraftForQuestion(
  questionId: string,
  actorUserId: string
): Promise<GenerateResult> {
  const question = await prisma.question.findUniqueOrThrow({
    where: { id: questionId },
    include: {
      standardAnswer: true,
      knowledge: { include: { kp: { select: { id: true, code: true, name: true } } } },
      submissions: { include: { grading: { select: { verdict: true, teacherNote: true } } } },
    },
  });

  const kps = question.knowledge.map((k) => k.kp);

  const stats = { total: 0, correct: 0, wrong: 0, partial: 0 };
  const errorCauseSamples: { note: string; verdict: string }[] = [];
  for (const s of question.submissions) {
    const g = s.grading;
    if (!g) continue;
    stats.total++;
    if (g.verdict === "CORRECT") stats.correct++;
    else if (g.verdict === "WRONG") stats.wrong++;
    else if (g.verdict === "PARTIAL") stats.partial++;
    if (g.verdict !== "CORRECT" && g.teacherNote && g.teacherNote.trim()) {
      errorCauseSamples.push({ note: g.teacherNote.trim(), verdict: g.verdict });
    }
  }

  const errorSummary = `错 ${stats.wrong} / 半对 ${stats.partial} / 对 ${stats.correct} / 已批改 ${stats.total}`;

  const basedOnQuestionSnapshot = JSON.stringify({
    seq: question.seq,
    stemText: question.stemText,
    difficulty: question.difficulty,
    knowledgePoints: kps.map((k) => `${k.code} ${k.name}`),
  });
  const ans = question.standardAnswer;
  const basedOnAnswerSnapshot = ans
    ? JSON.stringify({
        answerText: ans.answerText,
        rubricText: ans.rubricText,
        commonMistakeNote: ans.commonMistakeNote,
      })
    : null;

  // 复用未发布的最新草稿做「重新生成」；已发布或无草稿则新建
  const latest = await prisma.reviewDraft.findFirst({
    where: { questionId },
    orderBy: { createdAt: "desc" },
  });
  const reuse = latest && latest.status !== "PUBLISHED" ? latest : null;

  // ── 前置校验：缺依据直接 NEEDS_MANUAL，不调 AI ──────────────
  if (!ans || !ans.rubricText.trim()) {
    const reason = !ans ? "缺依据：该题尚无标准答案" : "缺依据：评分说明（rubric）为空";
    const draft = await upsertDraft(reuse, question.id, question.assignmentId, {
      status: "NEEDS_MANUAL",
      source: reuse?.source ?? "AI",
      modelTag: null,
      aiFailReason: reason,
      summary: null,
      errorCauses: null,
      explanation: null,
      workedExample: null,
      basedOnQuestionSnapshot,
      basedOnAnswerSnapshot,
      basedOnErrorSummary: errorSummary,
    });
    return { draftId: draft.id, status: "NEEDS_MANUAL", reason };
  }

  // ── 调用 Provider，失败兜底 ────────────────────────────────
  const input: ReviewInput = {
    questionSeq: question.seq,
    stemText: question.stemText,
    difficulty: question.difficulty,
    answerText: ans.answerText,
    rubricText: ans.rubricText,
    commonMistakeNote: ans.commonMistakeNote,
    knowledgePoints: kps,
    errorSummary,
    stats,
    errorCauseSamples,
  };

  let output;
  try {
    output = await getProvider().generateReviewDraft(input);
  } catch (e) {
    const reason = "AI 生成失败：" + (e instanceof Error ? e.message : String(e));
    const draft = await upsertDraft(reuse, question.id, question.assignmentId, {
      status: "NEEDS_MANUAL",
      source: reuse?.source ?? "AI",
      modelTag: null,
      aiFailReason: reason,
      summary: reuse?.summary ?? null,
      errorCauses: reuse?.errorCauses ?? null,
      explanation: reuse?.explanation ?? null,
      workedExample: reuse?.workedExample ?? null,
      basedOnQuestionSnapshot,
      basedOnAnswerSnapshot,
      basedOnErrorSummary: errorSummary,
    });
    return { draftId: draft.id, status: "NEEDS_MANUAL", reason };
  }

  // 只保留输入里确实存在的知识点 id，防 AI 幻觉引用
  const validKpIds = new Set(kps.map((k) => k.id));
  const kpIds = output.knowledgePointIds.filter((id) => validKpIds.has(id));

  const draft = await upsertDraft(reuse, question.id, question.assignmentId, {
    status: "DRAFT",
    source: "AI",
    modelTag: output.modelTag,
    aiFailReason: null,
    summary: output.summary,
    errorCauses: JSON.stringify(output.errorCauses),
    explanation: output.explanation,
    workedExample: output.workedExample,
    basedOnQuestionSnapshot,
    basedOnAnswerSnapshot,
    basedOnErrorSummary: errorSummary,
  });

  await prisma.$transaction([
    prisma.reviewDraftKnowledge.deleteMany({ where: { draftId: draft.id } }),
    prisma.practiceSuggestion.deleteMany({ where: { draftId: draft.id } }),
    ...kpIds.map((kpId) =>
      prisma.reviewDraftKnowledge.create({ data: { draftId: draft.id, kpId } })
    ),
    ...output.practiceSuggestions.map((p) =>
      prisma.practiceSuggestion.create({
        data: { draftId: draft.id, questionRefText: p.text, rationale: p.rationale },
      })
    ),
  ]);

  // 留一个版本快照（M8 版本历史复用；重新生成时也追加）
  const versionNum = draft.currentVersion;
  await prisma.reviewDraftVersion.create({
    data: {
      draftId: draft.id,
      versionNum,
      changeType: reuse ? "REGENERATED" : "AI_GENERATED",
      createdBy: actorUserId,
      contentSnapshot: JSON.stringify({
        summary: output.summary,
        errorCauses: output.errorCauses,
        explanation: output.explanation,
        workedExample: output.workedExample,
        knowledgePointIds: kpIds,
        practiceSuggestions: output.practiceSuggestions,
      }),
    },
  });

  return { draftId: draft.id, status: "DRAFT" };
}

type DraftScalars = {
  status: "DRAFT" | "NEEDS_MANUAL";
  source: string;
  modelTag: string | null;
  aiFailReason: string | null;
  summary: string | null;
  errorCauses: string | null;
  explanation: string | null;
  workedExample: string | null;
  basedOnQuestionSnapshot: string;
  basedOnAnswerSnapshot: string | null;
  basedOnErrorSummary: string;
};

async function upsertDraft(
  reuse: { id: string; currentVersion: number } | null,
  questionId: string,
  assignmentId: string,
  data: DraftScalars
) {
  const payload = {
    ...data,
    updatedAt: new Date(),
  };
  if (reuse) {
    return prisma.reviewDraft.update({
      where: { id: reuse.id },
      data: { ...payload, currentVersion: reuse.currentVersion + 1 },
    });
  }
  return prisma.reviewDraft.create({
    data: { ...payload, questionId, assignmentId, currentVersion: 1 },
  });
}
