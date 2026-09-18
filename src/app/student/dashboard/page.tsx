import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import { getMyReviews } from "@/lib/student-reviews";

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; cls: string }> = {
  CORRECT: { label: "正确", cls: "text-green-600" },
  PARTIAL: { label: "半对", cls: "text-amber-600" },
  WRONG: { label: "错误", cls: "text-red-600" },
};

const CORR: Record<string, string> = {
  PENDING: "订正待复核",
  RESOLVED: "已掌握",
  STILL_WRONG: "仍需订正",
};

export default async function StudentDashboard() {
  let user;
  try {
    user = await requireRole("STUDENT");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  const items = await getMyReviews(user.id);

  return (
    <AppShell title="我的错题讲评">
      <div className="mb-4 text-sm text-gray-600">你好，{user.name}。你只能看到自己的讲评与订正记录。</div>
      {items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          暂无已发布的讲评。教师发布针对你作答过的题目的讲评后，会显示在这里。
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const v = it.myVerdict ? VERDICT[it.myVerdict] : null;
            return (
              <li key={it.reviewId} className="card p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-gray-400 truncate">{it.assignmentTitle}</div>
                  <Link
                    href={`/student/reviews/${it.reviewId}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    第 {it.questionSeq} 题
                  </Link>
                  <div className="text-sm text-gray-500 mt-1 line-clamp-1">{it.stemText}</div>
                </div>
                <div className="text-sm shrink-0 text-right space-y-1">
                  {v ? (
                    <div className={v.cls}>批改：{v.label}</div>
                  ) : (
                    <div className="text-gray-400">未批改</div>
                  )}
                  <div className="text-gray-500">
                    {it.correctionStatus ? CORR[it.correctionStatus] ?? it.correctionStatus : "未订正"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
