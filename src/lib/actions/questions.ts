"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import {
  requireRole,
  assertTeacherOwnsQuestion,
} from "../auth-guard";
import { runAction, str, type ActionState } from "../action";

export async function saveQuestionMeta(
  questionId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const q = await assertTeacherOwnsQuestion(user, questionId);
    const stemText = str(form, "stemText");
    if (!stemText) throw new Error("题干不能为空");
    let difficulty = parseInt(str(form, "difficulty"), 10);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) difficulty = 3;
    const sourceNote = str(form, "sourceNote").slice(0, 120);
    await prisma.question.update({
      where: { id: questionId },
      data: {
        stemText: stemText.slice(0, 2000),
        difficulty,
        sourceNote: sourceNote || null,
      },
    });
    revalidatePath(`/teacher/assignments/${q.assignmentId}/questions/${questionId}`);
    revalidatePath(`/teacher/assignments/${q.assignmentId}`);
  });
}

export async function saveStandardAnswer(
  questionId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const q = await assertTeacherOwnsQuestion(user, questionId);
    const answerText = str(form, "answerText");
    const rubricText = str(form, "rubricText");
    if (!answerText) throw new Error("标准答案不能为空");
    if (!rubricText) throw new Error("评分说明不能为空（AI 生成依赖评分依据）");
    const commonMistakeNote = str(form, "commonMistakeNote").slice(0, 500);
    await prisma.standardAnswer.upsert({
      where: { questionId },
      create: {
        questionId,
        answerText: answerText.slice(0, 2000),
        rubricText: rubricText.slice(0, 2000),
        commonMistakeNote: commonMistakeNote || null,
      },
      update: {
        answerText: answerText.slice(0, 2000),
        rubricText: rubricText.slice(0, 2000),
        commonMistakeNote: commonMistakeNote || null,
        updatedAt: new Date(),
      },
    });
    revalidatePath(`/teacher/assignments/${q.assignmentId}/questions/${questionId}`);
    revalidatePath(`/teacher/assignments/${q.assignmentId}`);
  });
}

export async function setQuestionKnowledge(
  questionId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const q = await assertTeacherOwnsQuestion(user, questionId);
    const raw = form.getAll("kpIds").filter((v): v is string => typeof v === "string");
    const ids = Array.from(new Set(raw));
    if (ids.length > 0) {
      const found = await prisma.knowledgePoint.count({ where: { id: { in: ids } } });
      if (found !== ids.length) throw new Error("存在无效的知识点选择");
    }
    await prisma.$transaction([
      prisma.questionKnowledgePoint.deleteMany({ where: { questionId } }),
      prisma.questionKnowledgePoint.createMany({
        data: ids.map((kpId) => ({ questionId, kpId })),
      }),
    ]);
    revalidatePath(`/teacher/assignments/${q.assignmentId}/questions/${questionId}`);
  });
}
