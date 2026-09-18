// M6 冒烟：验证学生端取数与越权 404（核心安全不变量）。
// 直接驱动 service 层，越权路径用不同 studentId/reviewId 复现，无需浏览器。
//   npx tsx scripts/m6-verify.ts
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
  const { getMyReviews, getMyReviewDetail, assertStudentCanAct } = await import(
    "../src/lib/student-reviews"
  );
  const { AuthError } = await import("../src/lib/auth-guard");

  // 找一条已发布讲评
  const review = await prisma.publishedReview.findFirst({
    include: { draft: { include: { question: true } } },
  });
  if (!review) throw new Error("数据库里没有任何已发布讲评，先完成 M4/M5 演示");
  const questionId = review.draft.questionId;

  // 该班级里、对该题有作答的学生
  const sub = await prisma.submission.findFirst({ where: { questionId } });
  if (!sub) throw new Error("该题没有任何作答记录");
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: sub.studentId } });
  console.log(`\n讲评 ${review.id} 题目 ${questionId} 所属班级 ${review.classId}`);
  console.log(`有权学生：${owner.loginName}(${owner.id})`);

  // 找一个「在同班但该题无作答」或「不在该班」的学生用于越权测试
  const submittedStudentIds = (
    await prisma.submission.findMany({ where: { questionId }, select: { studentId: true } })
  ).map((s) => s.studentId);
  const enrolledIds = (
    await prisma.classEnrollment.findMany({
      where: { classId: review.classId },
      select: { studentId: true },
    })
  ).map((e) => e.studentId);
  // 优先选「同班但无作答」的学生，其次「不在该班」的学生
  const sameClassNoSub = enrolledIds.filter((id) => !submittedStudentIds.includes(id));
  const notEnrolled = (
    await prisma.user.findMany({ where: { role: "STUDENT" }, select: { id: true } })
  )
    .map((u) => u.id)
    .filter((id) => !enrolledIds.includes(id));
  const notOwnerId = sameClassNoSub[0] ?? notEnrolled[0] ?? null;
  const notOwner = notOwnerId
    ? await prisma.user.findUnique({ where: { id: notOwnerId } })
    : null;

  // 若没有天然越权对象，造一个「同班但无该题作答」的临时学生，跑完删除。
  let tempStudentId: string | null = null;
  let actor = notOwner;
  if (!actor) {
    const tmp = await prisma.user.create({
      data: {
        loginName: "__m6_tmp_" + Date.now(),
        name: "临时越权学生",
        role: "STUDENT",
        passwordHash: "x", // 不走登录，仅测取数授权
        mustChangePassword: false,
      },
    });
    await prisma.classEnrollment.create({
      data: { classId: review.classId, studentId: tmp.id },
    });
    tempStudentId = tmp.id;
    actor = tmp;
    console.log("（已创建同班无作答的临时越权学生 " + tmp.loginName + "）");
  }

  // 1. 有权学生：列表含该讲评
  console.log("\n[1] 有权学生 getMyReviews");
  const list = await getMyReviews(owner.id);
  ok(list.some((x) => x.reviewId === review.id), "列表包含本人应见的讲评");
  ok(
    list.every((x) => x.stemText !== undefined && x.assignmentTitle !== undefined),
    "列表字段完整"
  );

  // 2. 有权学生：详情可读
  console.log("\n[2] 有权学生 getMyReviewDetail");
  const detail = await getMyReviewDetail(owner.id, review.id);
  ok(detail.reviewId === review.id, "返回正确 reviewId");
  ok(detail.myAnswerText === sub.answerText, "含本人作答原文");

  // 3. 越权学生：详情 404
  {
    console.log(`\n[3] 越权学生 ${actor!.loginName} getMyReviewDetail → 期望 404`);
    let code: number | null = null;
    try {
      await getMyReviewDetail(actor!.id, review.id);
    } catch (e) {
      if (e instanceof AuthError) code = e.status;
      else throw e;
    }
    ok(code === 404, "返回 404（非 403，防枚举）");

    console.log(`\n[4] 越权学生 assertStudentCanAct → 期望 404`);
    let c2: number | null = null;
    try {
      await assertStudentCanAct(actor!.id, review.id);
    } catch (e) {
      if (e instanceof AuthError) c2 = e.status;
      else throw e;
    }
    ok(c2 === 404, "不能对他人讲评提交订正/提问，404");

    console.log(`\n[5] 越权学生 getMyReviews 不含该讲评`);
    const otherList = await getMyReviews(actor!.id);
    ok(!otherList.some((x) => x.reviewId === review.id), "列表不泄漏无权讲评");
  }

  // 6. 不存在的 reviewId → 404
  console.log("\n[6] 不存在 reviewId → 404");
  let c3: number | null = null;
  try {
    await getMyReviewDetail(owner.id, "no-such-review-id");
  } catch (e) {
    if (e instanceof AuthError) c3 = e.status;
    else throw e;
  }
  ok(c3 === 404, "不存在返回 404");

  // 7. 学生读路径不触达 ReviewDraft（列表/详情返回体无 draft 字段泄漏）
  console.log("\n[7] 返回体不含草稿内部字段");
  const keys = Object.keys(detail);
  ok(!keys.includes("draft") && !keys.includes("aiFailReason"), "详情无内部草稿字段");

  await prisma.$disconnect();
  if (tempStudentId) {
    const p = new PrismaClient();
    await p.classEnrollment.deleteMany({ where: { studentId: tempStudentId } });
    await p.user.delete({ where: { id: tempStudentId } });
    await p.$disconnect();
    console.log("（已清理临时越权学生）");
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
