// M4 冒烟：直接驱动 generateDraftForQuestion。
//   默认（A/B）：   npx tsx scripts/m4-verify.ts
//   失败兜底（C）： MOCK_AI_FAIL=true npx tsx scripts/m4-verify.ts
// A 用 demo 里已有评分说明的题（结果保留作浏览器演示）；B/C 各造临时题，跑完即删。
import { prisma } from "../src/lib/db";
import fs from "node:fs";

function loadEnv() {
  for (const name of ["../.env", "../.env.local"]) {
    const file = new URL(name, import.meta.url);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

async function main() {
  loadEnv();
  const teacher = await prisma.user.findUniqueOrThrow({ where: { loginName: "teacher01" } });
  const assignment = await prisma.assignment.findFirst({
    where: { class: { teacherId: teacher.id } },
    orderBy: { createdAt: "desc" },
    include: { questions: { orderBy: { seq: "asc" }, include: { standardAnswer: true } } },
  });
  if (!assignment) throw new Error("找不到 teacher01 的作业");
  const { generateDraftForQuestion } = await import("../src/lib/drafts");

  if (process.env.MOCK_AI_FAIL === "true") return caseC(assignment.id, teacher.id, generateDraftForQuestion);
  const rubricQ = assignment.questions.find((x) => x.standardAnswer?.rubricText.trim());
  if (!rubricQ) throw new Error("没有含评分说明的题目");
  await caseA(rubricQ.id, teacher.id, generateDraftForQuestion);
  await caseB(assignment.id, teacher.id, generateDraftForQuestion);
}

async function caseA(qid: string, userId: string, gen: Gen) {
  console.log("— 用例 A：有依据 → DRAFT —");
  const r = await gen(qid, userId);
  const d = await prisma.reviewDraft.findUniqueOrThrow({
    where: { id: r.draftId },
    include: { knowledge: true, suggestions: true, versions: true },
  });
  check("A 状态 DRAFT", r.status === "DRAFT", r.status);
  check("A summary 非空", !!d.summary);
  check("A errorCauses 可解析为数组", safeArr(d.errorCauses));
  check("A explanation 非空", !!d.explanation);
  check("A 三个依据快照非空", !!d.basedOnQuestionSnapshot && !!d.basedOnAnswerSnapshot && !!d.basedOnErrorSummary);
  check("A 知识点关联已写", d.knowledge.length > 0);
  check("A 候选练习已写", d.suggestions.length > 0);
  check("A 版本快照 ≥1 且 currentVersion≥1", d.versions.length >= 1 && d.currentVersion >= 1);
}

async function caseB(assignmentId: string, userId: string, gen: Gen) {
  console.log("— 用例 B：缺依据（无标准答案）→ NEEDS_MANUAL，不调 AI —");
  const seq = ((await maxSeq(assignmentId)) ?? 0) + 90;
  const tmp = await prisma.question.create({
    data: { assignmentId, seq, stemText: "M4 临时题 B：缺依据", difficulty: 3 },
  });
  try {
    const r = await gen(tmp.id, userId);
    const d = await prisma.reviewDraft.findUniqueOrThrow({ where: { id: r.draftId } });
    check("B 状态 NEEDS_MANUAL", r.status === "NEEDS_MANUAL", r.status);
    check("B reason 含『缺依据』", /缺依据/.test(d.aiFailReason ?? ""), d.aiFailReason);
    check("B 未写正文", !d.summary && !d.explanation);
  } finally {
    await prisma.question.delete({ where: { id: tmp.id } });
  }
}

async function caseC(assignmentId: string, userId: string, gen: Gen) {
  console.log("— 用例 C：MOCK_AI_FAIL=true，有依据但 Provider 抛错 → NEEDS_MANUAL —");
  const seq = ((await maxSeq(assignmentId)) ?? 0) + 91;
  const tmp = await prisma.question.create({
    data: { assignmentId, seq, stemText: "M4 临时题 C：模型不可用", difficulty: 4 },
  });
  await prisma.standardAnswer.create({
    data: { questionId: tmp.id, answerText: "x=1", rubricText: "步骤分：移项/合并/检验" },
  });
  try {
    const r = await gen(tmp.id, userId);
    const d = await prisma.reviewDraft.findUniqueOrThrow({ where: { id: r.draftId } });
    check("C 状态 NEEDS_MANUAL", r.status === "NEEDS_MANUAL", r.status);
    check("C reason 含『AI 生成失败』", /AI 生成失败/.test(d.aiFailReason ?? ""), d.aiFailReason);
  } finally {
    await prisma.question.delete({ where: { id: tmp.id } });
  }
}

type Gen = (qid: string, uid: string) => Promise<{ status: string; draftId: string }>;

async function maxSeq(assignmentId: string) {
  return (await prisma.question.aggregate({ where: { assignmentId }, _max: { seq: true } }))._max.seq;
}

function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? "✔" : "✘"} ${name}${cond ? "" : "  实际=" + JSON.stringify(extra)}`);
  if (!cond) process.exitCode = 1;
}
function safeArr(s: string | null): boolean {
  if (!s) return false;
  try { return Array.isArray(JSON.parse(s)); } catch { return false; }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
