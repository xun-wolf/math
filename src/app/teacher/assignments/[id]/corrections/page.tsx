import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, assertTeacherOwnsAssignment, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import CorrectionActions from "@/components/CorrectionActions";
import QuestionReply from "@/components/QuestionReply";
import {
  getAssignmentCorrections,
  getAssignmentStudentQuestions,
  getCorrectionStats,
} from "@/lib/corrections";

export const dynamic = "force-dynamic";

const CORR_LABEL: Record<string, string> = {
  PENDING: "待复核",
  RESOLVED: "已掌握",
  STILL_WRONG: "仍需订正",
};
const CORR_CLS: Record<string, string> = {
  PENDING: "text-amber-600",
  RESOLVED: "text-green-600",
  STILL_WRONG: "text-red-600",
};

export default async function Corrections({ params }: { params: { id: string } }) {
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

  const [corrections, questions, stats] = await Promise.all([
    getAssignmentCorrections(assignment.id),
    getAssignmentStudentQuestions(assignment.id),
    getCorrectionStats(assignment.id),
  ]);

  const rate = Math.round(stats.resolveRate * 100);

  return (
    <AppShell title="订正与提问跟踪">
      <div className="mb-4 text-sm flex gap-4">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/stats`} className="text-brand-500 hover:underline">
          统计看板
        </Link>
      </div>

      <div className="card p-4 mb-6 flex flex-wrap items-center gap-6 text-sm">
        <span className="font-semibold">{assignment.title}</span>
        <span>订正记录 <b>{stats.total}</b></span>
        <span className="text-amber-600">待复核 {stats.pending}</span>
        <span className="text-green-600">已掌握 {stats.resolved}</span>
        <span className="text-red-600">仍需订正 {stats.stillWrong}</span>
        <span className="ml-auto">
          订正掌握率 <b className={rate >= 60 ? "text-green-600" : "text-amber-600"}>{rate}%</b>
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="space-y-4">
          <h2 className="font-semibold">订正复核（{corrections.length}）</h2>
          {corrections.length === 0 ? (
            <p className="card p-6 text-sm text-gray-500">还没有学生提交订正。</p>
          ) : (
            corrections.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">
                    {c.studentName} · 第 {c.questionSeq} 题
                  </span>
                  <span className={CORR_CLS[c.status] ?? "text-gray-500"}>{CORR_LABEL[c.status] ?? c.status}</span>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap border-l-2 border-gray-200 pl-3 my-2">
                  {c.correctedAnswerText}
                </div>
                {c.teacherResolvedNote && (
                  <div className="text-xs text-gray-500 mb-2">复核说明：{c.teacherResolvedNote}</div>
                )}
                <CorrectionActions correctionId={c.id} />
              </div>
            ))
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold">学生提问（{questions.length}）</h2>
          {questions.length === 0 ? (
            <p className="card p-6 text-sm text-gray-500">还没有学生提问。</p>
          ) : (
            questions.map((q) => (
              <div key={q.id} className="card p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">
                    {q.studentName} · 第 {q.questionSeq} 题
                  </span>
                  <span className="text-xs text-gray-400">{q.createdAt.toLocaleString("zh-CN")}</span>
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap my-2">{q.questionText}</div>
                {q.teacherReply ? (
                  <div className="text-sm bg-green-50 border border-green-200 rounded p-2 whitespace-pre-wrap">
                    已回复：{q.teacherReply}
                  </div>
                ) : (
                  <QuestionReply sqId={q.id} />
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </AppShell>
  );
}
