"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../db";
import { requireRole, assertTeacherOwnsDraft } from "../auth-guard";
import { runAction, str, type ActionState } from "../action";
import { writeAudit } from "../audit";

type Cause = { cause: string; count: number; evidence: string };
type Practice = { text: string; rationale: string };

function parseCauses(raw: string | null): Cause[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        cause: String(x.cause ?? "").trim(),
        count: Number.isFinite(Number(x.count)) ? Math.max(0, Math.trunc(Number(x.count))) : 0,
        evidence: String(x.evidence ?? "").trim(),
      }))
      .filter((x) => x.cause);
  } catch {
    return [];
  }
}

function parsePractice(raw: string): Practice[] {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        text: String(x.text ?? "").trim(),
        rationale: String(x.rationale ?? "").trim(),
      }))
      .filter((x) => x.text);
  } catch {
    return [];
  }
}

function buildFinalContent(d: {
  summary: string | null;
  errorCauses: string | null;
  explanation: string | null;
  workedExample: string | null;
}, practice: { questionRefText: string; rationale: string | null }[]): string {
  const parts: string[] = [];
  if (d.summary) parts.push(`【讲评摘要】\n${d.summary}`);
  const causes = parseCauses(d.errorCauses);
  if (causes.length) {
    parts.push(
      "【常见错因】\n" +
        causes.map((c) => `· ${c.cause}${c.count ? `（约 ${c.count} 人）` : ""}${c.evidence ? ` —— ${c.evidence}` : ""}`).join("\n")
    );
  }
  if (d.explanation) parts.push(`【分步讲解】\n${d.explanation}`);
  if (d.workedExample) parts.push(`【示例演示】\n${d.workedExample}`);
  if (practice.length) {
    parts.push(
      "【推荐练习】\n" + practice.map((p) => `· ${p.questionRefText}${p.rationale ? ` —— ${p.rationale}` : ""}`).join("\n")
    );
  }
  return parts.join("\n\n");
}

export async function saveDraft(draftId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const draft = await assertTeacherOwnsDraft(user, draftId);
    if (draft.status === "PUBLISHED") throw new Error("已发布内容不可直接编辑，请先重新生成");

    const base = str(form, "baseUpdatedAt");
    if (base && Number(base) !== draft.updatedAt.getTime()) {
      throw new Error("该草稿已有更新，请刷新后重试（并发编辑冲突）");
    }

    const summary = str(form, "summary").slice(0, 500);
    const explanation = str(form, "explanation").slice(0, 8000);
    const workedExample = str(form, "workedExample").slice(0, 4000) || null;
    const causes = parseCauses(str(form, "errorCauses"));
    const practice = parsePractice(str(form, "practice"));

    const nextStatus =
      draft.status === "NEEDS_MANUAL" && explanation.trim() ? "DRAFT" : draft.status;

    const updated = await prisma.reviewDraft.update({
      where: { id: draftId },
      data: {
        summary,
        explanation,
        workedExample,
        errorCauses: JSON.stringify(causes),
        status: nextStatus,
        source: "MANUAL",
        aiFailReason: nextStatus === "DRAFT" ? null : draft.aiFailReason,
        currentVersion: draft.currentVersion + 1,
        updatedAt: new Date(),
      },
    });

    await prisma.practiceSuggestion.deleteMany({ where: { draftId } });
    if (practice.length) {
      await prisma.practiceSuggestion.createMany({
        data: practice.map((p) => ({
          draftId,
          questionRefText: p.text.slice(0, 1000),
          rationale: p.rationale.slice(0, 500) || null,
        })),
      });
    }

    await prisma.reviewDraftVersion.create({
      data: {
        draftId,
        versionNum: updated.currentVersion,
        changeType: "MANUAL_EDIT",
        createdBy: user.id,
        contentSnapshot: JSON.stringify({ summary, errorCauses: causes, explanation, workedExample, practiceSuggestions: practice }),
      },
    });

    revalidatePath(`/teacher/drafts/${draftId}`);
    revalidatePath(`/teacher/assignments/${draft.assignmentId}/drafts`);
    return "已保存修改（生成新版本快照）";
  });
}

export async function publishDraft(draftId: string, _prev: ActionState, form?: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const draft = await assertTeacherOwnsDraft(user, draftId);

    const base = form ? str(form, "baseUpdatedAt") : "";
    if (base && Number(base) !== draft.updatedAt.getTime()) {
      throw new Error("该草稿已有更新，请刷新后再发布（并发编辑冲突）");
    }

    if (draft.status === "PUBLISHED") throw new Error("该草稿已发布");
    if (!draft.summary?.trim() || !draft.explanation?.trim()) {
      throw new Error("发布前请补全「摘要」与「分步讲解」（不可发布空讲评）");
    }

    const suggestions = await prisma.practiceSuggestion.findMany({
      where: { draftId },
      select: { questionRefText: true, rationale: true },
      orderBy: { id: "asc" },
    });
    const finalContent = buildFinalContent(draft, suggestions);

    await prisma.$transaction([
      prisma.reviewDraft.update({ where: { id: draftId }, data: { status: "PUBLISHED", updatedAt: new Date() } }),
      prisma.publishedReview.upsert({
        where: { draftId },
        create: {
          draftId,
          classId: draft.assignment.classId,
          finalContent,
          publishedBy: user.id,
        },
        update: {
          classId: draft.assignment.classId,
          finalContent,
          publishedBy: user.id,
          publishedAt: new Date(),
        },
      }),
    ]);

    revalidatePath(`/teacher/drafts/${draftId}`);
    revalidatePath(`/teacher/assignments/${draft.assignmentId}/drafts`);
    await writeAudit({
      actorId: user.id,
      action: "review.publish",
      entity: "ReviewDraft",
      entityId: draftId,
      before: draft.status,
      after: "PUBLISHED",
    });
    return "已发布，学生端（M6）将可见该讲评";
  });
}

