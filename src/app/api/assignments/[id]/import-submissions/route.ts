import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardTeacherAssignment, readCsvBody, buildImportContext, report } from "@/lib/import-api";
import { validateSubmissions } from "@/lib/csv";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await guardTeacherAssignment(req, params.id, true);
  if ("err" in g) return g.err;
  const b = await readCsvBody(req);
  if ("err" in b) return b.err;

  const ctx = await buildImportContext(params.id, false);
  const { valid, invalid } = validateSubmissions(b.csv, ctx);

  if (invalid.length > 0 && !b.onlyValid) {
    return NextResponse.json(
      { error: "存在校验失败的行，请处理后再提交", report: report(valid, invalid) },
      { status: 422 }
    );
  }

  let imported = 0;
  let updated = 0;
  for (const v of valid) {
    const existing = await prisma.submission.findUnique({
      where: { questionId_studentId: { questionId: v.questionId, studentId: v.studentId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.submission.update({
        where: { id: existing.id },
        data: { answerText: v.answerText, submittedAt: new Date() },
      });
      updated++;
    } else {
      await prisma.submission.create({
        data: { questionId: v.questionId, studentId: v.studentId, answerText: v.answerText },
      });
      imported++;
    }
  }
  await writeAudit({
    actorId: g.user.id,
    action: "import.submissions",
    entity: "Assignment",
    entityId: params.id,
    before: null,
    after: `写入 ${imported + updated} 条答题（新建 ${imported} / 更新 ${updated}）`,
  });
  return NextResponse.json({
    ok: true,
    imported,
    updated,
    skipped: invalid.length,
  });
}
