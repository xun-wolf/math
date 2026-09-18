import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyCsrfToken } from "@/lib/csrf";
import { getSessionUser } from "@/lib/session";
import { env } from "@/lib/env";
import LoginForm from "./LoginForm";

export const metadata = { title: "登录 · 数学作业讲评助手" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const existing = await getSessionUser();
  if (existing) redirect("/");

  const cookieVal = cookies().get("csrf")?.value;
  const initialCsrf = cookieVal && verifyCsrfToken(cookieVal) ? cookieVal : "";

  const quickAccounts = env.isDemo
    ? [
        { loginName: "teacher01", label: "张老师（教师）" },
        { loginName: "teacher02", label: "李老师（教师 2）" },
        { loginName: "student03", label: "学生 3 号" },
        { loginName: "student17", label: "学生 17 号" },
        { loginName: "researcher01", label: "教研负责人" },
      ]
    : [];

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-xl font-bold mb-1">数学作业讲评助手</h1>
        <p className="text-sm text-gray-500 mb-6">初中数学 · AI 原生的讲评与订正闭环</p>
        <LoginForm csrfToken={initialCsrf} quickAccounts={quickAccounts} next={searchParams?.next} />
      </div>
    </main>
  );
}