export async function rejectDraft(draftId: string, _prev: ActionState, _form?: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const draft = await assertTeacherOwnsDraft(user, draftId);
    if (draft.status === "PUBLISHED") throw new Error("已发布草稿不可拒绝，请重新生成新版");
    await prisma.reviewDraft.update({ where: { id: draftId }, data: { status: "REJECTED", updatedAt: new Date() } });
    revalidatePath(`/teacher/drafts/${draftId}`);
    revalidatePath(`/teacher/assignments/${draft.assignmentId}/drafts`);
    await writeAudit({
      actorId: user.id,
      action: "review.reject",
      entity: "ReviewDraft",
      entityId: draftId,
      before: draft.status,
      after: "REJECTED",
    });
    return "已拒绝该草稿";
  });
}

type Snapshot = {
  summary: string | null;
  errorCauses: Cause[];
  explanation: string | null;
  workedExample: string | null;
  knowledgePointIds: string[] | null; // 旧快照可能缺省
  practiceSuggestions: Practice[];
};

function parseSnapshot(raw: string): Snapshot {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    o = {};
  }
  const asStr = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  let causes: Cause[] = [];
  if (Array.isArray(o.errorCauses)) causes = o.errorCauses as Cause[];
  else if (typeof o.errorCauses === "string") causes = parseCauses(o.errorCauses);
  const practice: Practice[] = Array.isArray(o.practiceSuggestions)
    ? (o.practiceSuggestions as Practice[]).filter((p) => p && p.text)
    : [];
  const kpIds = Array.isArray(o.knowledgePointIds)
    ? (o.knowledgePointIds as unknown[]).map(String)
    : null;
  return {
    summary: asStr(o.summary),
    errorCauses: causes,
    explanation: asStr(o.explanation),
    workedExample: asStr(o.workedExample),
    knowledgePointIds: kpIds,
    practiceSuggestions: practice,
  };
}

/** 回退到指定历史版本：用该版本快照覆盖正文，写一条 RESTORED 新版本（不改历史、可再回退）。 */
export async function restoreDraftVersion(
  draftId: string,
  versionId: string,
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("TEACHER");
    const draft = await assertTeacherOwnsDraft(user, draftId);
    if (draft.status === "PUBLISHED") throw new Error("已发布草稿不可回退，请重新生成新版");

    const base = str(form, "baseUpdatedAt");
    if (base && Number(base) !== draft.updatedAt.getTime()) {
      throw new Error("该草稿已有更新，请刷新后重试（并发编辑冲突）");
    }

    const version = await prisma.reviewDraftVersion.findFirst({
      where: { id: versionId, draftId },
    });
    if (!version) throw new Error("目标版本不存在或不属于该草稿");

    const snap = parseSnapshot(version.contentSnapshot);
    if (!snap.explanation?.trim()) throw new Error("该历史版本无有效讲解内容，不能回退");

    const nextStatus = draft.status === "NEEDS_MANUAL" ? "DRAFT" : draft.status;
    const updated = await prisma.reviewDraft.update({
      where: { id: draftId },
      data: {
        summary: snap.summary,
        explanation: snap.explanation,
        workedExample: snap.workedExample,
        errorCauses: JSON.stringify(snap.errorCauses),
        status: nextStatus,
        source: "MANUAL",
        aiFailReason: nextStatus === "DRAFT" ? null : draft.aiFailReason,
        currentVersion: draft.currentVersion + 1,
        updatedAt: new Date(),
      },
    });

    const ops: Promise<unknown>[] = [
      prisma.practiceSuggestion.deleteMany({ where: { draftId } }),
    ];
    // 仅当快照带 knowledgePointIds 时才重建知识点关联（旧人工编辑快照缺省则保留现状）
    if (snap.knowledgePointIds) {
      const valid = new Set(draft.question.knowledge.map((k) => k.kp.id));
      const kpIds = snap.knowledgePointIds.filter((id) => valid.has(id));
      ops.push(prisma.reviewDraftKnowledge.deleteMany({ where: { draftId } }));
      for (const kpId of kpIds) {
        ops.push(prisma.reviewDraftKnowledge.create({ data: { draftId, kpId } }));
      }
    }
    for (const p of snap.practiceSuggestions) {
      ops.push(
        prisma.practiceSuggestion.create({
          data: {
            draftId,
            questionRefText: p.text.slice(0, 1000),
            rationale: (p.rationale ?? "").slice(0, 500) || null,
          },
        })
      );
    }
    await prisma.$transaction(ops as never[]);

    await prisma.reviewDraftVersion.create({
      data: {
        draftId,
        versionNum: updated.currentVersion,
        changeType: "RESTORED",
        createdBy: user.id,
        contentSnapshot: JSON.stringify({
          summary: snap.summary,
          errorCauses: snap.errorCauses,
          explanation: snap.explanation,
          workedExample: snap.workedExample,
          knowledgePointIds: snap.knowledgePointIds,
          practiceSuggestions: snap.practiceSuggestions,
        }),
      },
    });

    revalidatePath(`/teacher/drafts/${draftId}`);
    revalidatePath(`/teacher/assignments/${draft.assignmentId}/drafts`);
    await writeAudit({
      actorId: user.id,
      action: "draft.restore",
      entity: "ReviewDraft",
      entityId: draftId,
      before: `v${version.versionNum}`,
      after: `v${updated.currentVersion}`,
    });
    return `已回退到 v${version.versionNum}（生成新版本 v${updated.currentVersion}）`;
  });
}
