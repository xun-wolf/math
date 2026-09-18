import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "@/lib/password";
import { getSessionUser, setSessionCookie, createSession, revokeAllSessionsFor } from "@/lib/session";
import { checkCsrfFromRequest } from "@/lib/csrf";

const Body = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  if (!checkCsrfFromRequest(req)) {
    return NextResponse.json({ error: "CSRF 校验失败" }, { status: 403 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { oldPassword, newPassword } = parsed.data;

  const policy = checkPasswordPolicy(newPassword);
  if (!policy.ok) return NextResponse.json({ error: policy.reason }, { status: 400 });

  const db = await prisma.user.findUnique({ where: { id: user.id } });
  if (!db) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  if (!(await verifyPassword(oldPassword, db.passwordHash))) {
    return NextResponse.json({ error: "原密码不正确" }, { status: 401 });
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: db.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await prisma.auditLog.create({
    data: { actorId: db.id, action: "PASSWORD_CHANGE", entity: "User", entityId: db.id },
  });

  // 撤销所有其他会话；为当前请求签一个新 token
  await revokeAllSessionsFor(db.id);
  const ua = req.headers.get("user-agent") ?? undefined;
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const { token, expiresAt } = await createSession({ userId: db.id, userAgent: ua, ip });
  setSessionCookie(token, expiresAt);

  return NextResponse.json({ ok: true });
}
