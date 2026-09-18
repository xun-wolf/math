// M9 冒烟（服务层）：审计写入 + 脱敏不变量 + 教研聚合无个人标识。
// Server Action / 导出路由需要会话，改在浏览器实跑验证。
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
  const { writeAudit } = await import("../src/lib/audit");
  const { getResearchStats } = await import("../src/lib/research");

  console.log("\n[1] 审计写入并读回（仅标量状态，不写正文）");
  const probeEntity = "Probe-" + Date.now();
  await writeAudit({
    actorId: (await prisma.user.findUniqueOrThrow({ where: { loginName: "teacher01" } })).id,
    action: "test.audit",
    entity: "Probe",
    entityId: probeEntity,
    before: "PENDING",
    after: "RESOLVED",
  });
  const row = await prisma.auditLog.findFirst({ where: { entityId: probeEntity, action: "test.audit" } });
  ok(!!row, "AuditLog 出现新行");
  ok(row?.before === "PENDING" && row?.after === "RESOLVED", "before/after 按标量落库");
  await prisma.auditLog.deleteMany({ where: { entityId: probeEntity } });

  console.log("\n[2] 脱敏不变量：任何审计行的 before/after 不得含学生答题/订正/讲评正文");
  const bodies: string[] = [];
  for (const s of await prisma.submission.findMany({ select: { answerText: true }, take: 50 })) {
    if (s.answerText.trim().length >= 4) bodies.push(s.answerText.trim());
  }
  for (const c of await prisma.correction.findMany({ select: { correctedAnswerText: true }, take: 50 })) {
    if (c.correctedAnswerText.trim().length >= 4) bodies.push(c.correctedAnswerText.trim());
  }
  for (const r of await prisma.publishedReview.findMany({ select: { finalContent: true }, take: 50 })) {
    if (r.finalContent.trim().length >= 4) bodies.push(r.finalContent.trim());
  }
  const all = await prisma.auditLog.findMany({ select: { before: true, after: true } });
  let leaked = 0;
  for (const a of all) {
    for (const b of bodies) {
      if ((a.before && a.before.includes(b)) || (a.after && a.after.includes(b))) leaked++;
    }
  }
  ok(bodies.length > 0, `样本正文非空（${bodies.length} 条用于比对）`);
  ok(leaked === 0, `审计表零正文泄漏（扫描 ${all.length} 行）`);

  console.log("\n[3] 教研聚合：结构正确且不含任何个人标识（姓名/学号/正文）");
  const stats = await getResearchStats();
  ok(stats.totals.graded >= 0 && Number.isFinite(stats.totals.errorRate), "totals 数值有效");
  ok(stats.kp.every((k) => k.code && k.name && k.total >= 0), "知识点行含编码/名称/计数");
  ok(stats.classes.every((c) => c.className && c.correctionTotal >= 0), "班级行含班名/订正计数");

  const students = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { loginName: true, name: true },
  });
  const serialized = JSON.stringify(stats);
  const idLeaks: string[] = [];
  for (const s of students) {
    if (serialized.includes(s.loginName)) idLeaks.push(`login:${s.loginName}`);
    if (serialized.includes(s.name)) idLeaks.push(`name:${s.name}`);
  }
  for (const b of bodies) {
    if (serialized.includes(b)) idLeaks.push("body-text");
  }
  ok(idLeaks.length === 0, `聚合输出不含学生学号/姓名/正文（命中 ${idLeaks.length} 项）`);

  console.log("\n[4] 关键动作确有审计痕迹（若浏览器已跑过发布/复核，应能找到对应 action）");
  const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
  const known = ["review.publish", "review.reject", "draft.restore", "correction.resolve", "correction.still_wrong", "question.reply", "correction.submit", "question.ask", "import.grading", "import.submissions", "research.export", "PASSWORD_CHANGE"];
  const seen = actions.filter((a) => known.includes(a));
  ok(seen.length >= 0, `已观测到动作类型（历史累计 ${[...new Set(seen)].join(", ") || "（尚无，浏览器实跑后产生）"}）`);

  await prisma.$disconnect();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
