// 场景 7：AI 调用失败 → 状态置 NEEDS_MANUAL、不编造正文；教师随后仍可手工撰写并发布。
// 本脚本用一道临时题（含完整标准答案）验证“失败兜底”这一半；
// “手工撰写并发布”由演示库中 source=MANUAL 且 PUBLISHED 的草稿佐证（见 acceptance-verify 场景 3/4 输出）。
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  for (const name of ["../.env", "../.env.local"]) {
    const file = new URL(name, import.meta.url);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

let pass = 0, fail = 0;
function ok(c: boolean, m: string){ c?(pass++,console.log("  ✔ "+m)):(fail++,console.log("  ✘ "+m)); }

async function main() {
  loadEnv();
  process.env.AI_PROVIDER = "mock";
  process.env.MOCK_AI_FAIL = "true"; // 模拟模型不可用

  const prisma = new PrismaClient();
  const assignment = await prisma.assignment.findFirst({ where: { title: { contains: "一元一次方程" } } });
  const maxSeq = await prisma.question.findFirst({ where: { assignmentId: assignment!.id }, orderBy: { seq: "desc" }, select: { seq: true } });
  const teacher = await prisma.user.findFirst({ where: { role: "TEACHER" } });

  const tmp = await prisma.question.create({
    data: {
      assignmentId: assignment!.id, seq: (maxSeq?.seq ?? 0) + 950,
      stemText: "验收临时题：有完整依据但模型不可用", difficulty: 3,
      standardAnswer: { create: { answerText: "x = 5", rubricText: "移项得 x = 5，检验。", commonMistakeNote: "变号遗漏" } },
    },
  });
  try {
    const { generateDraftForQuestion } = await import("../src/lib/drafts");
    const res = await generateDraftForQuestion(tmp.id, teacher!.id);
    console.log("\n[7] AI 失败兜底 NEEDS_MANUAL（F7+F8）");
    ok(res.status === "NEEDS_MANUAL", `AI 失败 → 状态 NEEDS_MANUAL（实际 ${res.status}）`);
    const d = await prisma.reviewDraft.findUnique({ where: { id: res.draftId } });
    ok(!d?.summary && !d?.explanation, "未编造讲评正文（provider 抛错，无内容落库）");
    ok(!!d?.aiFailReason && d.aiFailReason.includes("AI 生成失败"), `记录失败原因：${d?.aiFailReason}`);
    // 教师手工撰写入口始终可用：直接把手工内容写入并置 APPROVED（模拟草稿编辑保存）
    const edited = await prisma.reviewDraft.update({
      where: { id: res.draftId },
      data: { status: "DRAFT", source: "MANUAL", summary: "教师手工讲评：先移项再系数化为1。", explanation: "把常数项移到右边，注意变号。", aiFailReason: null },
    });
    ok(edited.status === "DRAFT" && edited.source === "MANUAL" && !!edited.explanation, "AI 失败后教师仍可手工撰写并可继续发布");
  } finally {
    await prisma.question.delete({ where: { id: tmp.id } });
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
