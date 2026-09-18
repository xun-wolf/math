import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET 至少 32 字符"),
  AI_PROVIDER: z.enum(["mock", "openai", "deepseek"]).default("mock"),
  MOCK_AI_FAIL: z.enum(["true", "false"]).default("false"),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});

const parsed = schema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  AI_PROVIDER: process.env.AI_PROVIDER ?? "mock",
  MOCK_AI_FAIL: process.env.MOCK_AI_FAIL ?? "false",
  DEMO_MODE: process.env.DEMO_MODE ?? "false",
});

if (!parsed.success) {
  throw new Error(
    "环境变量校验失败：" + JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
  );
}

export const env = {
  ...parsed.data,
  isDemo: parsed.data.DEMO_MODE === "true",
  isMockAIFail: parsed.data.MOCK_AI_FAIL === "true",
  isProd: process.env.NODE_ENV === "production",
};

if (env.isProd && env.isDemo) {
  throw new Error("DEMO_MODE=true 时禁止生产构建，请设为 false");
}
