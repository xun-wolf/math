import { z } from "zod";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  data?: string; // 供 UI 回填的负载（如 AI 点评建议），非状态提示
};

export const INITIAL_STATE: ActionState = {};

function isNextRedirect(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest?: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function firstZodMessage(err: z.ZodError): string {
  // 优先取具体字段错误；裸字符串 schema 的错误落在 issues 根路径，取首条 message
  const flat = err.flatten().fieldErrors;
  const field = Object.values(flat).flat()[0];
  if (field) return field;
  return err.issues[0]?.message ?? "输入不合法";
}

function toMessage(err: unknown): string {
  if (err instanceof z.ZodError) return firstZodMessage(err);
  if (err instanceof Error) return err.message;
  return "操作失败，请重试";
}

/**
 * 统一包裹 Server Action：越权/校验失败返回可读信息，
 * Next 的 redirect 信号原样抛出，其余异常兜底。
 * fn 可返回 string（成功提示）或 { message?, data? }（透传到对应字段）。
 */
export async function runAction(
  fn: () => Promise<void | string | { message?: string; data?: string }>
): Promise<ActionState> {
  try {
    const r = await fn();
    if (typeof r === "string") return r ? { ok: true, message: r } : { ok: true };
    if (r && typeof r === "object") return { ok: true, ...r };
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { error: toMessage(e) };
  }
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function num(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}
