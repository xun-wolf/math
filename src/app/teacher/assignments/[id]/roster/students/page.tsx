import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, assertTeacherOwnsAssignment, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import { writeAudit } from "@/lib/audit";
import { getStudentErrorProfiles } from "@/lib/roster";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, string> = { WRONG: "错", PARTIAL: "半对" };
const VERDICT_CLS: Record<string, string> = {
  WRONG: "bg-red-50 text-red-600",
  PARTIAL: "bg-amber-50 text-amber-600",
};

export default async function RosterStudents({ params }: { params: { id: string } }) {
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

  const profiles = await getStudentErrorProfiles(assignment.id);

  await writeAudit({
    actorId: user.id,
    action: "VIEW_STUDENT_ERRORS",
    entity: "Assignment",
    entityId: assignment.id,
    after: profiles.length,
  });

  return (
    <AppShell title="错题画像（按学生）">
      <div className="mb-4 text-sm flex gap-4">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/stats`} className="text-brand-500 hover:underline">
          统计看板
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/roster`} className="text-brand-500 hover:underline">
          ← 按题查看
        </Link>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        按学生汇总本班错题与涉及知识点，用于个别辅导；此查看已记入审计日志。
      </p>

      {profiles.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          暂无错题记录（可能尚未导入批改，或全班全对）。
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {profiles.map((p) => (
            <section key={p.studentId} className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold">{p.studentName}</span>
                <span className="text-xs text-gray-500">
                  错 {p.wrongCount} · 半对 {p.partialCount}
                </span>
              </div>
              {p.knowledgePoints.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {p.knowledgePoints.map((k) => (
                    <span key={k.code} className="text-xs bg-gray-100 rounded px-2 py-0.5 text-gray-600">
                      <span className="font-mono text-gray-400 mr-1">{k.code}</span>
                      {k.name}
                    </span>
                  ))}
                </div>
              )}
              <ul className="space-y-2">
                {p.items.map((it) => (
                  <li key={it.questionId} className="text-sm flex items-start gap-2">
                    <span
                      className={
                        "shrink-0 text-xs px-2 py-0.5 rounded " + (VERDICT_CLS[it.verdict] ?? "bg-gray-100")
                      }
                    >
                      {VERDICT[it.verdict] ?? it.verdict}
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/teacher/assignments/${assignment.id}/questions/${it.questionId}`}
                        className="text-brand-700 hover:underline"
                      >
                        第 {it.seq} 题
                      </Link>
                      {it.teacherNote && (
                        <span className="text-gray-500"> · {it.teacherNote}</span>
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
