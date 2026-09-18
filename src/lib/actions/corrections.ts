"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import {
  requireRole,
  assertTeacherOwnsCorrection,
  assertTeacherOwnsStudentQuestion,
} from "../auth-guard";
import { runAction, str, type ActionState } from "../action";
import { suggestCorrectionAdvice } from "../corrections";
import { writeAudit } from "../audit";

const noteSchema = z.string().trim().max(1000, "说明过长");
const requiredReply = z.string().trim().min(1, "请输入回复内容").max(1000, "回复过长");

function revalidateFor(assignmentId: string, reviewId: string) {
  revalidatePath(`/teacher/assignments/${assignmentId}/corrections`);
  revalidatePath(`/student/reviews/${reviewId}`);
}

/** 确认掌握：RESOLVED + 说明（可空）+ 复核人 */
export async function resolveCorrection(
  correctionId: string,
  _prev: ActionState,
  form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const c = await assertTeacherOwnsCorrection(user, correctionId);
    const note = noteSchema.parse(str(form ?? new FormData(), "note")) || null;
    await prisma.correction.update({
      where: { id: correctionId },
      data: {
        status: "RESOLVED",
        teacherResolvedNote: note,
        resolvedBy: user.id,
        updatedAt: new Date(),
      },
    });
    revalidateFor(c.review.draft.assignmentId, c.publishedReviewId);
    await writeAudit({
      actorId: user.id,
      action: "correction.resolve",
      entity: "Correction",
      entityId: correctionId,
      before: c.status,
      after: "RESOLVED",
    });
    return "已确认掌握";
  });
}

/** 仍需订正：STILL_WRONG + 必填说明 */
export async function markStillWrong(
  correctionId: string,
  _prev: ActionState,
  form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const c = await assertTeacherOwnsCorrection(user, correctionId);
    const note = requiredReply.parse(str(form ?? new FormData(), "note"));
    await prisma.correction.update({
      where: { id: correctionId },
      data: {
        status: "STILL_WRONG",
        teacherResolvedNote: note,
        resolvedBy: user.id,
        updatedAt: new Date(),
      },
    });
    revalidateFor(c.review.draft.assignmentId, c.publishedReviewId);
    await writeAudit({
      actorId: user.id,
      action: "correction.still_wrong",
      entity: "Correction",
      entityId: correctionId,
      before: c.status,
      after: "STILL_WRONG",
    });
    return "已标记仍需订正，并附说明";
  });
}

/** 回复学生提问 */
export async function replyStudentQuestion(
  sqId: string,
  _prev: ActionState,
  form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const sq = await assertTeacherOwnsStudentQuestion(user, sqId);
    const reply = requiredReply.parse(str(form ?? new FormData(), "reply"));
    await prisma.studentQuestion.update({
      where: { id: sqId },
      data: { teacherReply: reply, repliedBy: user.id, repliedAt: new Date() },
    });
    revalidatePath(`/teacher/assignments/${sq.review.draft.assignmentId}/corrections`);
    revalidatePath(`/student/reviews/${sq.publishedReviewId}`);
    await writeAudit({
      actorId: user.id,
      action: "question.reply",
      entity: "StudentQuestion",
      entityId: sqId,
      before: sq.repliedAt ? "REPLIED" : "OPEN",
      after: "REPLIED",
    });
    return "回复已提交，学生端将可见";
  });
}

/** 生成针对该订正的 AI 点评建议（仅供教师参考，可一键填入复核说明；不直接触达学生）。 */
export async function aiCorrectionAdvice(
  correctionId: string,
  _prev: ActionState,
  _form?: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    await assertTeacherOwnsCorrection(user, correctionId);
    const res = await suggestCorrectionAdvice(correctionId);
    if (res.status === "OK") {
      return { data: res.advice, message: `已生成点评建议（${res.modelTag}）` };
    }
    return { message: res.reason };
  });
}
