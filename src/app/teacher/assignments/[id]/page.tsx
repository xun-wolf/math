import { redirect } from "next/navigation";
import Link from "next/link";
import {
  requireRole,
  assertTeacherOwnsAssignment,
  AuthError,
} from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import {
  addQuestion,
  deleteQuestion,
  toggleAssignmentStatus,
} from "@/lib/actions/assignments";

export const dynamic = "force-dynamic";

export default async function AssignmentDetail({ params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let assignment;
  try {
    assignment = await assertTeacherOwnsAssignment(user, params.id);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }

  const questions = await prisma.question.findMany({
    where: { assignmentId: assignment.id },
    orderBy: { seq: "asc" },
    include: {
      standardAnswer: { select: { id: true } },
      _count: { select: { knowledge: true, submissions: true } },
    },
  });

  const addForm = addQuestion.bind(null, assignment.id);
  const toggleForm = toggleAssignmentStatus.bind(null, assignment.id);

  return (
    <AppShell title="作业详情">
      <div className="card p-5 mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{assignment.title}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {assignment.class.name} · {questions.length} 道题
            {assignment.dueDate && (
              <> · 截止 {assignment.dueDate.toISOString().slice(0, 10)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              "text-xs px-2 py-1 rounded " +
              (assignment.status === "OPEN"
                ? "bg-green-100 text-green-700"
                : "bg-gray-200 text-gray-600")
            }
          >
            {assignment.status === "OPEN" ? "进行中" : "已截止"}
          </span>
          <ActionForm
            action={toggleForm}
            submitLabel={assignment.status === "OPEN" ? "截止作业" : "重新开放"}
            className="inline-block"
          >
            <span className="sr-only">切换作业状态</span>
          </ActionForm>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Link href={`/teacher/assignments/${assignment.id}/import-submissions`} className="btn-secondary">
          导入答题
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/import-grading`} className="btn-secondary">
          导入批改
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/stats`} className="btn-secondary">
          统计看板
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/drafts`} className="btn-secondary">
          讲评草稿
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/corrections`} className="btn-secondary">
          订正跟踪
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <section className="md:col-span-2 space-y-3">
          <h3 className="font-semibold">题目列表</h3>
          {questions.length === 0 ? (
            <p className="text-sm text-gray-500">还没有题目，请在右侧添加。</p>
          ) : (
            <ul className="space-y-2">
              {questions.map((q) => (
                <li key={q.id} className="card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/teacher/assignments/${assignment.id}/questions/${q.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      第 {q.seq} 题
                    </Link>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{q.stemText}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Tag ok={!!q.standardAnswer} label="标准答案" />
                      <Tag ok={q._count.knowledge > 0} label={`知识点 ${q._count.knowledge}`} />
                      <Tag ok={q._count.submissions > 0} label={`作答 ${q._count.submissions}`} neutral />
                      <span className="text-xs text-gray-400">难度 {q.difficulty}/5</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/teacher/assignments/${assignment.id}/questions/${q.id}`}
                      className="btn-secondary text-xs"
                    >
                      编辑
                    </Link>
                    <ActionForm
                      action={deleteQuestion.bind(null, q.id)}
                      submitLabel="删除"
                      className="inline-block"
                    >
                      <span className="sr-only">删除第 {q.seq} 题</span>
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <div className="card p-5">
            <h3 className="font-semibold mb-3">添加题目</h3>
            <ActionForm action={addForm} submitLabel="添加题目">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">题干 *</label>
                  <textarea name="stemText" className="input" rows={3} required placeholder="如：解方程 2x + 3 = 7" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">序号</label>
                    <input name="seq" type="number" min={1} className="input" placeholder="留空=自动" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">难度(1-5)</label>
                    <input name="difficulty" type="number" min={1} max={5} className="input" placeholder="3" />
                  </div>
                </div>
              </div>
            </ActionForm>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function Tag({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  const cls = neutral
    ? "bg-gray-100 text-gray-600"
    : ok
    ? "bg-green-100 text-green-700"
    : "bg-amber-100 text-amber-700";
  return <span className={"text-xs px-1.5 py-0.5 rounded " + cls}>{label}</span>;
}
