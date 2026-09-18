import { NextResponse } from "next/server";
import { prisma } from "./db";
import { requireRole, assertTeacherOwnsAssignment, AuthError } from "./auth-guard";
import { checkCsrfFromRequest } from "./csrf";
import type { ImportContext } from "./csv";

const MAX_BYTES = 500 * 1024; // ≤ 500KB
const MAX_ROWS = 5000;

export type Guard =
  | { err: NextResponse }
  | { user: Awaited<ReturnType<typeof requireRole>>; assignment: NonNullable<Awaited<ReturnType<typeof assertTeacherOwnsAssignment>>> };

/** 教师 + 归属校验 + CSRF（POST）。失败返回一个可直接 return 的响应。 */
export async function guardTeacherAssignment(
  req: Request,
  assignmentId: string,
  csrf: boolean
): Promise<Guard> {
  if (csrf && !checkCsrfFromRequest(req)) {
    return { err: NextResponse.json({ error: "CSRF 校验失败" }, { status: 403 }) };
  }
  try {
    const user = await requireRole("TEACHER");
    const assignment = await assertTeacherOwnsAssignment(user, assignmentId);
    return { user, assignment };
  } catch (e) {
    if (e instanceof AuthError) {
      return { err: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e;
  }
}

/** 解析 { csv, onlyValid } 并做体积/行数闸门。 */
export async function readCsvBody(req: Request): Promise<
  { err: NextResponse } | { csv: string; onlyValid: boolean }
> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { err: NextResponse.json({ error: "请求体必须为 JSON" }, { status: 400 }) };
  }
  const csv = (json as { csv?: unknown })?.csv;
  const onlyValid = Boolean((json as { onlyValid?: unknown })?.onlyValid);
  if (typeof csv !== "string" || csv.trim() === "") {
    return { err: NextResponse.json({ error: "CSV 内容为空" }, { status: 400 }) };
  }
  if (Buffer.byteLength(csv, "utf8") > MAX_BYTES) {
    return { err: NextResponse.json({ error: "文件超过 500KB 上限" }, { status: 413 }) };
  }
  const lines = csv.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
  if (lines.length - 1 > MAX_ROWS) {
    return { err: NextResponse.json({ error: `数据行数超过 ${MAX_ROWS} 上限` }, { status: 413 }) };
  }
  return { csv, onlyValid };
}

/** 构造导入校验上下文：本班学生 + 本题号；批改额外要求已存在答题。 */
export async function buildImportContext(
  assignmentId: string,
  requireSubmission: boolean
): Promise<ImportContext> {
  const [enrollments, questions, submissions] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { class: { assignments: { some: { id: assignmentId } } } },
      include: { student: { select: { id: true, loginName: true } } },
    }),
    prisma.question.findMany({
      where: { assignmentId },
      select: { id: true, seq: true },
    }),
    requireSubmission
      ? prisma.submission.findMany({
          where: { question: { assignmentId } },
          select: { questionId: true, studentId: true },
        })
      : Promise.resolve([]),
  ]);

  const studentsByLogin = new Map<string, string>();
  enrollments.forEach((e) => studentsByLogin.set(e.student.loginName, e.student.id));
  const questionsBySeq = new Map<number, string>();
  questions.forEach((q) => questionsBySeq.set(q.seq, q.id));
  const submissionKeys = new Set(submissions.map((s) => `${s.questionId}:${s.studentId}`));

  return {
    studentsByLogin,
    questionsBySeq,
    submissionKeys: requireSubmission ? submissionKeys : undefined,
  };
}

export function report<T>(valid: T[], invalid: { line: number; reason: string }[]) {
  return {
    total: valid.length + invalid.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    invalid: invalid.slice(0, 50),
    preview: valid.slice(0, 10),
  };
}
