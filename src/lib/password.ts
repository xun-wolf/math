import bcrypt from "bcryptjs";

// bcryptjs 是纯 JS 实现；开发/演示用 10（OWASP 底线），生产可提到 12
const BCRYPT_COST = process.env.NODE_ENV === "production" ? 12 : 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

const MIN_LEN = 8;
export function checkPasswordPolicy(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < MIN_LEN) return { ok: false, reason: `密码至少 ${MIN_LEN} 位` };
  if (!/[a-z]/.test(pw)) return { ok: false, reason: "需包含小写字母" };
  if (!/[A-Z]/.test(pw)) return { ok: false, reason: "需包含大写字母" };
  if (!/[0-9]/.test(pw)) return { ok: false, reason: "需包含数字" };
  return { ok: true };
}
