import { prisma } from "./db";

/**
 * 教研只读分析：跨班聚合，只看知识点错误率与班级订正掌握率。
 * 严格不读取、不返回任何学生原文（答题/订正/提问正文）与可识别个人的信息（姓名/学号）。
 * 班级名与知识点编码属于聚合维度，非个人数据。
 */

export type KpRow = {
  code: string;
  name: string;
  total: number; // 该知识点关联题目的批改总次数
  notMastered: number; // WRONG + PARTIAL
  errorRate: number;
};

export type ClassRow = {
  className: string;
  graded: number; // 该班批改总次数
  errorRate: number; // 该班 未掌握/批改
  correctionTotal: number;
  pending: number;
  resolved: number;
  stillWrong: number;
  masteryRate: number; // resolved / total
};

export type ResearchStats = {
  kp: KpRow[];
  classes: ClassRow[];
  totals: {
    graded: number;
    notMastered: number;
    errorRate: number;
    correctionTotal: number;
    resolved: number;
    masteryRate: number;
    hasData: boolean;
  };
};

/** 跨全部班级聚合：知识点错误率（来自 Grading 现算）+ 班级订正掌握率。 */
export async function getResearchStats(): Promise<ResearchStats> {
  const questions = await prisma.question.findMany({
    include: {
      knowledge: { include: { kp: { select: { code: true, name: true } } } },
      submissions: {
        include: {
          grading: { select: { verdict: true } },
          question: { select: { assignment: { select: { class: { select: { name: true } } } } } },
        },
      },
    },
  });

  const kpMap = new Map<string, KpRow>();
  let graded = 0;
  let notMastered = 0;
  // 班级 → 该班该知识无关；先累计每个班级聚合（按班级去重知识点计数无意义，此处只统计错误总量按班级）
  const classGrade = new Map<string, { total: number; bad: number }>();

  for (const q of questions) {
    let qCorrect = 0;
    let qBad = 0;
    for (const s of q.submissions) {
      const v = s.grading?.verdict;
      if (!v) continue;
      graded++;
      const bad = v === "WRONG" || v === "PARTIAL";
      if (bad) {
        qBad++;
        notMastered++;
      } else qCorrect++;
      const cname = s.question.assignment.class.name;
      const cur = classGrade.get(cname) ?? { total: 0, bad: 0 };
      cur.total++;
      if (bad) cur.bad++;
      classGrade.set(cname, cur);
    }
    if (qCorrect + qBad === 0) continue;
    for (const k of q.knowledge) {
      const cur =
        kpMap.get(k.kp.code) ??
        { code: k.kp.code, name: k.kp.name, total: 0, notMastered: 0, errorRate: 0 };
      cur.total += qCorrect + qBad;
      cur.notMastered += qBad;
      kpMap.set(k.kp.code, cur);
    }
  }

  const kp = [...kpMap.values()]
    .map((r) => ({ ...r, errorRate: r.total ? r.notMastered / r.total : 0 }))
    .sort((a, b) => b.errorRate - a.errorRate);

  // 班级订正掌握率
  const corrections = await prisma.correction.findMany({
    include: {
      review: {
        select: { draft: { select: { assignment: { select: { class: { select: { name: true } } } } } } },
      },
    },
  });
  const corrMap = new Map<string, ClassRow>();
  let correctionTotal = 0;
  let resolvedTotal = 0;
  for (const c of corrections) {
    const cname = c.review.draft.assignment.class.name;
    const row =
      corrMap.get(cname) ??
      { className: cname, graded: 0, errorRate: 0, correctionTotal: 0, pending: 0, resolved: 0, stillWrong: 0, masteryRate: 0 };
    row.correctionTotal++;
    if (c.status === "RESOLVED") row.resolved++;
    else if (c.status === "STILL_WRONG") row.stillWrong++;
    else row.pending++;
    corrMap.set(cname, row);
    correctionTotal++;
    if (c.status === "RESOLVED") resolvedTotal++;
  }
  const classNames = new Set<string>([...classGrade.keys(), ...corrMap.keys()]);
  const classes = [...classNames]
    .map((name) => {
      const g = classGrade.get(name) ?? { total: 0, bad: 0 };
      const c =
        corrMap.get(name) ??
        { className: name, correctionTotal: 0, pending: 0, resolved: 0, stillWrong: 0, masteryRate: 0 };
      return {
        ...c,
        graded: g.total,
        errorRate: g.total ? g.bad / g.total : 0,
        masteryRate: c.correctionTotal ? c.resolved / c.correctionTotal : 0,
      };
    })
    .sort((a, b) => b.masteryRate - a.masteryRate);

  return {
    kp,
    classes,
    totals: {
      graded,
      notMastered,
      errorRate: graded ? notMastered / graded : 0,
      correctionTotal,
      resolved: resolvedTotal,
      masteryRate: correctionTotal ? resolvedTotal / correctionTotal : 0,
      hasData: graded > 0 || correctionTotal > 0,
    },
  };
}
