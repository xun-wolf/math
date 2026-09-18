import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardTeacherAssignment } from "@/lib/import-api";

function csvCell(s: string | number): string {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// 由 loginName 尾部数字派生一个稳定的伪随机种子
function seedOf(loginName: string): number {
  const m = loginName.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : loginName.length;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await guardTeacherAssignment(req, params.id, false);
  if ("err" in g) return g.err;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "grading" ? "grading" : "submissions";

  const [questions, enrollments] = await Promise.all([
    prisma.question.findMany({
      where: { assignmentId: params.id },
      orderBy: { seq: "asc" },
      select: { seq: true },
    }),
    prisma.classEnrollment.findMany({
      where: { classId: g.assignment.classId },
      orderBy: { joinedAt: "asc" },
      include: { student: { select: { loginName: true } } },
    }),
  ]);

  const lines: string[] = [];
  if (questions.length === 0) {
    return new NextResponse("loginName,seq,answerText\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  if (type === "submissions") {
    lines.push("loginName,seq,answerText");
    for (const e of enrollments) {
      for (const q of questions) {
        lines.push([e.student.loginName, q.seq, `作答：x=${(seedOf(e.student.loginName) + q.seq) % 5}`].map(csvCell).join(","));
      }
    }
  } else {
    lines.push("loginName,seq,verdict,score,teacherNote");
    const lastSeq = questions[questions.length - 1].seq;
    for (const e of enrollments) {
      const seed = seedOf(e.student.loginName);
      for (const q of questions) {
        const r = (seed * 37 + q.seq * 101) % 100;
        // 最后一题高错误率，其余混合
        const thresholdWrong = q.seq === lastSeq ? 72 : 28;
        const thresholdPartial = q.seq === lastSeq ? 84 : 52;
        let verdict = "CORRECT";
        let score = 5;
        let note = "";
        if (r < thresholdWrong) {
          verdict = "WRONG";
          score = 0;
          note = "关键步骤/符号出错";
        } else if (r < thresholdPartial) {
          verdict = "PARTIAL";
          score = 2;
          note = "过程正确，结果计算失误";
        }
        lines.push([e.student.loginName, q.seq, verdict, score, note].map(csvCell).join(","));
      }
    }
  }

  const filename = type === "grading" ? "grading-sample.csv" : "submissions-sample.csv";
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
