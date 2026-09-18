// CSV 解析 + 答题/批改导入校验（PLAN-v2 §5.3 F5）
// 解析支持：双引号包裹、字段内逗号/换行、"" 转义引号、CRLF。

export type CsvRow = { line: number; cells: string[] };

/** 把整段 CSV 文本解析成行数组（含表头行）。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // 去掉 UTF-8 BOM，避免首列表头不匹配
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // 忽略 CR，等待 \n
    } else {
      field += ch;
    }
  }
  // 收尾最后一个字段/行
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type ParsedTable = {
  headers: string[];
  rows: { line: number; record: Record<string, string> }[];
};

/** 解析并映射成以表头为键的记录；返回表头 + 数据行（1-based 物理行号）。 */
export function parseCsvTable(text: string): ParsedTable {
  const raw = parseCsv(text);
  const nonEmpty = raw.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows: ParsedTable["rows"] = [];
  for (let idx = 1; idx < nonEmpty.length; idx++) {
    const cells = nonEmpty[idx];
    const record: Record<string, string> = {};
    headers.forEach((h, c) => {
      record[h] = (cells[c] ?? "").trim();
    });
    rows.push({ line: idx + 1, record });
  }
  return { headers, rows };
}

// ─── 领域校验 ─────────────────────────────────────────

export type ImportContext = {
  /** 本班学生 loginName 集合 */
  studentsByLogin: Map<string, string>; // loginName -> studentId
  /** 本作业题号 seq -> questionId */
  questionsBySeq: Map<number, string>;
  /** 已存在的答题键集合 `${questionId}:${studentId}`；提供则批改要求先有答题 */
  submissionKeys?: Set<string>;
};

export type ValidSubmission = {
  line: number;
  studentId: string;
  questionId: string;
  answerText: string;
};
export type InvalidRow = {
  line: number;
  loginName: string;
  seq: string;
  reason: string;
};

export type ValidateResult<T> = { valid: T[]; invalid: InvalidRow[] };

function missingCols(headers: string[], required: string[]): string[] {
  const set = new Set(headers.map((h) => h.toLowerCase()));
  return required.filter((r) => !set.has(r.toLowerCase()));
}

const SUB_COLS = ["loginName", "seq", "answerText"];

export function validateSubmissions(
  text: string,
  ctx: ImportContext
): ValidateResult<ValidSubmission> {
  const { headers, rows } = parseCsvTable(text);
  const missing = missingCols(headers, SUB_COLS);
  if (missing.length) {
    return {
      valid: [],
      invalid: [{ line: 1, loginName: "", seq: "", reason: `缺少表头列：${missing.join(", ")}` }],
    };
  }
  const valid: ValidSubmission[] = [];
  const invalid: InvalidRow[] = [];
  for (const { line, record } of rows) {
    const loginName = record.loginName ?? "";
    const seqRaw = record.seq ?? "";
    const seq = Number.parseInt(seqRaw, 10);
    const studentId = ctx.studentsByLogin.get(loginName);
    const questionId = ctx.questionsBySeq.get(seq);
    if (!studentId) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "学生不在本班" });
      continue;
    }
    if (!Number.isInteger(seq) || !questionId) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "题号不存在" });
      continue;
    }
    const answerText = record.answerText ?? "";
    if (!answerText) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "答题内容为空" });
      continue;
    }
    valid.push({ line, studentId, questionId, answerText: answerText.slice(0, 2000) });
  }
  return { valid, invalid };
}

const GRADE_COLS = ["loginName", "seq", "verdict"];
const VERDICTS = new Set(["CORRECT", "WRONG", "PARTIAL"]);

export type ValidGrading = {
  line: number;
  studentId: string;
  questionId: string;
  score: number;
  verdict: "CORRECT" | "WRONG" | "PARTIAL";
  teacherNote: string | null;
};

export function validateGrading(
  text: string,
  ctx: ImportContext
): ValidateResult<ValidGrading> {
  const { headers, rows } = parseCsvTable(text);
  const missing = missingCols(headers, GRADE_COLS);
  if (missing.length) {
    return {
      valid: [],
      invalid: [{ line: 1, loginName: "", seq: "", reason: `缺少表头列：${missing.join(", ")}` }],
    };
  }
  const valid: ValidGrading[] = [];
  const invalid: InvalidRow[] = [];
  for (const { line, record } of rows) {
    const loginName = record.loginName ?? "";
    const seqRaw = record.seq ?? "";
    const verdict = (record.verdict ?? "").toUpperCase();
    const studentId = ctx.studentsByLogin.get(loginName);
    const seq = Number.parseInt(seqRaw, 10);
    const questionId = ctx.questionsBySeq.get(seq);
    if (!studentId) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "学生不在本班" });
      continue;
    }
    if (!Number.isInteger(seq) || !questionId) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "题号不存在" });
      continue;
    }
    if (ctx.submissionKeys && !ctx.submissionKeys.has(`${questionId}:${studentId}`)) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "无对应答题记录（请先导入答题）" });
      continue;
    }
    if (!VERDICTS.has(verdict)) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "verdict 须为 CORRECT/WRONG/PARTIAL" });
      continue;
    }
    const score = record.score === "" ? 0 : Number.parseFloat(record.score);
    if (!Number.isFinite(score)) {
      invalid.push({ line, loginName, seq: seqRaw, reason: "分数格式非法" });
      continue;
    }
    valid.push({
      line,
      studentId,
      questionId,
      score,
      verdict: verdict as ValidGrading["verdict"],
      teacherNote: (record.teacherNote ?? "").slice(0, 500) || null,
    });
  }
  return { valid, invalid };
}

export const SUBMISSIONS_TEMPLATE = `loginName,seq,answerText
student01,1,x = 2
student01,2,` ;

export const GRADING_TEMPLATE = `loginName,seq,verdict,score,teacherNote
student01,1,CORRECT,5,
student02,1,WRONG,0,移项未变号`;
