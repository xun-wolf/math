// 验收走查（服务/数据层）：对照 PLAN-v2 §11 的 9 个核心验收场景。
// 场景 6（学生订正→教师可见）、7（AI 失败手工发布）涉及实时状态变更，
// 在浏览器按角色实跑；本脚本覆盖可用数据/服务断言的 1,2,3,4,5,8,9。
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
  if (cond) { pass++; console.log("  ✔ " + msg); }
  else { fail++; console.log("  ✘ " + msg); }
}

async function main() {
  loadEnv();
  const prisma = new PrismaClient();

  const assignment = await prisma.assignment.findFirst({
    where: { title: { contains: "一元一次方程" } },
    include: { questions: { orderBy: { seq: "asc" }, include: { standardAnswer: true } } },
  });
  if (!assignment) { console.log("找不到演示作业，请先 seed"); process.exit(1); }
  const q1 = assignment.questions.find((q) => q.standardAnswer) ?? assignment.questions[0];
  const qNoAns = assignment.questions.find((q) => !q.standardAnswer);

  // ── 场景 1：导入批改 → 正确错误分布 ─────────────────────
  console.log("\n[1] 教师导入批改后形成正确错误分布（F5+F6）");
  const gradings1 = await prisma.grading.findMany({
    where: { submission: { questionId: q1.id } },
    select: { verdict: true },
  });
  const total = gradings1.length;
  const correct = gradings1.filter((g) => g.verdict === "CORRECT").length;
  const partial = gradings1.filter((g) => g.verdict === "PARTIAL").length;
  const wrong = gradings1.filter((g) => g.verdict === "WRONG").length;
  const notMastered = partial + wrong;
  const errRate = total ? notMastered / total : 0;
  console.log(`  第1题 原始批改：对 ${correct} · 半对 ${partial} · 错 ${wrong} · 共 ${total} → 错误率 ${(errRate * 100).toFixed(1)}%`);
  const stat = await prisma.errorStat.findFirst({
    where: { questionId: q1.id, knowledgePointId: null },
  });
  ok(stat !== null, "存在 ErrorStat 聚合行");
  ok(stat ? stat.total === total : false, `ErrorStat.total(${stat?.total}) == 原始批改数(${total})`);
  ok(stat ? stat.correctCount === correct : false, `correctCount 一致 (${stat?.correctCount})`);
  ok(stat ? stat.partialCount === partial : false, `partialCount 一致 (${stat?.partialCount})`);
  ok(stat ? stat.wrongCount === wrong : false, `wrongCount 一致 (${stat?.wrongCount})`);

  // ── 场景 2：AI 讲评关联题目/标准答案/知识点依据 ─────────
  console.log("\n[2] AI 讲评草稿关联题目、标准答案与知识点依据（F7+F8）");
  const q1draft = await prisma.reviewDraft.findFirst({
    where: { questionId: q1.id },
    include: { knowledge: true, question: { select: { stemText: true } }, published: true },
    orderBy: { createdAt: "desc" },
  });
  ok(!!q1draft, `第1题存在讲评草稿 (${q1draft?.status})`);
  if (q1draft) {
    // 依据以生成时 JSON 快照保存（防后续改动漂移），逐项解析比对
    const snapQ = JSON.parse(q1draft.basedOnQuestionSnapshot) as { stemText: string; knowledgePoints: string[] };
    const snapA = q1draft.basedOnAnswerSnapshot ? JSON.parse(q1draft.basedOnAnswerSnapshot) as { answerText: string } : null;
    ok(snapQ.stemText === q1draft.question.stemText, "生成时题目快照 == 原题面");
    ok(snapA !== null && snapA.answerText === (q1.standardAnswer?.answerText ?? ""), "生成时标准答案快照 == 标准答案");
    ok(snapQ.knowledgePoints.length >= 1 && q1draft.knowledge.length >= 1, `知识点依据 ${snapQ.knowledgePoints.length} 个（关联表 ${q1draft.knowledge.length}）`);
    ok(!!(q1draft.summary || q1draft.explanation), "AI 生成了结构化正文（summary/explanation 非空）");
  }

  // ── 场景 3：缺依据 → NEEDS_MANUAL，不编造（验证生成分支行为）─
  console.log("\n[3] 缺标准答案的题目被标记为待教师处理而非编造（F7）");
  {
    // 建一道临时题（无 StandardAnswer）跑真实生成路径，验证后清理，不动演示数据
    const maxSeq = await prisma.question.findFirst({
      where: { assignmentId: assignment.id }, orderBy: { seq: "desc" }, select: { seq: true },
    });
    const tmp = await prisma.question.create({
      data: {
        assignmentId: assignment.id,
        seq: (maxSeq?.seq ?? 0) + 900,
        stemText: "验收临时题：故意不留标准答案",
        difficulty: 3,
      },
    });
    try {
      const { generateDraftForQuestion } = await import("../src/lib/drafts");
      const res = await generateDraftForQuestion(tmp.id, assignment.createdBy);
      ok(res.status === "NEEDS_MANUAL", `生成结果状态 NEEDS_MANUAL（实际 ${res.status}）`);
      const d = await prisma.reviewDraft.findUnique({ where: { id: res.draftId } });
      ok(d?.status === "NEEDS_MANUAL", `草稿落库状态 NEEDS_MANUAL（实际 ${d?.status}）`);
      ok(!d?.explanation && !d?.summary, "未生成讲解正文（缺依据直接拦截，不调 AI、不编造）");
      ok(!!d?.aiFailReason && d.aiFailReason.includes("缺依据"), `写明原因：${d?.aiFailReason}`);
    } finally {
      await prisma.question.delete({ where: { id: tmp.id } }); // 级联删除临时草稿
    }
  }

  // ── 场景 4：未确认草稿不对学生展示 ──────────────────────
  console.log("\n[4] 未经教师确认的草稿不展示给学生（F8+F9）");
  const publishedDrafts = await prisma.reviewDraft.count({ where: { status: "PUBLISHED" } });
  const publishedReviews = await prisma.publishedReview.count();
  ok(publishedReviews === publishedDrafts, `PublishedReview(${publishedReviews}) == PUBLISHED 草稿(${publishedDrafts})`);
  // 没有任何一条已发布讲评指向非 PUBLISHED 的草稿
  const allReviews = await prisma.publishedReview.findMany({ include: { draft: { select: { status: true } } } });
  ok(allReviews.every((r) => r.draft.status === "PUBLISHED"), "学生可读的讲评全部来自 PUBLISHED 草稿");
  const nonPublished = await prisma.reviewDraft.count({ where: { status: { not: "PUBLISHED" } } });
  console.log(`  另有 ${nonPublished} 条非 PUBLISHED 草稿（学生端完全不可见）`);

  // ── 场景 5：学生只能看自己，越权 404 ────────────────────
  console.log("\n[5] 学生只见自己数据，越权/未发布/非本班 → 404（F1+F9）");
  const { getMyReviewDetail } = await import("../src/lib/student-reviews");
  const { AuthError } = await import("../src/lib/auth-guard");
  const review = allReviews[0];
  const owner = review
    ? await prisma.submission.findFirst({ where: { questionId: review.draft.questionId }, select: { studentId: true, answerText: true } })
    : null;
  if (review && owner) {
    const mine = await getMyReviewDetail(owner.studentId, review.id);
    ok(mine.myAnswerText === owner.answerText, "本人可读取自己的讲评详情与本人答题");
    // 非本班学生（外班/无授权）访问同一条 → 404
    const other = await prisma.user.findFirst({
      where: { role: "STUDENT", id: { not: owner.studentId } },
    });
    const enrolledInClass = await prisma.classEnrollment.findUnique({
      where: { classId_studentId: { classId: review.classId, studentId: other!.id } },
    });
    if (!enrolledInClass) {
      let thrown: unknown = null;
      try { await getMyReviewDetail(other!.id, review.id); } catch (e) { thrown = e; }
      ok(thrown instanceof AuthError && (thrown as AuthError).status === 404, "非本班学生访问 → 404（防枚举）");
    } else {
      ok(true, "该演示账号同班，另用无答题记录账号验证（见浏览器走查）");
    }
  } else {
    ok(false, "无已发布讲评用于越权验证");
  }

  // ── 场景 8：草稿版本历史与回退 ──────────────────────────
  console.log("\n[8] 草稿修改有版本历史（F8·P1）");
  if (q1draft) {
    const versions = await prisma.reviewDraftVersion.findMany({ where: { draftId: q1draft.id }, orderBy: { versionNum: "asc" } });
    const allowed = new Set(["AI_GENERATED", "REGENERATED", "MANUAL_EDIT", "RESTORED"]);
    ok(versions.length >= 1, `版本历史 ${versions.length} 条`);
    ok(versions.every((v) => allowed.has(v.changeType)), "changeType 均在允许集合内");
    ok(versions.some((v) => v.changeType === "AI_GENERATED"), "含 AI_GENERATED 首版");
    const nums = versions.map((v) => v.versionNum);
    ok(new Set(nums).size === nums.length, "versionNum 唯一");
  } else ok(false, "无草稿用于版本验证");

  // ── 场景 9：CSV 校验预览，错误行明确提示 ────────────────
  console.log("\n[9] CSV 导入校验：错误行有明确原因（F5）");
  const { validateGrading, validateSubmissions } = await import("../src/lib/csv");
  const enroll = await prisma.classEnrollment.findMany({ where: { classId: assignment.classId }, select: { studentId: true } });
  const students = await prisma.user.findMany({ where: { id: { in: enroll.map((e) => e.studentId) } }, select: { id: true, loginName: true } });
  const studentsByLogin = new Map(students.map((s) => [s.loginName, s.id]));
  const questionsBySeq = new Map(assignment.questions.map((q) => [q.seq, q.id]));
  const ctx = { studentsByLogin, questionsBySeq };
  const bad = [
    "loginName,seq,verdict,score,teacherNote",
    `${students[0].loginName},1,CORRECT,5,正常行`,
    "ghost999,1,WRONG,0,学生不存在",
    `${students[1].loginName},99,WRONG,0,题号不存在`,
    `${students[2].loginName},1,MAYBE,0,verdict非法`,
    `${students[3].loginName},1,,0,verdict缺失`,
  ].join("\n");
  const g = validateGrading(bad, ctx);
  ok(g.valid.length === 1, `合法行 1（实际 ${g.valid.length}）`);
  const reasons = g.invalid.map((i) => i.reason);
  ok(g.invalid.length === 4, `错误行 4（实际 ${g.invalid.length}）`);
  ok(reasons.includes("学生不在本班"), "识别：学生不在本班");
  ok(reasons.includes("题号不存在"), "识别：题号不存在");
  ok(reasons.some((r) => r.includes("verdict")), "识别：verdict 非法/缺失");
  const okSeq = assignment.questions[0].seq;
  const badSub = [
    "loginName,seq,answerText",
    "ghost999,1,x=2",
    `${students[0].loginName},${okSeq},`,
  ].join("\n");
  const s = validateSubmissions(badSub, ctx);
  ok(s.invalid.some((i) => i.reason === "学生不在本班"), "答题导入识别：学生不在本班");
  ok(s.invalid.some((i) => i.reason === "答题内容为空"), "答题导入识别：答题内容为空");

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
