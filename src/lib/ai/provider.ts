import { env } from "../env";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import { deepseekProvider } from "./deepseek";

/** 喂给 AI 的严格输入（PLAN-v2 §5.4）。全部来自事实层，学生身份数据已去标识化为「抽样备注」。 */
export type ReviewInput = {
  questionSeq: number;
  stemText: string;
  difficulty: number;
  answerText: string;
  rubricText: string;
  commonMistakeNote: string | null;
  knowledgePoints: { id: string; code: string; name: string }[];
  errorSummary: string;
  stats: { total: number; correct: number; wrong: number; partial: number };
  // 已去标识化的批改备注样本（不含量名/真实姓名），用于错因归因
  errorCauseSamples: { note: string; verdict: string }[];
};

/** AI 输出的结构化候选，与 ReviewDraft 字段一一对应。 */
export type ErrorCause = { cause: string; count: number; evidence: string };
export type PracticeSuggestion = { text: string; rationale: string };

export type ReviewOutput = {
  summary: string;
  knowledgePointIds: string[]; // 引用输入里的 kp id
  errorCauses: ErrorCause[];
  explanation: string;
  workedExample: string | null;
  practiceSuggestions: PracticeSuggestion[];
  modelTag: string;
};

/** 订正点评建议输入：面向单个学生的订正，供教师复核时参考（教师仍需人工定稿）。 */
export type CorrectionAdviceInput = {
  questionSeq: number;
  stemText: string;
  answerText: string;
  rubricText: string;
  studentCorrectedText: string; // 去标识化（无姓名/学号）的学生订正
  myVerdict: string | null; // 原批改结论 CORRECT|WRONG|PARTIAL
  teacherNote: string | null; // 原批改评语
};

export type CorrectionAdviceOutput = {
  advice: string;
  modelTag: string;
};

/** Provider 抛这个错，上层统一捕获后置 NEEDS_MANUAL。 */
export class AIProviderError extends Error {
  readonly raw?: string;
  constructor(message: string, raw?: string) {
    super(message);
    this.name = "AIProviderError";
    this.raw = raw;
  }
}

export interface AIProvider {
  readonly tag: string;
  generateReviewDraft(input: ReviewInput): Promise<ReviewOutput>;
  generateCorrectionAdvice(input: CorrectionAdviceInput): Promise<CorrectionAdviceOutput>;
}

/**
 * 按 AI_PROVIDER 环境变量切换。默认 mock（不外发任何数据）。
 * openai / deepseek 为预留占位，真实接入前必须过 §6.4 去标识化二次评审。
 */
export function getProvider(): AIProvider {
  switch (env.AI_PROVIDER) {
    case "openai":
      return openaiProvider;
    case "deepseek":
      return deepseekProvider;
    case "mock":
    default:
      return mockProvider;
  }
}
