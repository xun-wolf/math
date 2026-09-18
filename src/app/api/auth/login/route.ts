import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, setSessionCookie } from "@/lib/session";
import { checkCsrfFromRequest, issueCsrfToken, setCsrfCookie } from "@/lib/csrf";
import { env } from "@/lib/env";
import { HOME_BY_ROLE, type Role } from "@/lib/types";

const Body = z.object({
  loginName: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  if (!checkCsrfFromRequest(req)) {
    return NextResponse.json({ error: "CSRF 校验失败" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 });
  }
  const { loginName, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { loginName } });

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;

  if (!user) {
    await prisma.loginAudit.create({
      data: { loginName, ok: false, ip, ua, reason: "USER_NOT_FOUND" },
    });
    return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await prisma.loginAudit.create({
      data: { loginName, ok: false, ip, ua, reason: "LOCKED" },
    });
    return NextResponse.json({ error: "账号被临时锁定，请稍后再试" }, { status: 429 });
  }

  const ok = await verifyPassword(password, user.passwordHash);

  if (!ok) {
    const attempts = env.isDemo ? 0 : user.failedAttempts + 1;
    const lock = !env.isDemo && attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: attempts, lockedUntil: lock },
    });
    await prisma.loginAudit.create({
      data: { loginName, ok: false, ip, ua, reason: "BAD_PASSWORD" },
    });
    return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await prisma.loginAudit.create({ data: { loginName, ok: true, ip, ua } });

  const { token, expiresAt } = await createSession({ userId: user.id, userAgent: ua, ip });
  setSessionCookie(token, expiresAt);
  setCsrfCookie(issueCsrfToken());

  const role = user.role as Role;
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      loginName: user.loginName,
      name: user.name,
      role,
      mustChangePassword: env.isDemo ? false : user.mustChangePassword,
    },
    redirectTo: HOME_BY_ROLE[role],
  });
}
