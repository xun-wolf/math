import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, assertTeacherOwnsAssignment, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import { writeAudit } from "@/lib/audit";
import { getQuestionWrongRoster } from "@/lib/roster";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, string> = { WRONG: "错", PARTIAL: "半对" };
const VERDICT_CLS: Record<string, string> = {
  WRONG: "bg-red-50 text-red-600",
  PARTIAL: "bg-amber-50 text-amber-600",
};

export default async function Roster({ params }: { params: { id: string } }) {
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

  const roster = await getQuestionWrongRoster(assignment.id);
  const shown = roster.reduce((s, q) => s + q.students.length, 0);

  // 敏感动作留痕：教师查看本班学生错题明细（只记标量，不写作答原文/姓名到审计）
  await writeAudit({
    actorId: user.id,
    action: "VIEW_STUDENT_ERRORS",
    entity: "Assignment",
    entityId: assignment.id,
    after: shown,
  });

  return (
    <AppShell title="错题名单（按题）">
      <div className="mb-4 text-sm flex gap-4">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/stats`} className="text-brand-500 hover:underline">
          统计看板
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/roster/students`} className="text-brand-500 hover:underline">
          按学生查看 →
        </Link>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        仅显示本班的错题/半对名单，用于讲评后针对性辅导；此查看已记入审计日志。
      </p>

      {shown === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          暂无错题记录（可能尚未导入批改，或全班全对）。
        </div>
      ) : (
        <div className="space-y-5">
          {roster.map((q) => (
            <section key={q.questionId} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <Link
                  href={`/teacher/assignments/${assignment.id}/questions/${q.questionId}`}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  第 {q.seq} 题{" "}
                  {!q.hasAnswer && <span className="text-amber-600 text-xs">（缺标准答案）</span>}
                </Link>
                <span className="text-xs text-gray-500">
                  错 {q.wrong} · 半对 {q.partial} · 共 {q.students.length}
                </span>
              </div>
              {q.knowledgePoints.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {q.knowledgePoints.map((k) => (
                    <span key={k.code} className="text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600">
                      <span className="font-mono text-gray-400 mr-1">{k.code}</span>
                      {k.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-sm text-gray-600 whitespace-pre-wrap mb-3 line-clamp-2">{q.stemText}</p>
              <ul className="divide-y divide-gray-100">
                {q.students.map((s) => (
                  <li key={s.studentId} className="py-2 flex gap-3 items-start text-sm">
                    <span
                      className={
                        "shrink-0 text-xs px-2 py-0.5 rounded " + (VERDICT_CLS[s.verdict] ?? "bg-gray-100")
                      }
                    >
                      {VERDICT[s.verdict] ?? s.verdict}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{s.studentName}</div>
                      <div className="text-gray-500 whitespace-pre-wrap break-words">
                        作答：{s.answerText}
                      </div>
                      {s.teacherNote && (
                        <div className="text-gray-600 whitespace-pre-wrap break-words">
                          评语：{s.teacherNote}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
