import { redirect } from "next/navigation";
import Link from "next/link";
import { requireRole, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import { getResearchStats } from "@/lib/research";

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

export default async function ResearcherDashboard() {
  let user;
  try {
    user = await requireRole("RESEARCHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  const { kp, classes, totals } = await getResearchStats();

  return (
    <AppShell title="教研工作台">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-600">
          跨班聚合分析。教研只看知识点错误率与班级订正掌握率，看不到任何学生答题原文与个人标识（§16.2）。
        </p>
        <Link
          href="/researcher/export.csv"
          className="text-sm px-3 py-1.5 rounded bg-brand-500 text-white hover:bg-brand-600 shrink-0 ml-4"
        >
          导出去标识化 CSV
        </Link>
      </div>

      <div className="card p-4 mb-6 flex flex-wrap items-center gap-6 text-sm">
        <span className="font-semibold">全局概览</span>
        <span>批改记录 <b>{totals.graded}</b></span>
        <span>整体错误率 <b className={totals.errorRate >= HIGH ? "text-red-600" : "text-gray-700"}>{pct(totals.errorRate)}</b></span>
        <span>订正记录 <b>{totals.correctionTotal}</b></span>
        <span>
          订正掌握率{" "}
          <b className={totals.masteryRate >= 0.6 ? "text-green-600" : "text-amber-600"}>{pct(totals.masteryRate)}</b>
        </span>
      </div>

      {!totals.hasData ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          尚无可用数据：需要教师先完成批改导入并产生学生订正后，这里才会出现聚合结果。
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">知识点错误率（跨班）</h2>
              <span className="text-xs text-gray-500">{kp.length} 个知识点</span>
            </div>
            {kp.length === 0 ? (
              <p className="text-sm text-gray-500">已批改题目尚未关联知识点，无法按知识点聚合。</p>
            ) : (
              <ul className="space-y-3">
                {kp.map((k) => (
                  <li key={k.code}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span>
                        <span className="font-mono text-xs text-gray-400 mr-1">{k.code}</span>
                        {k.name}
                      </span>
                      <span className={k.errorRate >= HIGH ? "text-red-600 font-medium" : "text-gray-500"}>
                        {pct(k.errorRate)}
                      </span>
                    </div>
                    <Bar rate={k.errorRate} />
                    <div className="text-xs text-gray-400 mt-1">
                      未掌握 {k.notMastered} · 共 {k.total}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5 space-y-4">
            <h2 className="font-semibold">班级订正掌握率</h2>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-500">尚无订正记录。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
                      <th className="py-2">班级</th>
                      <th className="py-2 text-right">错误率</th>
                      <th className="py-2 text-right">订正</th>
                      <th className="py-2 text-right">已掌握</th>
                      <th className="py-2 text-right">仍需</th>
                      <th className="py-2 text-right">待复核</th>
                      <th className="py-2 text-right">掌握率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((c) => (
                      <tr key={c.className} className="border-b last:border-0">
                        <td className="py-2">{c.className}</td>
                        <td className="py-2 text-right">{pct(c.errorRate)}</td>
                        <td className="py-2 text-right">{c.correctionTotal}</td>
                        <td className="py-2 text-right text-green-600">{c.resolved}</td>
                        <td className="py-2 text-right text-red-600">{c.stillWrong}</td>
                        <td className="py-2 text-right text-amber-600">{c.pending}</td>
                        <td className="py-2 text-right font-medium">{pct(c.masteryRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-gray-400 pt-2">
              班级名为聚合维度，不含学生姓名/学号等个人标识。
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
