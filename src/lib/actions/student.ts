"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { requireRole } from "../auth-guard";
import { runAction, str, type ActionState } from "../action";
import { assertStudentCanAct } from "../student-reviews";
import { writeAudit } from "../audit";

const answerSchema = z
  .string()
  .trim()
  .min(1, "请填写订正内容")
  .max(2000, "订正内容过长");
const questionSchema = z
  .string()
  .trim()
  .min(1, "请输入你的问题")
  .max(500, "问题过长");

/** 学生提交/更新订正：重复提交覆盖同一 (review, student) 记录，状态回到 PENDING 等待教师复核。 */
export async function submitCorrection(
  reviewId: string,
  _prev: ActionState,
  form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STUDENT");
    const { questionId } = await assertStudentCanAct(user.id, reviewId);
    const text = answerSchema.parse(str(form ?? new FormData(), "correctedAnswerText"));

    const sub = await prisma.submission.findUnique({
      where: { questionId_studentId: { questionId, studentId: user.id } },
      select: { id: true },
    });

    const corr = await prisma.correction.upsert({
      where: { publishedReviewId_studentId: { publishedReviewId: reviewId, studentId: user.id } },
      create: {
        publishedReviewId: reviewId,
        studentId: user.id,
        submissionId: sub?.id ?? null,
        correctedAnswerText: text,
        status: "PENDING",
      },
      update: {
        correctedAnswerText: text,
        status: "PENDING",
        submissionId: sub?.id ?? null,
        updatedAt: new Date(),
      },
    });
    revalidatePath(`/student/reviews/${reviewId}`);
    revalidatePath("/student/dashboard");
    await writeAudit({
      actorId: user.id,
      action: "correction.submit",
      entity: "Correction",
      entityId: corr.id,
      before: null,
      after: "PENDING",
    });
    return "订正已提交，等待教师复核";
  });
}

/** 学生就该讲评向教师提问。 */
export async function askQuestion(
  reviewId: string,
  _prev: ActionState,
  form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STUDENT");
    await assertStudentCanAct(user.id, reviewId);
    const text = questionSchema.parse(str(form ?? new FormData(), "questionText"));

    const sq = await prisma.studentQuestion.create({
      data: { publishedReviewId: reviewId, studentId: user.id, questionText: text },
    });
    revalidatePath(`/student/reviews/${reviewId}`);
    await writeAudit({
      actorId: user.id,
      action: "question.ask",
      entity: "StudentQuestion",
      entityId: sq.id,
      before: null,
      after: "OPEN",
    });
    return "提问已提交";
  });
}
