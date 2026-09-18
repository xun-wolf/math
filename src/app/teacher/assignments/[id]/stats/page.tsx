import { redirect } from "next/navigation";
import Link from "next/link";
import {
  requireRole,
  assertTeacherOwnsAssignment,
  AuthError,
} from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import { getAssignmentStats } from "@/lib/stats";
import { getCorrectionStats } from "@/lib/corrections";

export const dynamic = "force-dynamic";

const HIGH = 0.5;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function Bar({ rate }: { rate: number }) {
  const color = rate >= HIGH ? "bg-red-500" : rate >= 0.3 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="h-3 w-full bg-gray-100 rounded overflow-hidden">
      <div className={"h-3 " + color} style={{ width: `${Math.min(100, rate * 100)}%` }} />
    </div>
  );
}

export default async function Stats({ params }: { params: { id: string } }) {
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

  const { byQuestion, byKp, graded, hasData } = await getAssignmentStats(assignment.id);
  const corr = await getCorrectionStats(assignment.id);

  return (
    <AppShell title="错误分布看板">
      <div className="mb-4 text-sm flex gap-4">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/import-grading`} className="text-brand-500 hover:underline">
          导入批改
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/corrections`} className="text-brand-500 hover:underline">
          订正跟踪
        </Link>
      </div>

      <div className="card p-4 mb-6 flex flex-wrap items-center gap-6 text-sm">
        <span className="font-semibold">订正完成情况</span>
        <span>订正记录 <b>{corr.total}</b></span>
        <span className="text-amber-600">待复核 {corr.pending}</span>
        <span className="text-green-600">已掌握 {corr.resolved}</span>
        <span className="text-red-600">仍需订正 {corr.stillWrong}</span>
        {corr.total > 0 ? (
          <span className="ml-auto">
            掌握率 <b className={corr.resolveRate >= 0.6 ? "text-green-600" : "text-amber-600"}>
              {Math.round(corr.resolveRate * 100)}%
            </b>
          </span>
        ) : (
          <span className="ml-auto text-gray-400">尚无学生订正</span>
        )}
      </div>

      {!hasData ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          尚无批改数据（已批改 {graded} 条）。请先完成
          <Link href={`/teacher/assignments/${assignment.id}/import-submissions`} className="text-brand-500 hover:underline mx-1">答题导入</Link>
          与
          <Link href={`/teacher/assignments/${assignment.id}/import-grading`} className="text-brand-500 hover:underline mx-1">批改导入</Link>
          。
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">按题错误分布</h2>
              <span className="text-xs text-gray-500">已批改 {graded} 条</span>
            </div>
            <ul className="space-y-3">
              {byQuestion.map((q) => (
                <li key={q.questionId}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <Link href={`/teacher/assignments/${assignment.id}/questions/${q.questionId}`} className="hover:underline text-brand-700">
                      第 {q.seq} 题 {!q.hasAnswer && <span className="text-amber-600 text-xs">（缺标准答案）</span>}
                    </Link>
                    <span className={q.errorRate >= HIGH ? "text-red-600 font-medium" : "text-gray-500"}>
                      错 {pct(q.errorRate)}
                    </span>
                  </div>
                  <Bar rate={q.errorRate} />
                  <div className="text-xs text-gray-400 mt-1">
                    对 {q.correct} · 半对 {q.partial} · 错 {q.wrong} · 共 {q.total}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5 space-y-4">
            <h2 className="font-semibold">按知识点未掌握比例</h2>
            {byKp.length === 0 ? (
              <p className="text-sm text-gray-500">题目尚未关联知识点，无法按知识点聚合。</p>
            ) : (
              <ul className="space-y-3">
                {byKp.map((k) => (
                  <li key={k.kpId}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>
                        <span className="font-mono text-xs text-gray-400 mr-1">{k.code}</span>
                        {k.name}
                      </span>
                      <span className={k.rate >= HIGH ? "text-red-600 font-medium" : "text-gray-500"}>
                        {pct(k.rate)}
                      </span>
                    </div>
                    <Bar rate={k.rate} />
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-400 pt-2">
              M4 起：可在高错误率知识点上触发 AI 讲评草稿生成。
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
