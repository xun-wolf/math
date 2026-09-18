import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import { getMyReviewDetail } from "@/lib/student-reviews";
import { submitCorrection, askQuestion } from "@/lib/actions/student";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, string> = {
  CORRECT: "正确",
  PARTIAL: "半对",
  WRONG: "错误",
};

const CORR: Record<string, string> = {
  PENDING: "订正已提交，等待教师复核",
  RESOLVED: "教师已确认掌握",
  STILL_WRONG: "教师判定仍需订正",
};

export default async function ReviewDetail({ params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireRole("STUDENT");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let detail;
  try {
    detail = await getMyReviewDetail(user.id, params.id);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }

  return (
    <AppShell title="讲评详情">
      <div className="mb-4 text-sm">
        <Link href="/student/dashboard" className="text-brand-500 hover:underline">
          ← 我的讲评
        </Link>
      </div>

      <div className="space-y-6">
        <section className="card p-5">
          <div className="text-xs text-gray-400">{detail.assignmentTitle}</div>
          <h2 className="font-semibold mt-1">第 {detail.questionSeq} 题</h2>
          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{detail.stemText}</p>
          <div className="mt-3 text-sm space-y-1 border-t pt-3">
            <div>
              <span className="text-gray-400">我的作答：</span>
              <span className="whitespace-pre-wrap">{detail.myAnswerText ?? "—"}</span>
            </div>
            <div>
              <span className="text-gray-400">批改结果：</span>
              <span>{detail.myVerdict ? VERDICT[detail.myVerdict] ?? detail.myVerdict : "未批改"}</span>
            </div>
            {detail.teacherNote && (
              <div>
                <span className="text-gray-400">教师评语：</span>
                <span className="whitespace-pre-wrap">{detail.teacherNote}</span>
              </div>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold mb-2">教师讲评</h3>
          <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap text-gray-800">
            {detail.finalContent}
          </div>
          <div className="text-xs text-gray-400 mt-3">
            发布于 {detail.publishedAt.toLocaleString("zh-CN")}
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold mb-2">提交订正</h3>
          {detail.correction && (
            <p className="text-sm mb-3">
              <span className="text-gray-400">当前订正：</span>
              <span className="whitespace-pre-wrap">{detail.correction.correctedAnswerText}</span>
              <span className="ml-2 text-brand-700">
                {CORR[detail.correction.status] ?? detail.correction.status}
              </span>
            </p>
          )}
          <ActionForm
            action={submitCorrection.bind(null, detail.reviewId)}
            submitLabel={detail.correction ? "重新提交订正" : "提交订正"}
          >
            <textarea
              name="correctedAnswerText"
              rows={4}
              defaultValue={detail.correction?.correctedAnswerText ?? ""}
              placeholder="写出你的订正过程与答案"
              className="input w-full"
            />
          </ActionForm>
        </section>

        <section className="card p-5">
          <h3 className="font-semibold mb-2">向教师提问</h3>
          {detail.questions.length === 0 ? (
            <p className="text-sm text-gray-500 mb-3">还没有提问记录。</p>
          ) : (
            <ul className="space-y-3 mb-3">
              {detail.questions.map((q) => (
                <li key={q.id} className="text-sm border-l-2 border-brand-200 pl-3">
                  <div className="whitespace-pre-wrap">{q.questionText}</div>
                  {q.teacherReply ? (
                    <div className="mt-1 text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap">
                      教师回复：{q.teacherReply}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-gray-400">等待教师回复</div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={askQuestion.bind(null, detail.reviewId)} submitLabel="提交提问">
            <textarea
              name="questionText"
              rows={3}
              placeholder="关于这道题的讲评，你有什么不明白的？"
              className="input w-full"
            />
          </ActionForm>
        </section>
      </div>
    </AppShell>
  );
}
