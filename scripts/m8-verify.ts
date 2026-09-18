// M8 冒烟（服务层）：AI 订正点评建议的三条分支——正常 / 缺依据不调 AI / 不存在。
// MOCK_AI_FAIL 兜底单独跑：MOCK_AI_FAIL=true npx tsx scripts/m8-verify.ts
// 版本回退属 Server Action（需会话），在浏览器实跑验证。
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

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

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("  ✔ " + msg);
  } else {
    fail++;
    console.log("  ✘ " + msg);
  }
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  const { suggestCorrectionAdvice } = await import("../src/lib/corrections");

  const failMode = process.env.MOCK_AI_FAIL === "true";

  // 找一条「题目有标准答案 + rubric」的订正 → 正常/失败兜底用例
  const goodCorr = await prisma.correction.findFirst({
    where: { review: { draft: { question: { standardAnswer: { rubricText: { not: "" } } } } } },
    include: { review: { include: { draft: { include: { question: { include: { standardAnswer: true } } } } } } },
  });

  if (failMode) {
    console.log("\n[MOCK_AI_FAIL] Provider 抛错 → 应兜底为 NEEDS_MANUAL，不抛异常");
    if (!goodCorr) throw new Error("无可测订正");
    const r = await suggestCorrectionAdvice(goodCorr.id);
    ok(r.status === "NEEDS_MANUAL", "返回 NEEDS_MANUAL（未抛错）");
    ok(r.status === "NEEDS_MANUAL" && r.reason.includes("AI 建议不可用"), "原因含「AI 建议不可用」");
    await prisma.$disconnect();
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    if (fail > 0) process.exit(1);
    return;
  }

  console.log("\n[1] 正常：有依据的订正 → AI 点评建议");
  if (!goodCorr) throw new Error("数据库无「含 rubric 的订正」，先跑 M6/M7 演示");
  const r1 = await suggestCorrectionAdvice(goodCorr.id);
  ok(r1.status === "OK", "返回 OK");
  ok(r1.status === "OK" && r1.advice.trim().length > 10, "建议正文非空");
  ok(r1.status === "OK" && r1.modelTag.includes("mock"), "modelTag 来自 mock provider");
  ok(
    r1.status === "OK" && (r1.advice.includes("点评建议") || r1.advice.includes("订正")),
    "建议含讲评语义（面向教师复核）"
  );

  console.log("\n[2] 缺依据：题目无标准答案 → 不调 AI，NEEDS_MANUAL");
  // 造临时链：question(无答案) → draft → publishedReview → correction，测后删除
  const teacher = await prisma.user.findUniqueOrThrow({ where: { loginName: "teacher01" } });
  const cls = await prisma.classRoom.findFirstOrThrow({ where: { teacherId: teacher.id } });
  const asg = await prisma.assignment.findFirstOrThrow({ where: { classId: cls.id } });
  const maxSeq = (await prisma.question.findFirst({
    where: { assignmentId: asg.id },
    orderBy: { seq: "desc" },
    select: { seq: true },
  }))?.seq ?? 0;
  const tQ = await prisma.question.create({
    data: { assignmentId: asg.id, seq: maxSeq + 900, stemText: "临时缺依据题", difficulty: 3 },
  });
  const tDraft = await prisma.reviewDraft.create({
    data: {
      questionId: tQ.id,
      assignmentId: asg.id,
      status: "PUBLISHED",
      source: "MANUAL",
      basedOnQuestionSnapshot: "{}",
      basedOnAnswerSnapshot: null,
      basedOnErrorSummary: "无",
      summary: "s",
      explanation: "e",
    },
  });
  const tReview = await prisma.publishedReview.create({
    data: { draftId: tDraft.id, classId: cls.id, finalContent: "讲评", publishedBy: teacher.id },
  });
  const enr = await prisma.classEnrollment.findFirst({ where: { classId: cls.id } });
  if (!enr) throw new Error("该班无学生，无法测缺依据用例");
  const anyStudent = enr.studentId;
  const tCorr = await prisma.correction.create({
    data: { publishedReviewId: tReview.id, studentId: anyStudent, correctedAnswerText: "我的订正", status: "PENDING" },
  });
  const r2 = await suggestCorrectionAdvice(tCorr.id);
  ok(r2.status === "NEEDS_MANUAL", "缺依据 → NEEDS_MANUAL");
  ok(r2.status === "NEEDS_MANUAL" && r2.reason.includes("缺依据"), "原因含「缺依据」");

  console.log("\n[3] 不存在订正 id → NEEDS_MANUAL（不抛异常）");
  const r3 = await suggestCorrectionAdvice("no-such-correction");
  ok(r3.status === "NEEDS_MANUAL" && r3.reason.includes("不存在"), "返回「订正记录不存在」");

  // 清理临时链（逆序）
  await prisma.correction.delete({ where: { id: tCorr.id } });
  await prisma.publishedReview.delete({ where: { id: tReview.id } });
  await prisma.reviewDraft.delete({ where: { id: tDraft.id } });
  await prisma.question.delete({ where: { id: tQ.id } });
  console.log("（已清理临时缺依据链）");

  await prisma.$disconnect();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
