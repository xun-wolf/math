import { redirect } from "next/navigation";
import Link from "next/link";
import {
  requireRole,
  assertTeacherOwnsQuestion,
  AuthError,
} from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import AppShell from "@/components/AppShell";
import Forbidden from "@/components/Forbidden";
import ActionForm from "@/components/ActionForm";
import {
  saveQuestionMeta,
  saveStandardAnswer,
  setQuestionKnowledge,
} from "@/lib/actions/questions";

export const dynamic = "force-dynamic";

export default async function QuestionEdit({
  params,
}: {
  params: { id: string; qid: string };
}) {
  let user;
  try {
    user = await requireRole("TEACHER");
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (user.mustChangePassword) redirect("/account/change-password");

  let q;
  try {
    q = await assertTeacherOwnsQuestion(user, params.qid);
  } catch (e) {
    if (e instanceof AuthError) return <Forbidden code={e.status} message={e.message} />;
    throw e;
  }
  if (q.assignmentId !== params.id) {
    redirect(`/teacher/assignments/${q.assignmentId}/questions/${q.id}`);
  }

  const allKp = await prisma.knowledgePoint.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  const linked = new Set(q.knowledge.map((k) => k.kpId));

  const metaForm = saveQuestionMeta.bind(null, q.id);
  const answerForm = saveStandardAnswer.bind(null, q.id);
  const kpForm = setQuestionKnowledge.bind(null, q.id);

  return (
    <AppShell title={`第 ${q.seq} 题 · 编辑`}>
      <div className="mb-4 text-sm">
        <Link href={`/teacher/assignments/${q.assignmentId}`} className="text-brand-500 hover:underline">
          ← 返回 {q.assignment.title}
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section className="card p-5">
            <h3 className="font-semibold mb-3">题目信息</h3>
            <ActionForm action={metaForm} submitLabel="保存题目">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">题干 *</label>
                  <textarea name="stemText" className="input" rows={4} defaultValue={q.stemText} required maxLength={2000} />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">难度(1-5)</label>
                    <input name="difficulty" type="number" min={1} max={5} className="input" defaultValue={q.difficulty} />
                  </div>
                  <div className="flex-[2]">
                    <label className="block text-sm text-gray-600 mb-1">来源备注</label>
                    <input name="sourceNote" className="input" defaultValue={q.sourceNote ?? ""} maxLength={120} placeholder="可选" />
                  </div>
                </div>
              </div>
            </ActionForm>
          </section>

          <section className="card p-5">
            <h3 className="font-semibold mb-3">关联知识点</h3>
            <ActionForm action={kpForm} submitLabel="保存关联">
              {allKp.length === 0 ? (
                <p className="text-sm text-gray-500">
                  还没有知识点，请教研负责人先维护
                  <Link href="/teacher/knowledge-points" className="text-brand-500 hover:underline mx-1">知识点树</Link>。
                </p>
              ) : (
                <div className="max-h-64 overflow-auto space-y-1">
                  {allKp.map((k) => (
                    <label key={k.id} className="flex items-center gap-2 text-sm py-1">
                      <input type="checkbox" name="kpIds" value={k.id} defaultChecked={linked.has(k.id)} />
                      <span className="font-mono text-xs text-gray-400">{k.code}</span>
                      <span>{k.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </ActionForm>
          </section>
        </div>

        <div>
          <section className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">标准答案与评分说明</h3>
              {q.standardAnswer ? (
                <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">已填写</span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700">待补充</span>
              )}
            </div>
            <ActionForm action={answerForm} submitLabel="保存答案">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">标准答案 *</label>
                  <textarea name="answerText" className="input" rows={3} defaultValue={q.standardAnswer?.answerText ?? ""} required maxLength={2000} placeholder="如：x = 2" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">评分说明 *</label>
                  <textarea name="rubricText" className="input" rows={3} defaultValue={q.standardAnswer?.rubricText ?? ""} required maxLength={2000} placeholder="给分点、常见错误扣分规则（AI 讲评依赖此项）" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">常见错误提示</label>
                  <textarea name="commonMistakeNote" className="input" rows={2} defaultValue={q.standardAnswer?.commonMistakeNote ?? ""} maxLength={500} placeholder="可选" />
                </div>
                <p className="text-xs text-gray-400">
                  评分说明为空时，后续 AI 讲评将判定为「缺依据」，不会自动生成交稿。
                </p>
              </div>
            </ActionForm>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
