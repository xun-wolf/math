"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { requireRole, assertTeacherOwnsAssignment, assertTeacherOwnsQuestion } from "../auth-guard";
import { runAction, type ActionState } from "../action";
import { generateDraftForQuestion } from "../drafts";

export async function generateDraft(
  questionId: string,
  _prev: ActionState,
  _form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const q = await assertTeacherOwnsQuestion(user, questionId);
    const res = await generateDraftForQuestion(questionId, user.id);
    revalidatePath(`/teacher/assignments/${q.assignmentId}/drafts`);
    revalidatePath(`/teacher/assignments/${q.assignmentId}`);
    return res.status === "DRAFT"
      ? "已生成讲评草稿（待教师审核）"
      : `无法调用 AI：${res.reason ?? "已置为待人工处理"}`;
  });
}

export async function generateAllDrafts(
  assignmentId: string,
  _prev: ActionState,
  _form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    await assertTeacherOwnsAssignment(user, assignmentId);
    const questions = await prisma.question.findMany({
      where: { assignmentId },
      orderBy: { seq: "asc" },
      select: { id: true },
    });
    if (questions.length === 0) throw new Error("该作业还没有题目");

    let draft = 0;
    let manual = 0;
    for (const q of questions) {
      const res = await generateDraftForQuestion(q.id, user.id);
      if (res.status === "DRAFT") draft++;
      else manual++;
    }
    revalidatePath(`/teacher/assignments/${assignmentId}/drafts`);
    revalidatePath(`/teacher/assignments/${assignmentId}`);
    return `已处理 ${questions.length} 题：${draft} 题生成草稿，${manual} 题需人工处理（缺依据或 AI 不可用）`;
  });
}
