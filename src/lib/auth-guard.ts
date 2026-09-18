import { getSessionUser, type SessionUser } from "./session";
import { prisma } from "./db";

export class AuthError extends Error {
  constructor(public status: 401 | 403 | 404, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new AuthError(401, "未登录");
  return u;
}

export async function requireRole(
  ...roles: SessionUser["role"][]
): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw new AuthError(403, "无权访问");
  return u;
}

/** 学生只能读自己的资源；不匹配统一返回 404 */
export async function assertStudentOwns(user: SessionUser, studentId: string) {
  if (user.role !== "STUDENT") throw new AuthError(403, "非学生");
  if (user.id !== studentId) throw new AuthError(404, "资源不存在");
}

/** 教师只能操作自己带的班级；他人班级/不存在统一 404，避免枚举 */
export async function assertTeacherOwnsClass(user: SessionUser, classId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const c = await prisma.classRoom.findFirst({
    where: { id: classId, teacherId: user.id },
  });
  if (!c) throw new AuthError(404, "班级不存在或无权访问");
  return c;
}

/** 校验作业归属：教师只能操作自己班级下的作业 */
export async function assertTeacherOwnsAssignment(user: SessionUser, assignmentId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const a = await prisma.assignment.findFirst({
    where: { id: assignmentId, class: { teacherId: user.id } },
    include: { class: true },
  });
  if (!a) throw new AuthError(404, "作业不存在或无权访问");
  return a;
}

/** 校验题目归属：教师只能操作自己班级作业下的题目 */
export async function assertTeacherOwnsQuestion(user: SessionUser, questionId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const q = await prisma.question.findFirst({
    where: { id: questionId, assignment: { class: { teacherId: user.id } } },
    include: { assignment: true, standardAnswer: true, knowledge: true },
  });
  if (!q) throw new AuthError(404, "题目不存在或无权访问");
  return q;
}

/** 知识点树由教研负责人维护；教师只读 */
export function assertCanManageKnowledge(user: SessionUser) {
  if (user.role !== "RESEARCHER") throw new AuthError(403, "仅教研负责人可维护知识点树");
}

/** 校验草稿归属：教师只能审核自己班级作业下的草稿；他人/不存在统一 404 */
export async function assertTeacherOwnsDraft(user: SessionUser, draftId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const d = await prisma.reviewDraft.findFirst({
    where: { id: draftId, assignment: { class: { teacherId: user.id } } },
    include: {
      question: { include: { standardAnswer: true, knowledge: { include: { kp: true } } } },
      assignment: true,
    },
  });
  if (!d) throw new AuthError(404, "草稿不存在或无权访问");
  return d;
}

/** 校验订正归属：教师只能复核发布到自己班级作业下的订正；他人/不存在统一 404 */
export async function assertTeacherOwnsCorrection(user: SessionUser, correctionId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const c = await prisma.correction.findFirst({
    where: {
      id: correctionId,
      review: { draft: { assignment: { class: { teacherId: user.id } } } },
    },
    include: {
      review: { include: { draft: { include: { question: true, assignment: true } } } },
    },
  });
  if (!c) throw new AuthError(404, "订正不存在或无权访问");
  return c;
}

/** 校验学生提问归属：教师只能回复发布到自己班级作业下的提问；他人/不存在统一 404 */
export async function assertTeacherOwnsStudentQuestion(user: SessionUser, sqId: string) {
  if (user.role !== "TEACHER") throw new AuthError(403, "非教师");
  const sq = await prisma.studentQuestion.findFirst({
    where: {
      id: sqId,
      review: { draft: { assignment: { class: { teacherId: user.id } } } },
    },
    include: {
      review: { include: { draft: { include: { question: true, assignment: true } } } },
    },
  });
  if (!sq) throw new AuthError(404, "提问不存在或无权访问");
  return sq;
}
