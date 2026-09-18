import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  requireRole,
  assertTeacherOwnsAssignment,
  AuthError,
} from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import { generateDraft, generateAllDrafts } from "@/lib/actions/drafts";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "待审核",
  NEEDS_MANUAL: "待人工处理",
  APPROVED: "已通过",
  PUBLISHED: "已发布",
  REJECTED: "已拒绝",
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 border-amber-200",
  NEEDS_MANUAL: "bg-red-100 text-red-700 border-red-200",
  APPROVED: "bg-blue-100 text-blue-700 border-blue-200",
  PUBLISHED: "bg-green-100 text-green-700 border-green-200",
  REJECTED: "bg-gray-100 text-gray-500 border-gray-200",
};

function Badge({ status }: { status: string }) {
  return (
    <span
      className={
        "text-xs px-2 py-0.5 rounded border " +
        (STATUS_STYLE[status] ?? "bg-gray-100 text-gray-500 border-gray-200")
      }
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function parseCauses(json: string | null): { cause: string; count: number }[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((x: any) => ({ cause: String(x.cause ?? ""), count: Number(x.count ?? 0) }));
  } catch {
    return [];
  }
}

function snippet(text: string | null, n: number): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

export default async function Drafts({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { status?: string };
}) {
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
    include: { standardAnswer: { select: { id: true, rubricText: true } } },
  });

  const drafts = await prisma.reviewDraft.findMany({
    where: { assignmentId: assignment.id },
    orderBy: { createdAt: "desc" },
    include: {
      knowledge: { include: { kp: { select: { name: true, code: true } } } },
      _count: { select: { suggestions: true, versions: true } },
    },
  });

  // 每题取最新一条草稿
  const latestByQuestion = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) {
    if (!latestByQuestion.has(d.questionId)) latestByQuestion.set(d.questionId, d);
  }

  const filter = searchParams.status;
  const counts = { total: questions.length, draft: 0, manual: 0, published: 0 };
  for (const q of questions) {
    const d = latestByQuestion.get(q.id);
    if (d?.status === "DRAFT" || d?.status === "APPROVED") counts.draft++;
    else if (d?.status === "NEEDS_MANUAL") counts.manual++;
    else if (d?.status === "PUBLISHED") counts.published++;
  }

  const shown = questions.filter((q) => {
    if (!filter) return true;
    const d = latestByQuestion.get(q.id);
    if (filter === "NONE") return !d;
    return d?.status === filter;
  });

  const tabs = [
    { key: "", label: "全部" },
    { key: "DRAFT", label: "待审核" },
    { key: "NEEDS_MANUAL", label: "待人工" },
    { key: "PUBLISHED", label: "已发布" },
    { key: "NONE", label: "未生成" },
  ];

  return (
    <AppShell title="AI 讲评草稿">
      <div className="mb-4 text-sm flex gap-4 items-center">
        <Link href={`/teacher/assignments/${assignment.id}`} className="text-brand-500 hover:underline">
          ← 返回 {assignment.title}
        </Link>
        <Link href={`/teacher/assignments/${assignment.id}/stats`} className="text-brand-500 hover:underline">
          统计看板
        </Link>
      </div>

      <div className="card p-5 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-gray-600">
          共 {counts.total} 题 · 待审核 {counts.draft} · 待人工 {counts.manual} · 已发布 {counts.published}
          <div className="text-xs text-gray-400 mt-1">
            当前 AI Provider：<span className="font-mono">{process.env.AI_PROVIDER ?? "mock"}</span>
            {process.env.MOCK_AI_FAIL === "true" && (
              <span className="text-red-500 ml-2">（MOCK_AI_FAIL=true：将演示失败兜底）</span>
            )}
          </div>
        </div>
        <ActionForm
          action={generateAllDrafts.bind(null, assignment.id)}
          submitLabel="为全部题目生成草稿"
        />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/teacher/assignments/${assignment.id}/drafts?status=${t.key}` : `/teacher/assignments/${assignment.id}/drafts`}
            className={
              "text-sm px-3 py-1 rounded-full border " +
              ((filter ?? "") === t.key
                ? "bg-brand-500 text-white border-brand-500"
                : "bg-white text-gray-600 border-gray-200 hover:border-brand-300")
            }
          >
            {t.label}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">该筛选下暂无题目。</div>
      ) : (
        <ul className="space-y-4">
          {shown.map((q) => {
            const d = latestByQuestion.get(q.id);
            const causes = parseCauses(d?.errorCauses ?? null);
            const hasRubric = !!q.standardAnswer?.rubricText?.trim();
            return (
              <li key={q.id} className="card p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">
                    第 {q.seq} 题
                    <span className="ml-2 text-gray-400 font-normal text-sm">
                      {snippet(q.stemText, 40)}
                    </span>
                  </div>
                  {d ? <Badge status={d.status} /> : <Badge status="NONE" />}
                </div>

                {d?.status === "NEEDS_MANUAL" && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
                    {d.aiFailReason ?? "需教师人工处理"}
                    {!hasRubric && (
                      <Link
                        href={`/teacher/assignments/${assignment.id}/questions/${q.id}`}
                        className="ml-2 underline"
                      >
                        去补充标准答案 / 评分说明 →
                      </Link>
                    )}
                  </div>
                )}

                {d && d.status !== "NEEDS_MANUAL" && (
                  <div className="text-sm space-y-2">
                    {d.summary && (
                      <p>
                        <span className="text-gray-400">摘要：</span>
                        {snippet(d.summary, 120)}
                      </p>
                    )}
                    {causes.length > 0 && (
                      <div>
                        <span className="text-gray-400">错因分析（{causes.length}）：</span>
                        <ul className="mt-1 space-y-0.5">
                          {causes.slice(0, 3).map((c, i) => (
                            <li key={i} className="text-gray-700">
                              · {c.cause} {c.count > 0 && <span className="text-gray-400">（{c.count} 人）</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {d.explanation && (
                      <p className="text-gray-600">
                        <span className="text-gray-400">讲解：</span>
                        {snippet(d.explanation, 140)}
                      </p>
                    )}
                    <div className="text-xs text-gray-400 flex gap-3">
                      {d.modelTag && <span>模型：{d.modelTag}</span>}
                      {d.knowledge.length > 0 && (
                        <span>知识点：{d.knowledge.map((k) => k.kp.name).join("、")}</span>
                      )}
                      {d._count.suggestions > 0 && <span>候选练习 {d._count.suggestions} 条</span>}
                      {d._count.versions > 0 && <span>版本 {d.currentVersion}</span>}
                    </div>
                  </div>
                )}

                {!d && (
                  <p className="text-sm text-gray-500">
                    {hasRubric ? "尚未生成讲评草稿。" : "该题缺标准答案/评分说明，生成会标记为待人工处理。"}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-3">
                  {d && d.status !== "PUBLISHED" && (
                    <Link
                      href={`/teacher/drafts/${d.id}`}
                      className="btn-primary inline-flex items-center"
                    >
                      进入审核 / 编辑
                    </Link>
                  )}
                  {d && d.status === "PUBLISHED" && (
                    <Link
                      href={`/teacher/drafts/${d.id}`}
                      className="btn-secondary inline-flex items-center"
                    >
                      查看已发布讲评
                    </Link>
                  )}
                  <ActionForm
                    action={generateDraft.bind(null, q.id)}
                    submitLabel={d ? "重新生成" : "生成草稿"}
                    className="inline-flex items-center gap-3"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
