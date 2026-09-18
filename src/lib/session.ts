import { cookies } from "next/headers";
import crypto from "node:crypto";
import { prisma } from "./db";
import { env } from "./env";

const COOKIE_NAME = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  loginName: string;
  name: string;
  role: "TEACHER" | "STUDENT" | "RESEARCHER";
  mustChangePassword: boolean;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(opts: {
  userId: string;
  userAgent?: string;
  ip?: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash,
      userAgent: opts.userAgent,
      ip: opts.ip,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export function setSessionCookie(token: string, expiresAt: Date) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function readSessionToken(): Promise<string | null> {
  return cookies().get(COOKIE_NAME)?.value ?? null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  const u = session.user;
  return {
    id: u.id,
    loginName: u.loginName,
    name: u.name,
    role: u.role as SessionUser["role"],
    mustChangePassword: env.isDemo ? false : u.mustChangePassword,
  };
}

export async function revokeCurrentSession(): Promise<void> {
  const token = await readSessionToken();
  if (!token) return;
  const tokenHash = hashToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessionsFor(userId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
