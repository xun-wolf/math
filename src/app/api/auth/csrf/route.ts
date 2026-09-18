import { NextResponse } from "next/server";
import { issueCsrfToken, setCsrfCookie, verifyCsrfToken } from "@/lib/csrf";
import { cookies } from "next/headers";

export async function GET() {
  const existing = cookies().get("csrf")?.value;
  if (existing && verifyCsrfToken(existing)) {
    return NextResponse.json({ token: existing });
  }
  const token = issueCsrfToken();
  setCsrfCookie(token);
  return NextResponse.json({ token });
}
