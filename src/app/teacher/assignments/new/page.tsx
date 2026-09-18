import { redirect } from "next/navigation";
import { requireRole, AuthError } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import { createAssignment } from "@/lib/actions/assignments";

export const dynamic = "force-dynamic";

export default async function NewAssignment({
  searchParams,
}: {
  searchParams: { classId?: string };
}) {
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
    select: { id: true, name: true },
  });

  if (classes.length === 0) {
    return (
      <AppShell title="布置作业">
        <div className="card p-6 text-sm text-gray-600">
          你还没有班级，请先在
          <a href="/teacher/dashboard" className="text-brand-500 hover:underline mx-1">
            工作台
          </a>
          新建班级。
        </div>
      </AppShell>
    );
  }

  const preset = searchParams.classId && classes.some((c) => c.id === searchParams.classId)
    ? searchParams.classId
    : classes[0].id;

  return (
    <AppShell title="布置作业">
      <div className="max-w-lg">
        <div className="card p-6">
          <h2 className="font-semibold mb-4">新建作业</h2>
          <ActionForm action={createAssignment} submitLabel="创建作业">
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">所属班级 *</label>
                <select name="classId" className="input" defaultValue={preset}>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">作业标题 *</label>
                <input
                  name="title"
                  className="input"
                  placeholder="如：一元一次方程 · 课后练习 3"
                  required
                  maxLength={60}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">截止日期</label>
                <input name="dueDate" type="date" className="input" />
              </div>
            </div>
          </ActionForm>
        </div>
      </div>
    </AppShell>
  );
}
