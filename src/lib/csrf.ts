import { cookies } from "next/headers";
import crypto from "node:crypto";
import { env } from "./env";

const CSRF_COOKIE = "csrf";

function sign(payload: string): string {
  return crypto.createHmac("sha256", env.SESSION_SECRET).update(payload).digest("hex");
}

export function issueCsrfToken(): string {
  const raw = crypto.randomBytes(16).toString("hex");
  const sig = sign(raw);
  return `${raw}.${sig}`;
}

export function verifyCsrfToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [raw, sig] = token.split(".");
  if (!raw || !sig) return false;
  const expect = sign(raw);
  if (expect.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig));
}

export function setCsrfCookie(token: string) {
  cookies().set(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

/**
 * 双提交 cookie 校验：cookie 与请求头/x-csrf-token 必须一致且签名有效。
 */
export function checkCsrfFromRequest(req: Request): boolean {
  const cookie = cookies().get(CSRF_COOKIE)?.value;
  const header = req.headers.get("x-csrf-token");
  if (!cookie || !header) return false;
  if (cookie !== header) return false;
  return verifyCsrfToken(cookie);
}

export const CSRF_COOKIE_NAME = CSRF_COOKIE;
