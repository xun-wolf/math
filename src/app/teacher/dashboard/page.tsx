import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, AuthError } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import { createClass } from "@/lib/actions/classes";

export const dynamic = "force-dynamic";

export default async function TeacherDashboard() {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  const classes = await prisma.classRoom.findMany({
    where: { teacherId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { enrollments: true, assignments: true } },
    },
  });

  return (
    <AppShell title="教师工作台">
      <div className="grid md:grid-cols-3 gap-6">
        <section className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">我的班级</h2>
          </div>
          {classes.length === 0 ? (
            <div className="card p-6 text-sm text-gray-500">
              还没有班级，先在右侧新建一个班级。
            </div>
          ) : (
            <ul className="space-y-3">
              {classes.map((c) => (
                <li key={c.id} className="card p-4 flex items-center justify-between">
                  <div>
                    <Link
                      href={`/teacher/classes/${c.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-1">
                      {c._count.enrollments} 名学生 · {c._count.assignments} 次作业
                    </p>
                  </div>
                  <Link href={`/teacher/classes/${c.id}`} className="btn-secondary text-sm">
                    进入
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold mb-3">新建班级</h3>
            <ActionForm action={createClass} submitLabel="创建班级">
              <label className="block text-sm text-gray-600 mb-1">班级名称</label>
              <input
                name="name"
                className="input"
                placeholder="如：初二(5)班"
                required
                maxLength={40}
              />
            </ActionForm>
          </div>
          <div className="card p-5 text-sm">
            <h3 className="font-semibold mb-2">快捷入口</h3>
            <ul className="space-y-1 text-gray-600">
              <li>
                <Link href="/teacher/assignments/new" className="text-brand-500 hover:underline">
                  布置作业
                </Link>
              </li>
              <li>
                <Link href="/teacher/knowledge-points" className="text-brand-500 hover:underline">
                  查看知识点树
                </Link>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
