import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-guard";
import { getResearchStats } from "@/lib/research";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 去标识化教研导出（CSV）。
 * 仅输出知识点 / 班级两级聚合，含匿名序号；绝不包含学生姓名、学号、答题或订正正文。
 */
export async function GET() {
  let user;
  try {
    user = await requireRole("RESEARCHER");
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const { kp, classes, totals } = await getResearchStats();
  const pct = (n: number) => (Math.round(n * 1000) / 10).toFixed(1);

  const lines: string[] = [];
  lines.push("# 去标识化教研导出：仅知识点/班级聚合，不含学生姓名、学号与答题正文");
  lines.push(`# 生成时间,${new Date().toISOString()}`);
  lines.push(`# 全局,批改记录,${totals.graded},未掌握,${totals.notMastered},错误率%,${pct(totals.errorRate)},订正记录,${totals.correctionTotal},掌握率%,${pct(totals.masteryRate)}`);
  lines.push("");
  lines.push("[知识点错误率（跨班）]");
  lines.push("序号,知识点编码,知识点名称,批改次数,未掌握次数,错误率%");
  kp.forEach((k, i) => {
    lines.push([i + 1, csvCell(k.code), csvCell(k.name), k.total, k.notMastered, pct(k.errorRate)].join(","));
  });
  lines.push("");
  lines.push("[班级订正掌握]");
  lines.push("序号,班级,批改次数,错误率%,订正总数,已掌握,仍需订正,待复核,掌握率%");
  classes.forEach((c, i) => {
    lines.push(
      [
        i + 1,
        csvCell(c.className),
        c.graded,
        pct(c.errorRate),
        c.correctionTotal,
        c.resolved,
        c.stillWrong,
        c.pending,
        pct(c.masteryRate),
      ].join(",")
    );
  });

  await writeAudit({
    actorId: user.id,
    action: "research.export",
    entity: "Research",
    entityId: "de-identified-csv",
    before: null,
    after: `kp=${kp.length};classes=${classes.length}`,
  });

  const csv = "" + lines.join("\r\n"); // BOM 便于 Excel 正确识别 UTF-8
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="research-deidentified.csv"',
      "Cache-Control": "no-store",
    },
  });
}
