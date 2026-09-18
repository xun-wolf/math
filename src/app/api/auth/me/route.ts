import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { env } from "@/lib/env";

export async function GET() {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: { ...u, mustChangePassword: env.isDemo ? false : u.mustChangePassword },
  });
}
