"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "../db";
import { requireUser, assertCanManageKnowledge } from "../auth-guard";
import { runAction, str, type ActionState } from "../action";

const kpSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "编码不能为空")
    .max(30, "编码过长")
    .regex(/^[A-Za-z0-9._-]+$/, "编码只允许字母、数字与 . _ -"),
  name: z.string().trim().min(1, "名称不能为空").max(40, "名称过长"),
  parentId: z.string().trim().optional(),
  description: z.string().trim().max(200, "描述过长").optional(),
});

export async function createKnowledgePoint(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    assertCanManageKnowledge(user);
    const parsed = kpSchema.parse({
      code: str(form, "code"),
      name: str(form, "name"),
      parentId: str(form, "parentId") || undefined,
      description: str(form, "description") || undefined,
    });
    const dup = await prisma.knowledgePoint.findUnique({ where: { code: parsed.code } });
    if (dup) throw new Error("该编码已存在");
    if (parsed.parentId) {
      const parent = await prisma.knowledgePoint.findUnique({ where: { id: parsed.parentId } });
      if (!parent) throw new Error("父节点不存在");
    }
    await prisma.knowledgePoint.create({
      data: {
        code: parsed.code,
        name: parsed.name,
        parentId: parsed.parentId || null,
        description: parsed.description || null,
      },
    });
    revalidatePath("/teacher/knowledge-points");
  });
}

export async function updateKnowledgePoint(
  kpId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    assertCanManageKnowledge(user);
    const name = str(form, "name");
    const description = str(form, "description");
    if (!name) throw new Error("名称不能为空");
    const exists = await prisma.knowledgePoint.findUnique({ where: { id: kpId } });
    if (!exists) throw new Error("知识点不存在");
    await prisma.knowledgePoint.update({
      where: { id: kpId },
      data: { name: name.slice(0, 40), description: description.slice(0, 200) || null },
    });
    revalidatePath("/teacher/knowledge-points");
  });
}

export async function deleteKnowledgePoint(
  kpId: string,
  _prev: ActionState
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    assertCanManageKnowledge(user);
    const [children, linkedQuestions] = await Promise.all([
      prisma.knowledgePoint.count({ where: { parentId: kpId } }),
      prisma.questionKnowledgePoint.count({ where: { kpId } }),
    ]);
    if (children > 0) throw new Error("请先删除或移动其子知识点");
    if (linkedQuestions > 0) throw new Error("该知识点已被题目引用，不能删除");
    await prisma.knowledgePoint.delete({ where: { id: kpId } }).catch(() => {
      throw new Error("知识点不存在");
    });
    revalidatePath("/teacher/knowledge-points");
  });
}
