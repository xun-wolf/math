import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardTeacherAssignment, readCsvBody, buildImportContext, report } from "@/lib/import-api";
import { validateGrading } from "@/lib/csv";
import { recomputeErrorStats } from "@/lib/stats";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guardTeacherAssignment(req, params.id, true);
  if ("err" in g) return g.err;
  const b = await readCsvBody(req);
  if ("err" in b) return b.err;

  const ctx = await buildImportContext(params.id, true);
  const { valid, invalid } = validateGrading(b.csv, ctx);

  if (invalid.length > 0 && !b.onlyValid) {
    return NextResponse.json(
      { error: "存在校验失败的行，请处理后再提交", report: report(valid, invalid) },
      { status: 422 }
    );
  }

  let imported = 0;
  let updated = 0;
  for (const v of valid) {
    const sub = await prisma.submission.findUnique({
      where: { questionId_studentId: { questionId: v.questionId, studentId: v.studentId } },
      select: { id: true, grading: { select: { id: true } } },
    });
    if (!sub) continue; // 已由校验拦截，双保险
    const data = {
      score: v.score,
      verdict: v.verdict,
      teacherNote: v.teacherNote,
      teacherId: g.user.id,
      gradedAt: new Date(),
    };
    if (sub.grading) {
      await prisma.grading.update({ where: { submissionId: sub.id }, data });
      updated++;
    } else {
      await prisma.grading.create({ data: { submissionId: sub.id, ...data } });
      imported++;
    }
  }

  const statRows = await recomputeErrorStats(params.id);
  await writeAudit({
    actorId: g.user.id,
    action: "import.grading",
    entity: "Assignment",
    entityId: params.id,
    before: null,
    after: `写入 ${imported + updated} 条批改（新建 ${imported} / 更新 ${updated}）`,
  });
  return NextResponse.json({ ok: true, imported, updated, skipped: invalid.length, statRows });
}
