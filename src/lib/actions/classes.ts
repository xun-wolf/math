"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "../db";
import { requireRole, assertTeacherOwnsClass } from "../auth-guard";
import { runAction, str, type ActionState } from "../action";

const classSchema = z.object({
  name: z.string().trim().min(1, "班级名称不能为空").max(40, "班级名称过长"),
});

export async function createClass(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const { name } = classSchema.parse({ name: str(form, "name") });
    const c = await prisma.classRoom.create({
      data: { name, teacherId: user.id },
    });
    revalidatePath("/teacher/dashboard");
    redirect(`/teacher/classes/${c.id}`);
  });
}

export async function addStudentToClass(
  classId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    await assertTeacherOwnsClass(user, classId);
    const loginName = str(form, "loginName");
    if (!loginName) throw new Error("请输入学生登录名");
    const student = await prisma.user.findFirst({
      where: { loginName, role: "STUDENT" },
    });
    if (!student) throw new Error("该登录名不存在或非学生账号");
    const exists = await prisma.classEnrollment.findUnique({
      where: { classId_studentId: { classId, studentId: student.id } },
    });
    if (exists) throw new Error("该学生已在班级中");
    await prisma.classEnrollment.create({
      data: { classId, studentId: student.id },
    });
    revalidatePath(`/teacher/classes/${classId}`);
  });
}

export async function removeStudentFromClass(
  classId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    await assertTeacherOwnsClass(user, classId);
    const studentId = str(form, "studentId");
    if (!studentId) throw new Error("缺少学生标识");
    await prisma.classEnrollment.deleteMany({
      where: { classId, studentId },
    });
    revalidatePath(`/teacher/classes/${classId}`);
  });
}
