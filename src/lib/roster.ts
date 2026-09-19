import { prisma } from "./db";

// 教师端「错题明细」：让带班老师看到本班具体哪个学生错了哪道题。
// 授权由调用页面用 assertTeacherOwnsAssignment 保证（跨班 404），
// 这里按 assignmentId 取数，assignment→class.teacherId 链已在守卫里校验。
// 定位：错因辅导名单，不是成绩排行；只出教师自己班数据，学生/教研端不暴露。

export type WrongStudent = {
  studentId: string;
  studentName: string;
  verdict: "WRONG" | "PARTIAL";
  answerText: string;
  teacherNote: string | null;
};

export type QuestionRoster = {
  questionId: string;
  seq: number;
  stemText: string;
  hasAnswer: boolean;
  wrong: number;
  partial: number;
  knowledgePoints: { code: string; name: string }[];
  students: WrongStudent[];
};

export type StudentErrorItem = {
  questionId: string;
  seq: number;
  verdict: "WRONG" | "PARTIAL";
  teacherNote: string | null;
  knowledgePoints: { code: string; name: string }[];
};

export type StudentErrorProfile = {
  studentId: string;
  studentName: string;
  wrongCount: number;
  partialCount: number;
  items: StudentErrorItem[];
  knowledgePoints: { code: string; name: string }[];
};

type QuestionRow = {
  id: string;
  seq: number;
  stemText: string;
  standardAnswer: { id: string } | null;
  knowledge: { kp: { code: string; name: string } }[];
  submissions: {
    answerText: string;
    studentId: string;
    grading: { verdict: string; teacherNote: string | null } | null;
  }[];
};

async function loadQuestions(assignmentId: string): Promise<QuestionRow[]> {
  return prisma.question.findMany({
    where: { assignmentId },
    orderBy: { seq: "asc" },
    include: {
      standardAnswer: { select: { id: true } },
      knowledge: { include: { kp: { select: { code: true, name: true } } } },
      submissions: {
        select: {
          answerText: true,
          studentId: true,
          grading: { select: { verdict: true, teacherNote: true } },
        },
      },
    },
  }) as unknown as Promise<QuestionRow[]>;
}

// Submission 无 student 关联，按现有约定单独查姓名（同 corrections.ts）
async function nameMap(questions: QuestionRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(questions.flatMap((q) => q.submissions.map((s) => s.studentId)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function isWrong(v: string): v is "WRONG" | "PARTIAL" {
  return v === "WRONG" || v === "PARTIAL";
}

/** A：按题聚合，每题列出错/半对的学生名单（错因辅导用）。 */
export async function getQuestionWrongRoster(
  assignmentId: string
): Promise<QuestionRoster[]> {
  const questions = await loadQuestions(assignmentId);
  const names = await nameMap(questions);
  return questions.map((q) => {
    const kps = q.knowledge.map((k) => k.kp);
    const students: WrongStudent[] = [];
    let wrong = 0;
    let partial = 0;
    for (const s of q.submissions) {
      const v = s.grading?.verdict;
      if (!v || !isWrong(v)) continue;
      if (v === "WRONG") wrong++;
      else partial++;
      students.push({
        studentId: s.studentId,
        studentName: names.get(s.studentId) ?? "学生",
        verdict: v,
        answerText: s.answerText,
        teacherNote: s.grading?.teacherNote ?? null,
      });
    }
    students.sort(
      (a, b) =>
        (a.verdict === b.verdict ? 0 : a.verdict === "WRONG" ? -1 : 1) ||
        a.studentName.localeCompare(b.studentName, "zh-CN")
    );
    return {
      questionId: q.id,
      seq: q.seq,
      stemText: q.stemText,
      hasAnswer: !!q.standardAnswer,
      wrong,
      partial,
      knowledgePoints: kps,
      students,
    };
  });
}

/** B：按学生聚合，每生列出其错/半对题目及涉及的知识点（个别跟踪用）。 */
export async function getStudentErrorProfiles(
  assignmentId: string
): Promise<StudentErrorProfile[]> {
  const questions = await loadQuestions(assignmentId);
  const names = await nameMap(questions);
  const byStudent = new Map<string, StudentErrorProfile>();

  for (const q of questions) {
    const kps = q.knowledge.map((k) => k.kp);
    for (const s of q.submissions) {
      const v = s.grading?.verdict;
      if (!v || !isWrong(v)) continue;
      const cur =
        byStudent.get(s.studentId) ??
        {
          studentId: s.studentId,
          studentName: names.get(s.studentId) ?? "学生",
          wrongCount: 0,
          partialCount: 0,
          items: [],
          knowledgePoints: [],
        };
      if (v === "WRONG") cur.wrongCount++;
      else cur.partialCount++;
      cur.items.push({
        questionId: q.id,
        seq: q.seq,
        verdict: v,
        teacherNote: s.grading?.teacherNote ?? null,
        knowledgePoints: kps,
      });
      byStudent.set(s.studentId, cur);
    }
  }

  const profiles = [...byStudent.values()];
  for (const p of profiles) {
    p.items.sort((a, b) => a.seq - b.seq);
    const kpMap = new Map<string, { code: string; name: string }>();
    for (const it of p.items) for (const kp of it.knowledgePoints) kpMap.set(kp.code, kp);
    p.knowledgePoints = [...kpMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  profiles.sort(
    (a, b) =>
      b.wrongCount + b.partialCount - (a.wrongCount + a.partialCount) ||
      a.studentName.localeCompare(b.studentName, "zh-CN")
  );
  return profiles;
}
