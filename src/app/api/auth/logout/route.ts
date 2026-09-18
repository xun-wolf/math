import { NextResponse } from "next/server";
import { clearSessionCookie, revokeCurrentSession } from "@/lib/session";
import { checkCsrfFromRequest } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!checkCsrfFromRequest(req)) {
    return NextResponse.json({ error: "CSRF 校验失败" }, { status: 403 });
  }
  await revokeCurrentSession();
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
