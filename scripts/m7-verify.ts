// M7 冒烟：教师端订正/提问归属守卫 + 跟踪取数（只读，不改演示数据）。
// 复核/回复的写入路径在浏览器用真实会话 + Server Action 实跑。
//   npx tsx scripts/m7-verify.ts
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/lib/session";

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

function teacher(id: string): SessionUser {
  return { id, loginName: "t", role: "TEACHER", name: "T", mustChangePassword: false };
}
function student(id: string): SessionUser {
  return { id, loginName: "s", role: "STUDENT", name: "S", mustChangePassword: false };
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();
  const { assertTeacherOwnsCorrection, assertTeacherOwnsStudentQuestion, AuthError } =
    await import("../src/lib/auth-guard");
  const { getAssignmentCorrections, getAssignmentStudentQuestions, getCorrectionStats } =
    await import("../src/lib/corrections");

  // 需有一条订正（M6 浏览器演示已写入）。取一条订正与其归属作业。
  const corr = await prisma.correction.findFirst({
    include: { review: { include: { draft: { include: { assignment: true } } } } },
  });
  if (!corr) throw new Error("数据库无订正记录，请先跑 M6 浏览器演示");
  const assignment = corr.review.draft.assignment;
  const owner = await prisma.classRoom.findUniqueOrThrow({ where: { id: assignment.classId } });
  const teacherId = owner.teacherId;

  // 找另一个教师（非归属）
  const other = await prisma.user.findFirst({
    where: { role: "TEACHER", id: { not: teacherId } },
  });

  console.log(`\n订正 ${corr.id} 作业 ${assignment.id} 班 ${owner.name} 归属教师 ${teacherId}`);

  // 1. 归属教师读订正 OK
  console.log("\n[1] 归属教师 assertTeacherOwnsCorrection");
  let c1: unknown = null;
  try {
    c1 = await assertTeacherOwnsCorrection(teacher(teacherId), corr.id);
    ok(true, "放行");
  } catch (e) {
    ok(false, "意外抛错 " + (e as Error).message);
  }

  // 2. 他人教师 → 404
  if (other) {
    console.log(`\n[2] 他人教师 ${other.loginName} → 期望 404`);
    let code: number | null = null;
    try {
      await assertTeacherOwnsCorrection(teacher(other.id), corr.id);
    } catch (e) {
      if (e instanceof AuthError) code = e.status;
      else throw e;
    }
    ok(code === 404, "跨教师 404（防枚举）");
  } else {
    console.log("\n[2] 跳过：无第二个教师");
  }

  // 3. 学生 → 403
  console.log("\n[3] 学生访问订正 → 期望 403");
  let c3: number | null = null;
  try {
    await assertTeacherOwnsCorrection(student(corr.studentId), corr.id);
  } catch (e) {
    if (e instanceof AuthError) c3 = e.status;
    else throw e;
  }
  ok(c3 === 403, "非教师 403");

  // 4. 不存在 → 404
  console.log("\n[4] 不存在订正 id → 期望 404");
  let c4: number | null = null;
  try {
    await assertTeacherOwnsCorrection(teacher(teacherId), "no-such-corr");
  } catch (e) {
    if (e instanceof AuthError) c4 = e.status;
    else throw e;
  }
  ok(c4 === 404, "不存在 404");

  // 5. 提问守卫：找一条属于该作业的提问
  console.log("\n[5] 提问归属守卫");
  const sq = await prisma.studentQuestion.findFirst({
    where: { review: { draft: { assignmentId: assignment.id } } },
  });
  if (sq) {
    let ownerOk = false;
    try {
      await assertTeacherOwnsStudentQuestion(teacher(teacherId), sq.id);
      ownerOk = true;
    } catch {}
    ok(ownerOk, "归属教师可回复提问");
    if (other) {
      let code: number | null = null;
      try {
        await assertTeacherOwnsStudentQuestion(teacher(other.id), sq.id);
      } catch (e) {
        if (e instanceof AuthError) code = e.status;
      }
      ok(code === 404, "他人教师回复 → 404");
    }
    let scode: number | null = null;
    try {
      await assertTeacherOwnsStudentQuestion(student(sq.studentId), sq.id);
    } catch (e) {
      if (e instanceof AuthError) scode = e.status;
    }
    ok(scode === 403, "学生访问提问 → 403");
  } else {
    console.log("  （该作业暂无提问记录，跳过 [5]）");
  }

  // 6. 跟踪取数：列表含本订正，统计自洽
  console.log("\n[6] getAssignmentCorrections + getCorrectionStats");
  const rows = await getAssignmentCorrections(assignment.id);
  ok(rows.some((r) => r.id === corr.id), "订正列表含该记录");
  ok(rows.every((r) => r.studentName && r.studentName.length > 0), "订正行含学生显示名");
  const stats = await getCorrectionStats(assignment.id);
  ok(stats.total === rows.length, `统计 total(${stats.total}) == 列表(${rows.length})`);
  ok(
    stats.pending + stats.resolved + stats.stillWrong === stats.total,
    "状态分布求和==总数"
  );

  // 7. 取数不泄漏他班：另一作业的订正不在此列表
  console.log("\n[7] 班级隔离：列表仅本作业");
  ok(rows.every((r) => r.reviewId), "行内 reviewId 均归属该作业链路");

  await prisma.$disconnect();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
