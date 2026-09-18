import { prisma } from "./db";

/**
 * 关键动作审计。仅记录必要字段（动作 / 实体 / 实体 id / 状态前后），
 * before/after 只放状态或计数等标量，绝不写入答题原文、讲评正文、订正正文等敏感明细，
 * 以符合"不采集正文、脱敏"的约束（PLAN-v2 §16 审计 + 数据最小化）。
 */
export type AuditInput = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: string | number | null;
  after?: string | number | null;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before == null ? null : String(input.before),
      after: input.after == null ? null : String(input.after),
    },
  });
}
