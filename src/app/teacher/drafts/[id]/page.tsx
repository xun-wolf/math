import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, assertTeacherOwnsDraft, AuthError } from "@/lib/auth-guard";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import DraftEditor from "@/components/DraftEditor";
import { publishDraft, rejectDraft, restoreDraftVersion } from "@/lib/actions/draftReview";
import { generateDraft } from "@/lib/actions/drafts";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "待审核", NEEDS_MANUAL: "待人工处理", APPROVED: "已通过", PUBLISHED: "已发布", REJECTED: "已拒绝",
};

function safeObj(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}
function safeArr(s: string | null): { cause: string; count: number; evidence: string }[] {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}

export default async function DraftReview({ params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let draft;
  try {
    draft = await assertTeacherOwnsDraft(user, params.id);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }

  const [suggestions, versions] = await Promise.all([
    prisma.practiceSuggestion.findMany({ where: { draftId: draft.id }, orderBy: { id: "asc" } }),
    prisma.reviewDraftVersion.findMany({
      where: { draftId: draft.id },
      orderBy: { versionNum: "desc" },
      include: { draft: { select: { id: true } } },
    }),
  ]);

  const qSnap = safeObj(draft.basedOnQuestionSnapshot);
  const aSnap = safeObj(draft.basedOnAnswerSnapshot);
  const causes = safeArr(draft.errorCauses);
  const practice = suggestions.map((s) => ({ text: s.questionRefText, rationale: s.rationale ?? "" }));
  const isPublished = draft.status === "PUBLISHED";
  const published = isPublished ? await prisma.publishedReview.findUnique({ where: { draftId: draft.id } }) : null;

  const baseUpdatedAt = draft.updatedAt.getTime();

  return (
    <AppShell title="讲评草稿审核">
      <div className="mb-4 text-sm flex flex-wrap gap-4">
        <Link href={`/teacher/assignments/${draft.assignmentId}/drafts`} className="text-brand-500 hover:underline">
          ← 返回草稿列表
        </Link>
        <Link href={`/teacher/assignments/${draft.assignmentId}/stats`} className="text-brand-500 hover:underline">
          统计看板
        </Link>
        <Link href={`/teacher/assignments/${draft.assignmentId}/questions/${draft.questionId}`} className="text-brand-500 hover:underline">
          编辑题目/标准答案
        </Link>
      </div>

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-lg">第 {draft.question.seq} 题讲评草稿</h2>
            <div className="text-xs text-gray-500 mt-1">
              来源：{draft.source === "MANUAL" ? "教师手工" : "AI 生成"}
              {draft.modelTag && <span> · 模型 {draft.modelTag}</span>}
              <span> · 当前版本 v{draft.currentVersion}</span>
            </div>
          </div>
          <span className={"text-sm px-3 py-1 rounded border " + (isPublished ? "bg-green-100 text-green-700 border-green-200" : draft.status === "NEEDS_MANUAL" ? "bg-red-100 text-red-700 border-red-200" : "bg-amber-100 text-amber-700 border-amber-200")}>
            {STATUS_LABEL[draft.status] ?? draft.status}
          </span>
        </div>

        {draft.status === "NEEDS_MANUAL" && (
          <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {draft.aiFailReason ?? "需教师人工处理"}。
            在右侧「分步讲解」补写内容后保存，即可发布；或点「重新生成」再试 AI。
          </div>
        )}
        {isPublished && published && (
          <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
            已发布（{published.publishedAt.toISOString().slice(0, 16).replace("T", " ")}），学生端（M6）可见。已发布内容不可直接编辑。
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        {/* 依据：只读，AI 输入源 */}
        <section className="card p-5 space-y-4">
          <h3 className="font-semibold text-gray-700">依据（只读 · AI 输入源）</h3>

          <div>
            <div className="text-xs text-gray-400 mb-1">📝 题目原文</div>
            <p className="text-sm whitespace-pre-wrap">{String(qSnap.stemText ?? draft.question.stemText)}</p>
            <div className="text-xs text-gray-400 mt-1">
              难度 {String(qSnap.difficulty ?? draft.question.difficulty)} · 关联知识点：
              {Array.isArray(qSnap.knowledgePoints) && qSnap.knowledgePoints.length
                ? (qSnap.knowledgePoints as string[]).join("、")
                : "（无）"}
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs text-gray-400 mb-1">✅ 标准答案</div>
            <p className="text-sm">{String(aSnap.answerText ?? "（生成时缺失）")}</p>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">📏 评分说明</div>
            <p className="text-sm whitespace-pre-wrap">{String(aSnap.rubricText ?? "（生成时缺失）")}</p>
          </div>
          {aSnap.commonMistakeNote ? (
            <div>
              <div className="text-xs text-gray-400 mb-1">⚠️ 常见错误提示</div>
              <p className="text-sm">{String(aSnap.commonMistakeNote)}</p>
            </div>
          ) : null}

          <div className="border-t pt-3">
            <div className="text-xs text-gray-400 mb-1">📊 该题错误分布（生成时）</div>
            <p className="text-sm font-mono">{draft.basedOnErrorSummary}</p>
          </div>

          <div className="text-xs text-gray-400 pt-2">
            以上为草稿生成时锁定的依据快照；若题目/标准答案此后被修改，请点「重新生成」以最新依据重出草稿。
          </div>
        </section>

        {/* 草稿：可编辑 */}
        <section className="card p-5">
          <h3 className="font-semibold text-gray-700 mb-3">AI 草稿（可逐段编辑）</h3>
          {isPublished ? (
            <div className="space-y-3 text-sm">
              <p><span className="text-gray-400">摘要：</span>{draft.summary}</p>
              <p className="whitespace-pre-wrap"><span className="text-gray-400">讲解：</span>{draft.explanation}</p>
              {draft.workedExample && <p className="whitespace-pre-wrap"><span className="text-gray-400">示例：</span>{draft.workedExample}</p>}
              <p className="text-xs text-gray-400">如需修改，请回到草稿列表点「重新生成」产出一条新草稿。</p>
            </div>
          ) : (
            <DraftEditor
              draftId={draft.id}
              baseUpdatedAt={baseUpdatedAt}
              initial={{
                summary: draft.summary ?? "",
                explanation: draft.explanation ?? "",
                workedExample: draft.workedExample ?? "",
                causes,
                practice,
              }}
            />
          )}
        </section>
      </div>

      {/* 操作区 */}
      {!isPublished && (
        <div className="card p-5 mt-6 flex flex-wrap items-center gap-4">
          <ActionForm
            action={publishDraft.bind(null, draft.id)}
            submitLabel="✅ 发布"
            className="inline-flex items-center gap-2"
          >
            <input type="hidden" name="baseUpdatedAt" value={baseUpdatedAt} />
          </ActionForm>
          <span className="text-xs text-gray-400">发布前请先「保存修改」，发布使用最近一次保存的内容。</span>
          <div className="flex-1" />
          <ActionForm
            action={generateDraft.bind(null, draft.questionId)}
            submitLabel="🔄 重新生成"
            className="inline-flex items-center gap-2"
          />
          <ActionForm
            action={rejectDraft.bind(null, draft.id)}
            submitLabel="❌ 拒绝"
            className="inline-flex items-center gap-2"
          />
        </div>
      )}

      {/* 版本历史 */}
      <section className="card p-5 mt-6">
        <h3 className="font-semibold mb-3">版本历史（{versions.length}）</h3>
        <ul className="text-sm space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-3 text-gray-600">
              <span className="font-mono text-xs">v{v.versionNum}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100">{CHANGE_LABEL[v.changeType] ?? v.changeType}</span>
              <span className="text-xs text-gray-400">{v.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              {v.versionNum === draft.currentVersion && (
                <span className="text-xs text-brand-600">（当前）</span>
              )}
              {!isPublished && v.versionNum !== draft.currentVersion && (
                <ActionForm
                  action={restoreDraftVersion.bind(null, draft.id, v.id)}
                  submitLabel="恢复到此版本"
                  className="ml-auto inline-flex items-center gap-2"
                >
                  <input type="hidden" name="baseUpdatedAt" value={baseUpdatedAt} />
                </ActionForm>
              )}
            </li>
          ))}
          {versions.length === 0 && <li className="text-gray-400">暂无版本记录</li>}
        </ul>
        <p className="text-xs text-gray-400 mt-2">
          {isPublished
            ? "已发布草稿不可回退；如需调整请回到草稿列表「重新生成」产出新草稿。"
            : "回退会用所选历史版本覆盖当前正文，并追加一条「版本恢复」新版本（历史不被删除，可再次回退）。"}
        </p>
      </section>
    </AppShell>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  AI_GENERATED: "AI 生成",
  REGENERATED: "重新生成",
  MANUAL_EDIT: "人工修改",
  RESTORED: "版本恢复",
};
