import { requireUser } from "@/lib/auth-guard";
import LogoutButton from "@/components/LogoutButton";
import Nav from "@/components/Nav";

export default async function AppShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="font-bold">{title}</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">
              {user.name} · {user.role === "TEACHER" ? "教师" : user.role === "STUDENT" ? "学生" : "教研"}
            </span>
            <a href="/account/change-password" className="text-brand-500 hover:underline">
              修改密码
            </a>
            <LogoutButton />
          </div>
        </div>
        <Nav role={user.role} />
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
