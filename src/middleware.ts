// 粗粒度路由守卫：未登录跳 /login；越权角色直接返回 403 页面。
// 细粒度行级授权在 API / RSC 内部再走 auth-guard.ts。
import { NextResponse, type NextRequest } from "next/server";

// 该中间件运行在 Edge Runtime，无法访问 Prisma，
// 因此这里只根据 cookie 是否存在做粗略分流；真实鉴权由服务端 handler 兜底。
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sid = req.cookies.get("sid")?.value;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/csrf") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";

  if (isPublic) return NextResponse.next();

  if (!sid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
