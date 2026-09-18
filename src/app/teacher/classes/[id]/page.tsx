import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, assertTeacherOwnsClass, AuthError } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import { addStudentToClass, removeStudentFromClass } from "@/lib/actions/classes";

export const dynamic = "force-dynamic";

export default async function ClassDetail({ params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let klass;
  try {
    klass = await assertTeacherOwnsClass(user, params.id);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }

  const [enrollments, assignments] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId: klass.id },
      orderBy: { joinedAt: "asc" },
      include: { student: { select: { id: true, name: true, loginName: true } } },
    }),
    prisma.assignment.findMany({
      where: { classId: klass.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { questions: true } } },
    }),
  ]);

  const addForm = addStudentToClass.bind(null, klass.id);
  const removeForm = removeStudentFromClass.bind(null, klass.id);

  return (
    <AppShell title={klass.name}>
      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">学生名单（{enrollments.length}）</h2>
          <div className="card p-5">
            <ActionForm action={addForm} submitLabel="添加学生">
              <label className="block text-sm text-gray-600 mb-1">学生登录名</label>
              <input
                name="loginName"
                className="input"
                placeholder="如：student06"
                required
              />
              <p className="text-xs text-gray-400 mt-1">演示库中有 student01–student45</p>
            </ActionForm>
          </div>
          {enrollments.length === 0 ? (
            <p className="text-sm text-gray-500">本班暂无学生。</p>
          ) : (
            <ul className="card divide-y divide-gray-100">
              {enrollments.map((e) => (
                <li key={e.student.id} className="p-3 flex items-center justify-between">
                  <span className="text-sm">
                    {e.student.name}
                    <span className="text-gray-400 ml-2">{e.student.loginName}</span>
                  </span>
                  <ActionForm
                    action={removeForm}
                    submitLabel="移出"
                    className="inline-block"
                  >
                    <input type="hidden" name="studentId" value={e.student.id} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">作业（{assignments.length}）</h2>
            <Link
              href={`/teacher/assignments/new?classId=${klass.id}`}
              className="btn-primary text-sm"
            >
              新建作业
            </Link>
          </div>
          {assignments.length === 0 ? (
            <p className="text-sm text-gray-500">还没有作业。</p>
          ) : (
            <ul className="space-y-3">
              {assignments.map((a) => (
                <li key={a.id} className="card p-4">
                  <Link
                    href={`/teacher/assignments/${a.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {a.title}
                  </Link>
                  <p className="text-xs text-gray-500 mt-1">
                    {a._count.questions} 道题 · {a.status === "OPEN" ? "进行中" : "已截止"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
