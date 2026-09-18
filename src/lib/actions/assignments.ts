"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import {
  requireRole,
  assertTeacherOwnsClass,
  assertTeacherOwnsAssignment,
  assertTeacherOwnsQuestion,
} from "../auth-guard";
import { runAction, str, type ActionState } from "../action";

function parseDueDate(v: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function createAssignment(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const classId = str(form, "classId");
    const title = str(form, "title");
    if (!classId) throw new Error("请选择班级");
    if (!title) throw new Error("作业标题不能为空");
    await assertTeacherOwnsClass(user, classId);
    const a = await prisma.assignment.create({
      data: {
        classId,
        title: title.slice(0, 60),
        dueDate: parseDueDate(str(form, "dueDate")),
        createdBy: user.id,
      },
    });
    revalidatePath(`/teacher/classes/${classId}`);
    redirect(`/teacher/assignments/${a.id}`);
  });
}

export async function addQuestion(
  assignmentId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    await assertTeacherOwnsAssignment(user, assignmentId);
    const stemText = str(form, "stemText");
    if (!stemText) throw new Error("题干不能为空");
    const seqRaw = str(form, "seq");
    let seq = seqRaw ? parseInt(seqRaw, 10) : NaN;
    if (!Number.isInteger(seq) || seq < 1) {
      const max = await prisma.question.aggregate({
        where: { assignmentId },
        _max: { seq: true },
      });
      seq = (max._max.seq ?? 0) + 1;
    }
    const dup = await prisma.question.findUnique({
      where: { assignmentId_seq: { assignmentId, seq } },
    });
    if (dup) throw new Error(`第 ${seq} 题已存在，请换个序号`);
    const diffRaw = str(form, "difficulty");
    let difficulty = diffRaw ? parseInt(diffRaw, 10) : 3;
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) difficulty = 3;
    const q = await prisma.question.create({
      data: {
        assignmentId,
        seq,
        stemText: stemText.slice(0, 2000),
        difficulty,
        sourceNote: str(form, "sourceNote").slice(0, 120) || null,
      },
    });
    revalidatePath(`/teacher/assignments/${assignmentId}`);
    redirect(`/teacher/assignments/${assignmentId}/questions/${q.id}`);
  });
}

export async function deleteQuestion(
  questionId: string,
  _prev: ActionState
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const q = await assertTeacherOwnsQuestion(user, questionId);
    const assignmentId = q.assignmentId;
    const submissions = await prisma.submission.count({ where: { questionId } });
    if (submissions > 0) throw new Error("该题已有学生作答记录，不能删除");
    await prisma.question.delete({ where: { id: questionId } });
    revalidatePath(`/teacher/assignments/${assignmentId}`);
  });
}

export async function toggleAssignmentStatus(
  assignmentId: string,
  _prev: ActionState
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const a = await assertTeacherOwnsAssignment(user, assignmentId);
    const next = a.status === "OPEN" ? "CLOSED" : "OPEN";
    await prisma.assignment.update({ where: { id: assignmentId }, data: { status: next } });
    revalidatePath(`/teacher/assignments/${assignmentId}`);
    revalidatePath(`/teacher/classes/${a.classId}`);
  });
}
