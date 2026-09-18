import {
  AIProviderError,
  type AIProvider,
  type ReviewInput,
  type ReviewOutput,
  type CorrectionAdviceInput,
  type CorrectionAdviceOutput,
} from "./provider";

/**
 * 预留：接入前必须满足 PLAN-v2 §6.4 安全红线——输入去标识化 + 二次评审。
 * 当前未接线，一律抛 AIProviderError，由上层兜底为 NEEDS_MANUAL，保证流程不中断。
 */
export const openaiProvider: AIProvider = {
  tag: "openai:unconfigured",
  async generateReviewDraft(_input: ReviewInput): Promise<ReviewOutput> {
    throw new AIProviderError(
      "OpenAI Provider 尚未接入（需先完成去标识化与二次评审），请切回 AI_PROVIDER=mock 或走教师手工撰写"
    );
  },
  async generateCorrectionAdvice(_input: CorrectionAdviceInput): Promise<CorrectionAdviceOutput> {
    throw new AIProviderError(
      "OpenAI Provider 尚未接入（需先完成去标识化与二次评审），请切回 AI_PROVIDER=mock 或教师手工填写复核说明"
    );
  },
};
