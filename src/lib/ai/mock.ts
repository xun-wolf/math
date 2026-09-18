import { env } from "../env";
import type {
  AIProvider,
  ReviewInput,
  ReviewOutput,
  ErrorCause,
  PracticeSuggestion,
  CorrectionAdviceInput,
  CorrectionAdviceOutput,
} from "./provider";

/**
 * Mock Provider：按题目 difficulty 与关联知识点数走模板拼接，保证输出结构可解析、
 * 有依据字段。首版默认。MOCK_AI_FAIL=true 时抛错，用于演示 §6.3 失败兜底。
 */
export const mockProvider: AIProvider = {
  tag: "mock-v1",
  async generateReviewDraft(input: ReviewInput): Promise<ReviewOutput> {
    if (env.isMockAIFail) {
      throw new Error("MOCK_AI_FAIL=true：模拟模型不可用");
    }

    const kpNames = input.knowledgePoints.map((k) => k.name);
    const primaryKp = kpNames[0] ?? "本题考点";
    const { total, correct, wrong, partial } = input.stats;
    const notMastered = wrong + partial;
    const rate = total ? Math.round((notMastered / total) * 100) : 0;

    const summary =
      `第 ${input.questionSeq} 题（${primaryKp}）主要问题集中在解题步骤与${kpNames[1] ?? primaryKp}的应用上，` +
      `全班 ${total} 人中 ${notMastered} 人未完全掌握（错误率约 ${rate}%）。`;

    // 错因：优先用去标识化的批改备注聚类，退化到难度模板
    const errorCauses: ErrorCause[] = buildErrorCauses(input, wrong, partial);

    const explanation = buildExplanation(input, kpNames);

    const workedExample =
      input.difficulty >= 4
        ? `示范（针对 ${primaryKp}）：\n1. 先明确题目所求，标出已知量；\n2. 按评分说明的「${truncate(input.rubricText, 24)}」分步书写；\n3. 得出 x 的值后代回原式检验。`
        : null;

    const practiceSuggestions: PracticeSuggestion[] = buildPractice(input, kpNames);

    return {
      summary,
      knowledgePointIds: input.knowledgePoints.map((k) => k.id),
      errorCauses,
      explanation,
      workedExample,
      practiceSuggestions,
      modelTag: this.tag,
    };
  },

  async generateCorrectionAdvice(
    input: CorrectionAdviceInput
  ): Promise<CorrectionAdviceOutput> {
    if (env.isMockAIFail) {
      throw new Error("MOCK_AI_FAIL=true：模拟模型不可用");
    }

    const corrected = input.studentCorrectedText.trim();
    const ans = input.answerText.trim();
    // 粗略启发：订正里是否出现了标准答案的关键结果串（不代表正确性，仅辅助提示）
    const mentionsResult = ans.length > 0 && corrected.includes(ans.slice(-6));
    const verdictWord =
      input.myVerdict === "WRONG"
        ? "原判为错误"
        : input.myVerdict === "PARTIAL"
          ? "原判为部分正确"
          : "此前判为正确";

    const lines: string[] = [];
    lines.push(`（AI 点评建议 · 供参考，请教师复核后定稿）`);
    lines.push(`本题${verdictWord}${input.teacherNote ? `，原评语「${truncate(input.teacherNote, 24)}」` : ""}。`);
    lines.push(
      mentionsResult
        ? `订正中出现了与标准答案一致的结果，重点核对解题步骤是否完整、依据评分说明「${truncate(input.rubricText, 20)}」是否满足。`
        : `订正结果未见与标准答案明显吻合，建议再检查关键一步（${truncate(input.rubricText, 24)}）。`
    );
    if (corrected.length < 8) {
      lines.push(`订正内容偏短，可能缺少必要过程，宜提醒补写推导。`);
    }
    return { advice: lines.join("\n"), modelTag: this.tag };
  },
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildErrorCauses(input: ReviewInput, wrong: number, partial: number): ErrorCause[] {
  const notes = input.errorCauseSamples.filter((s) => s.note.trim().length > 0);
  const causes: ErrorCause[] = [];

  if (notes.length) {
    // 把相近备注聚成一条错因（mock 用简单策略：取最常见的一条 + 半对步骤问题）
    const topNote = notes[0].note.trim();
    causes.push({
      cause: `抽样批改备注高频出现：${truncate(topNote, 30)}`,
      count: Math.max(wrong, notes.length),
      evidence: `依据抽样去标识化备注 ${notes.length} 条，例如「${truncate(topNote, 24)}」`,
    });
  } else {
    causes.push({
      cause: `${input.difficulty >= 4 ? "综合步骤" : "基础步骤"}出错`,
      count: wrong,
      evidence: "题目难度较高且缺少备注样本，按模板给出通用错因",
    });
  }

  if (partial > 0) {
    causes.push({
      cause: "过程正确但最终结果或检验缺失",
      count: partial,
      evidence: `${partial} 人被判定为部分正确（PARTIAL）`,
    });
  }

  return causes;
}

function buildExplanation(input: ReviewInput, kpNames: string[]): string {
  const steps: string[] = [];
  steps.push(`审题：本题围绕「${kpNames.join("、") || "本题考点"}」，标准答案为 ${truncate(input.answerText, 30)}。`);
  steps.push(`第一步按评分说明落实：${truncate(input.rubricText, 40)}。`);
  if (input.commonMistakeNote) {
    steps.push(`易错提醒：${truncate(input.commonMistakeNote, 40)}。`);
  }
  steps.push(`最后把结果代回原式检验，确保${input.difficulty >= 4 ? "分类讨论/变形" : "计算"}无遗漏。`);
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

function buildPractice(input: ReviewInput, kpNames: string[]): PracticeSuggestion[] {
  const kp = kpNames[0] ?? "本题考点";
  const out: PracticeSuggestion[] = [
    { text: `针对「${kp}」的一道基础巩固题（同类型，数字调小）`, rationale: "强化本题主要考点的基本步骤" },
  ];
  if (input.difficulty >= 3) {
    out.push({
      text: `结合「${kpNames.slice(0, 2).join("与") || kp}」的一道变式题`,
      rationale: "训练多知识点综合应用，覆盖 PARTIAL 学生的薄弱环节",
    });
  }
  if (input.difficulty >= 4) {
    out.push({ text: `一道与 ${kp} 相关的拓展/实际应用题`, rationale: "面向已掌握学生做拔高" });
  }
  return out;
}
