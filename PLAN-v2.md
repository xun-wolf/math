# 初中数学作业讲评与错题跟踪助手 · 需求文档 v2.0

> 挑战赛道大作业 · AI 原生 Web 业务系统
> 版本：v2.0 · 改进版

---

## 0. 文档说明

### 0.1 优先级定义

| 级别 | 含义 | 首版是否必须 |
|---|---|---|
| **P0** | 核心路径，缺了就不成立 | 必须完成 |
| **P1** | 重要体验/安全，强烈建议 | 应完成 |
| **P2** | 锦上添花，可延后 | 可选 |

### 0.2 版本变更记录

| 版本 | 日期 | 变更说明 |
|---|---|---|
| v1.0 | - | 初版草案 |
| v2.0 | 2026-09-18 | 结构重组；AI 草稿结构化存储与版本历史；CSV 导入校验预览；订正辅助校验；补充边界场景与状态流转；增加优先级标注 |
| v2.1 | 2026-09-18 | 与 M1/M2 实现对齐：跨班越权统一返回 **404**（防枚举，原写 403）；教师可把预置学生加入/移出本班；知识点**保留树结构**（扁平为其特例，不删代码） |

---

## 1. 项目定位与目标

### 1.1 一句话定位

教师批改完作业之后，用 AI 起草讲评、教师审核发布、学生订正反馈、教师跟踪改进的**闭环系统**。AI 是流程里的一环，不是外挂聊天框。

### 1.2 业务背景

初二数学老师批改完 45 名学生的一次作业，发现很多人做错了第五题，但错误原因并不完全相同。老师需要：
- 统计哪些知识点没有掌握
- 准备有针对性的讲评内容
- 跟踪学生订正后是否真正理解

当前这些工作分散在表格、纸质记录和教师个人笔记中，效率低且难以形成长期积累。

### 1.3 AI 原生四特征落地

| 特征 | 本项目落点 |
|---|---|
| 接收自然语言输入 | 题面文本、标准答案文本、评分说明、教师批改备注、学生疑问 |
| AI 转成结构化候选 | 生成结构化讲评草稿（知识点、错因、讲解段、候选练习），分字段存储 |
| 用户可看依据、可改 | 草稿审核页强制并排展示原题/标准答案/评分依据；教师可逐段修改后发布 |
| AI 失败仍可人工完成 | AI 调用异常 → 状态置为 `NEEDS_MANUAL`；教师手工撰写入口始终可用 |

### 1.4 首版目标

- 教师能在 10 分钟内完成一次作业的批改结果录入和讲评发布
- 学生能在 5 分钟内找到自己的错题、看完讲评、提交订正
- AI 草稿能覆盖 70% 以上的常规讲解内容，教师只需微调即可发布

---

## 2. 角色与权限

### 2.1 角色定义

| 角色 | 核心任务 | 权限范围 |
|---|---|---|
| 教师 | 维护作业、录入批改、确认讲评、跟踪订正 | 管理自己带班的班级/作业/题目/批改；触发 AI 草稿；编辑、发布讲评；查看本班学生订正情况 |
| 学生 | 查看错题、完成订正、提交疑问 | 只能看**自己**的成绩、讲评、订正记录；提交订正、提问 |
| 教研负责人 | 维护知识点、审核公共模板 | 维护全局知识点；查看跨班聚合统计；审核跨班共享的讲评 |

> 首版通过"以某身份登录"的简化机制演示（Demo 账号），UI 上不做多角色切换。

### 2.2 权限关键约束（P0）

- **学生只能看自己**：任何学生侧查询，服务端自动注入 `studentId = session.userId`；URL 参数只作为过滤条件，永远不作为授权依据
- **教师只能管自己班**：班级资源按 `ClassRoom.teacherId` 校验归属，跨班访问统一返回 **404**（用 404 而非 403，避免泄露"该班级/作业是否存在"）
- **学生看不到草稿**：学生接口只查 `PublishedReview`，`ReviewDraft` 无学生侧读路径
- **教研看不到学生明细**：教研默认只能看聚合统计，不能看具体学生的答题原文（PII 隔离）

---

## 3. 数据分层与模型

### 3.1 数据分层原则

```
┌─ 原始事实层（教师录入，唯一真相源） ─────────────────┐
│  Assignment 作业 / Question 题目                     │
│  StandardAnswer 标准答案 / Rubric 评分说明            │
│  Submission 学生答题 / Grading 教师批改结果            │
└──────────────────────────────────────────────────┘
                    ↓ 派生（可重算）
┌─ 统计层（系统只读） ────────────────────────────────┐
│  ErrorStat 题目/知识点错误分布                       │
└──────────────────────────────────────────────────┘
                    ↓ 喂给 AI
┌─ AI 草稿层（未发布，教师可改，有版本历史） ────────────┐
│  ReviewDraft 讲评草稿（结构化字段存储）                │
│  ReviewDraftVersion 草稿版本快照                      │
│  PracticeSuggestion 候选练习                          │
└──────────────────────────────────────────────────┘
                    ↓ 教师审核发布
┌─ 正式结论层（教师署名发布） ────────────────────────┐
│  PublishedReview 已发布讲评（面向学生）              │
│  Correction 学生订正                                 │
│  StudentQuestion 学生疑问                            │
└──────────────────────────────────────────────────┘
```

**关键不变量**：学生只能看到 `PublishedReview`，永远不能看到 `ReviewDraft`。

### 3.2 数据模型（核心表）

#### 3.2.1 用户与组织

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `User` | id, name, loginName(唯一), passwordHash, role, mustChangePassword, failedAttempts, lockedUntil, lastLoginAt | role: TEACHER/STUDENT/RESEARCHER |
| `Session` | id, userId, tokenHash, userAgent, ip, expiresAt, revokedAt | 服务端会话表，cookie 只存不透明 sessionId |
| `ClassRoom` | id, name, teacherId | 班级，归属于一位教师 |
| `ClassEnrollment` | classId, studentId, joinedAt | 学生与班级的关联 |
| `LoginAudit` | id, loginName, ok, ip, ua, at | 登录尝试审计（成功/失败都记） |

#### 3.2.2 教学内容

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `KnowledgePoint` | id, code, name, description, parentId? | 树状知识点（`parentId` 可空即顶级；已实现）；教研维护 |
| `Assignment` | id, classId, title, dueDate, createdBy, status | 一次作业 |
| `Question` | id, assignmentId, seq, stemText, difficulty, sourceNote | 题目 |
| `QuestionKnowledgePoint` | questionId, knowledgePointId | 题与知识点的多对多 |
| `StandardAnswer` | id, questionId, answerText, rubricText, commonMistakeNote | 一题一版标准答案；唯一约束 (questionId) |

#### 3.2.3 答题与批改

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `Submission` | id, questionId, studentId, answerText, submittedAt | 学生答题 |
| `Grading` | id, submissionId, score, verdict, teacherNote, gradedAt | verdict: CORRECT/WRONG/PARTIAL |

#### 3.2.4 统计（派生，可重算）

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `ErrorStat` | assignmentId, questionId, knowledgePointId?, total, wrongCount, partialCount, updatedAt | 错误分布 |

#### 3.2.5 AI 草稿（P0 核心改进：结构化存储 + 版本历史）

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `ReviewDraft` | id, questionId, assignmentId, status, modelTag, createdAt, updatedAt | **结构化字段见下方** |
| `ReviewDraftVersion` | id, draftId, versionNum, contentSnapshot, createdBy, createdAt | 每次修改/重新生成留一个快照，支持回退 |
| `ReviewDraftKnowledge` | draftId, knowledgePointId | 草稿关联的知识点 |
| `PracticeSuggestion` | id, draftId, questionRefText, rationale | 候选练习建议 |

**ReviewDraft 结构化字段（P0）**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `summary` | text | 讲评摘要，一句话概括主要问题 |
| `errorCauses` | json array | 错因列表：[{cause, count, evidence}] |
| `explanation` | text | 分步讲解正文 |
| `workedExample` | text | 示例题演示（可选） |
| `basedOnQuestionSnapshot` | text | 生成时的题目快照（只读，防后续改动） |
| `basedOnAnswerSnapshot` | text | 生成时的标准答案快照 |
| `basedOnErrorSummary` | text | 生成时的错误统计摘要 |
| `status` | enum | DRAFT / NEEDS_MANUAL / APPROVED / PUBLISHED / REJECTED |

> **为什么拆字段**：原方案 draftContent 是一整段 JSON，教师在前端编辑后结构容易乱。拆成独立字段后，每个字段可单独编辑、单独校验，也方便后续做局部 A/B 对比。

#### 3.2.6 正式发布与学生反馈

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `PublishedReview` | id, draftId, classId, finalContent, publishedBy, publishedAt | 已发布讲评（面向学生） |
| `Correction` | id, publishedReviewId, studentId, submissionId, correctedAnswerText, status, teacherResolvedNote, aiSuggestion?, updatedAt | 学生订正；status: PENDING/RESOLVED/STILL_WRONG |
| `StudentQuestion` | id, publishedReviewId, studentId, questionText, teacherReply, createdAt, repliedAt | 学生疑问 |

> `aiSuggestion` 字段（P1）：AI 辅助判断订正对错的草稿，仅供教师参考，不直接对学生展示。

#### 3.2.7 审计

| 表名 | 核心字段 | 说明 |
|---|---|---|
| `AuditLog` | id, actorId, action, entity, entityId, before, after, at | 关键动作审计；只写不删不改 |

---

## 4. 核心业务流程

### 4.1 主链路（教师视角）

```
建班级 → 维护知识点 → 布置作业 → 录入题目/标准答案/评分说明
      → 关联知识点 → 导入学生答题（CSV 或手工）
      → 录入批改结果 → 系统算错误分布
      → 触发 AI 生成讲评草稿（按题）
      → 教师逐条审：接受 / 改后接受 / 拒绝（可回退历史版本）
      → 发布讲评
      → 查看订正完成情况 → 处理学生疑问
```

### 4.2 学生视角

```
登录 → 查看我的作业/错题列表 → 打开某题讲评 → 阅读讲解
     → 提交订正 → （可选）提交疑问
     → 等待教师回复 → 查看订正结果
```

### 4.3 关键状态流转

#### 4.3.1 讲评草稿状态流转（P0）

```
                    ┌──────────┐
                    │  触发生成  │
                    └────┬─────┘
                         │
              ┌──────────┴──────────┐
              │ 有标准答案+评分说明？ │
              └──────────┬──────────┘
                    否   │        是
          ┌──────────┐  │  ┌──────────┐
          │NEEDS_    │  │  │  DRAFT   │
          │MANUAL    │←─┘  │ (AI生成) │
          └────┬─────┘     └────┬─────┘
               │                │
          教师手工撰写        教师审核
               │                │
          ┌────┴─────┐    ┌────┴─────┐
          │  DRAFT   │    │ APPROVED │
          │ (手工写)  │    │  (通过)  │
          └────┬─────┘    └────┬─────┘
               │                │
               └───────┬────────┘
                       │ 发布
                  ┌────┴─────┐
                  │ PUBLISHED│
                  └──────────┘

      DRAFT / NEEDS_MANUAL 状态下均可被 REJECTED
```

#### 4.3.2 订正状态流转（P0）

```
学生提交订正 → PENDING
    │
    ├─ 教师确认正确 → RESOLVED
    └─ 教师判定仍错 → STILL_WRONG → 学生可再次提交 → PENDING
```

---

## 5. 功能需求

### 5.1 功能总览

| # | 模块 | 优先级 | 说明 |
|---|---|---|---|
| F1 | 认证与权限 | P0 | 登录、会话、角色守卫、越权防护 |
| F2 | 班级与学生管理 | P0 | 建班、学生列表、班级归属校验 |
| F3 | 知识点管理 | P0 | 知识点 CRUD（首版扁平列表） |
| F4 | 作业与题目管理 | P0 | 作业 CRUD、题目录入、标准答案与评分说明 |
| F5 | 答题与批改导入 | P0 | CSV 导入答题与批改结果，含校验预览 |
| F6 | 错误统计看板 | P0 | 按题/按知识点的错误分布 |
| F7 | AI 讲评草稿生成 | P0 | 触发 AI 生成、缺依据标记、Mock Provider |
| F8 | 草稿审核与编辑 | P0 | 并排展示依据、结构化编辑、版本历史、发布/拒绝 |
| F9 | 学生端讲评查看 | P0 | 查看已发布讲评、自己的作答与批改 |
| F10 | 学生订正与提问 | P0 | 提交订正、提交疑问 |
| F11 | 订正跟踪与回复 | P0 | 查看订正完成情况、回复疑问、判定订正结果 |
| F12 | AI 订正辅助校验 | P1 | AI 辅助判断订正对错，供教师参考 |
| F13 | 审计日志 | P1 | 关键操作记录与查询 |
| F14 | 教研角色 | P2 | 跨班聚合统计、公共模板审核 |

---

### 5.2 F1 认证与权限（P0）

**功能描述**：

三种角色（教师/学生/教研）通过账号密码登录。系统使用 bcrypt 存储密码哈希，服务端维护 Session 表，cookie 只携带不透明的 sessionId。所有 API 走服务端鉴权，根据角色和数据归属做行级权限校验。

**关键规则**：

- 密码哈希：bcrypt cost 12，永不明文存储或回显
- 登录策略：失败 5 次锁定 15 分钟（DEMO_MODE 下可关闭）
- 会话：`httpOnly + SameSite=Lax + Secure(生产)`，有效期 7 天
- 登出/改密：撤销当前用户所有 session；密码修改后强制重登
- 首登改密：seed 账号默认 `mustChangePassword=true`（DEMO_MODE 下可关闭）
- CSRF：所有非 GET `/api/*` 需 CSRF token（double-submit cookie 模式）
- 越权防护：学生侧用 404 代替 403，防止泄露资源存在性

**边界场景**：

| 场景 | 处理 |
|---|---|
| 并发登录同一账号 | 各自独立 session，互不影响 |
| 修改密码后 | 所有历史 session 立即失效 |
| 会话过期 | 跳转登录页，保留原 URL 参数，登录后回跳 |
| DEMO_MODE 下 | 关闭首登改密和登录锁定；提供快速登录按钮 |

---

### 5.3 F5 答题与批改导入（P0，重点改进）

**功能描述**：

教师通过 CSV 文件批量导入学生答题和批改结果。导入前提供模板下载，导入过程中分两步：先解析校验，展示预览报告（成功多少行、失败多少行、失败原因），教师确认后再真正写入数据库。

**导入流程**：

```
1. 下载 CSV 模板（含表头说明）
2. 上传 CSV 文件
3. 系统解析并校验 → 展示预览报告
4. 教师确认 → 写入数据库 → 触发 ErrorStat 重算
```

**校验规则**：

| 校验项 | 规则 |
|---|---|
| 文件格式 | 仅 `.csv`，大小 ≤ 500KB，行数 ≤ 5000 |
| 表头匹配 | 必须包含指定列名，顺序不限 |
| 学生标识 | loginName 必须在本班学生列表中存在 |
| 题号匹配 | 题号必须在当前作业中存在 |
| 分数格式 | 数字且在合理范围内 |
| 判题结果 | 必须是 CORRECT / WRONG / PARTIAL 之一 |

**预览报告内容**：

- 总行数、成功行数、失败行数
- 失败行列表：行号 + 学生 + 题号 + 失败原因
- 前 10 行成功数据预览（确认格式正确）

**边界场景**：

| 场景 | 处理 |
|---|---|
| 文件为空 / 只有表头 | 提示"无有效数据"，不进入下一步 |
| 部分行失败 | 展示失败明细，教师可选择"导入成功行"或"全部取消" |
| 重复导入 | 同一学生同一题已有答题 → 提示覆盖风险，教师确认后覆盖 |
| 超大文件 | 前端拦截文件大小，后端二次校验 |

---

### 5.4 F7 AI 讲评草稿生成（P0）

**功能描述**：

教师在作业详情页或统计看板上，可单题或批量触发 AI 生成讲评草稿。系统校验该题是否有完整的标准答案和评分说明，缺失则直接标记为 `NEEDS_MANUAL`，不调用 AI。AI 输出为结构化 JSON，解析后分字段存入 `ReviewDraft`。

**AI 输入（严格）**：

1. 题目原文 `stemText`
2. 标准答案 `answerText` + `rubricText` + `commonMistakeNote`
3. 该题错误分布 `ErrorStat`
4. 常见错因样本（3-5 条 `teacherNote` 摘要）

**前置校验（P0）**：
- 若 `StandardAnswer` 缺失 **或** `rubricText` 为空 → 状态直接置 `NEEDS_MANUAL`，不调用 AI
- UI 显示"缺依据，需教师补充"，并提供快捷跳转到标准答案编辑页

**AI 输出结构（P0，与 ReviewDraft 字段一一对应）**：

```json
{
  "summary": "本次第五题主要错在去分母步骤未同时乘所有项……",
  "knowledgePoints": ["kp-001", "kp-003"],
  "errorCauses": [
    {"cause": "移项变号错误", "count": 12, "evidence": "抽样批改备注：3号、17号……"},
    {"cause": "分数运算错误", "count": 8, "evidence": "抽样批改备注：……"}
  ],
  "explanation": "分步骤讲解正文……",
  "workedExample": "示例题演示……",
  "practiceSuggestions": [
    {"text": "练习A题目描述……", "rationale": "针对移项变号强化训练"}
  ]
}
```

**Mock 生成器（P0）**：按题目 difficulty 和关联知识点数走模板拼接，保证输出结构可解析、有依据字段。通过环境变量 `AI_PROVIDER=mock|openai|deepseek` 切换。

**AI 调用失败兜底（P0）**：任何 Provider 抛错 → 上层捕获 → `ReviewDraft.status = NEEDS_MANUAL`，记录失败原因到日志。

---

### 5.5 F8 草稿审核与编辑（P0，重点改进）

**功能描述**：

教师在草稿审核页并排查看 AI 输入依据和生成的草稿内容。草稿内容按结构化字段分块展示，每块可独立编辑。每次保存修改都会生成一个版本快照，教师可查看历史版本并回退。审核通过后发布，发布后学生可见。

**页面布局**：

```
┌─ 讲评草稿 #D-042 ──────────────────────── 状态: DRAFT ─┐
│                                                        │
│  ┌── 依据（只读，AI 输入源）────┐  ┌── AI 草稿（可编辑）──┐  │
│  │ 📝 题目原文                  │  │ 📌 摘要             │  │
│  │  "第五题：解一元一次方程…"   │  │ [可编辑文本框]       │  │
│  │                             │  │                     │  │
│  │ ✅ 标准答案                  │  │ 🔍 错因分析 (3)      │  │
│  │  "x = 3/2"                  │  │  · 移项变号 12人 ✓  │  │
│  │ 📏 评分说明                  │  │  · 分数运算 8人  ✓  │  │
│  │  "步骤分：移项/合并/结果…"   │  │  [+ 添加错因]       │  │
│  │ 🔗 关联知识点                │  │                     │  │
│  │  · 一元一次方程解法          │  │ 📖 分步讲解          │  │
│  │  · 分数运算                  │  │  [可编辑文本框]       │  │
│  │ 📊 该题错误分布              │  │                     │  │
│  │  错 25 / 半对 7 / 对 13      │  │ 💡 示例题            │  │
│  │ 👤 抽样批改备注              │  │  [可编辑文本框]       │  │
│  │  "3 号：去分母时未同时乘"    │  │                     │  │
│  └─────────────────────────────┘  │ 📝 候选练习 (2)      │  │
│                                   │  ☐ 练习 A [编辑/删除]│  │
│                                   │  ☐ 练习 B [编辑/删除]│  │
│                                   │  [+ 添加练习]       │  │
│                                   └─────────────────────┘  │
│                                                        │
│  [ 版本历史 ▾ ]  [ 重新生成 ]  [ 手工改写 ]            │
│  [ ❌ 拒绝 ]                    [ ✏️ 保存 ]  [ ✅ 发布 ] │
└────────────────────────────────────────────────────────┘
```

**版本历史（P1）**：

- 每次"保存修改"或"重新生成"都创建一条 `ReviewDraftVersion` 记录
- 版本列表显示：版本号、操作人、操作时间、操作类型（AI生成/人工修改/重新生成）
- 点击版本可预览当时的内容快照
- 提供"恢复到此版本"操作（恢复后自动生成新版本号，不覆盖历史）

**发布规则**：

- 发布后草稿状态变为 `PUBLISHED`，同时创建 `PublishedReview` 记录
- 已发布的草稿不能再编辑；如需修改，需先撤回（生成新草稿版本）
- 撤回后学生端不再显示该讲评

**边界场景**：

| 场景 | 处理 |
|---|---|
| 题目/答案在草稿生成后被修改 | 草稿页提示"依据已变更，建议重新生成"，但不强制 |
| 并发编辑（两人同时改同一份草稿） | 保存时校验 updatedAt，冲突时提示"已有更新，请刷新后重试" |
| 草稿被拒绝 | 状态变为 `REJECTED`，可选择重新生成或手工改写 |

---

### 5.6 F10 学生订正与提问（P0）

**功能描述**：

学生在讲评页查看题目、标准答案、自己的作答与批改、以及教师发布的讲评内容。学生可提交订正答案（文本形式），也可针对该题提问。提交后状态为待处理，教师端会看到待办。

**订正辅助校验（P1）**：

学生提交订正后，系统可触发 AI 辅助校验（可选开关），生成 `Correction.aiSuggestion` 供教师参考。AI 只给建议，不直接判定对错，最终结果由教师确认。

> **为什么不直接让 AI 判订正**：主观题的步骤分、思路分 AI 难以准确判断，必须由教师把关。AI 辅助只是减轻教师负担，不是替代。

---

### 5.7 其他模块简述

**F2 班级与学生管理（P0）**：教师创建班级；学生账号由系统预置（虚构，`student01…45`），教师可把这些预置学生**加入/移出**本班（按 loginName 操作），但不创建、不删除真实学生档案。

**F3 知识点管理（P0）**：教研角色维护知识点树（`parentId` 可空即扁平，已实现层级 CRUD + 删除保护）。教师在录入题目时可多选关联知识点。

**F4 作业与题目管理（P0）**：教师创建作业、录入题目（题干、难度、来源备注）、录入标准答案与评分说明。一题对应一份标准答案。

**F6 错误统计看板（P0）**：按题错误分布（柱状图）、按知识点未掌握比例（列表/柱状图）。高错误率题目突出显示，可一键跳转生成讲评草稿。

**F9 学生端讲评查看（P0）**：学生只能看到已发布且属于自己的讲评。展示题目、标准答案、自己的作答、教师批改、讲评正文。

**F11 订正跟踪与回复（P0）**：教师查看作业下所有学生的订正完成情况（已提交/未提交/已通过/仍错误），可逐条查看订正内容并判定结果，回复学生疑问。

**F13 审计日志（P1）**：记录发布讲评、修改分数、AI 生成、教师查看具体学生错题原文等关键操作。审计表只写不删不改。

**F14 教研角色（P2）**：维护知识点树、查看跨班聚合统计、审核公共讲评模板。默认看不到具体学生明细（PII 隔离）。

---

## 6. AI 专项设计

### 6.1 AI 抽象层设计（P0）

```
lib/ai/provider.ts
  interface AIProvider {
    generateReviewDraft(input: ReviewInput): Promise<ReviewOutput | AIUnavailable>
  }

lib/ai/mock.ts       —— 首版默认，模板拼接
lib/ai/openai.ts     —— 预留
lib/ai/deepseek.ts   —— 预留
```

- 通过 `AI_PROVIDER` 环境变量切换
- 任何 Provider 抛错 → 上层捕获 → 状态 `NEEDS_MANUAL`
- 教师手工撰写入口与 AI 生成入口在 UI 上并列，永远可用

### 6.2 AI 输出质量评估（P1）

首版用 Mock Provider 不涉及真实模型质量，但设计上预留评估维度：

| 评估维度 | 评估方式 | 通过标准 |
|---|---|---|
| 结构完整性 | 校验输出 JSON 是否包含所有必填字段 | 字段齐全且类型正确 |
| 依据一致性 | 检查讲解内容是否与标准答案一致，是否有矛盾 | 无明显事实错误 |
| 知识点关联准确 | 检查关联的知识点是否与题目实际考察点匹配 | 教研人工抽查 |
| 错因归因合理 | 检查错因分析是否与抽样批改备注吻合 | 教师人工判断 |

### 6.3 AI 失败兜底机制（P0）

| 失败场景 | 兜底策略 |
|---|---|
| 缺标准答案/评分说明 | 前置校验拦截，不调 AI，状态 `NEEDS_MANUAL` |
| AI 接口超时 / 网络错误 | 捕获异常，状态 `NEEDS_MANUAL`，记录失败原因 |
| AI 返回格式错误 / 无法解析 | 捕获异常，状态 `NEEDS_MANUAL`，保留原始返回供排查 |
| 模型限流 / 额度用尽 | 同网络错误处理，提示教师稍后重试或手工撰写 |
| 教师对 AI 结果不满意 | 可重新生成、手工修改、或直接拒绝 |

**关键原则**：任何 AI 失败场景下，教师都能通过手工撰写完成业务流程，流程不中断。

### 6.4 AI 安全红线（P0）

- 严禁 AI 直接面向学生输出：所有 AI 内容必经教师审核（技术上由 `PublishedReview` 才对学生可见保证）
- 严禁将未去标识化的学生数据发往外部 LLM：真实 Provider 接入前需二次评审
- 严禁 AI 修改分数或直接判定订正结果：AI 只给建议，最终由教师确认

---

## 7. 页面清单

| # | 路由 | 角色 | 优先级 | 说明 |
|---|---|---|---|---|
| 1 | `/login` | - | P0 | 登录页 + DEMO_MODE 快速登录 |
| 2 | `/teacher/dashboard` | 教师 | P0 | 班级列表 + 快捷入口 |
| 3 | `/teacher/classes/[id]` | 教师 | P0 | 班级详情：学生、作业列表 |
| 4 | `/teacher/knowledge-points` | 教研 | P0 | 知识点维护（首版扁平列表） |
| 5 | `/teacher/assignments/new` | 教师 | P0 | 新建作业 |
| 6 | `/teacher/assignments/[id]` | 教师 | P0 | 作业详情：题目列表 + 状态 |
| 7 | `/teacher/assignments/[id]/questions/[qid]` | 教师 | P0 | 题目+标准答案+评分说明编辑 |
| 8 | `/teacher/assignments/[id]/import-submissions` | 教师 | P0 | 导入答题 CSV（含校验预览） |
| 9 | `/teacher/assignments/[id]/import-grading` | 教师 | P0 | 导入批改 CSV（含校验预览） |
| 10 | `/teacher/assignments/[id]/stats` | 教师 | P0 | 错误分布看板 |
| 11 | `/teacher/assignments/[id]/drafts` | 教师 | P0 | AI 讲评草稿列表（含状态筛选） |
| 12 | `/teacher/drafts/[id]` | 教师 | P0 | 草稿审核页：并排依据 + 结构化编辑 + 版本历史 |
| 13 | `/teacher/assignments/[id]/published` | 教师 | P0 | 已发布讲评列表 |
| 14 | `/teacher/assignments/[id]/corrections` | 教师 | P0 | 订正完成情况、疑问回复 |
| 15 | `/student/dashboard` | 学生 | P0 | 我的作业、错题列表 |
| 16 | `/student/reviews/[id]` | 学生 | P0 | 查看讲评、提交订正、提问 |
| 17 | `/teacher/audit-log` | 教研 | P1 | 审计日志查询 |

---

## 8. API 路由

约定：`/api/*` 全部走服务端鉴权（读 cookie session），返回 JSON。非 GET 请求需 CSRF token。

### 8.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/auth/change-password` | 修改密码 |

### 8.2 班级与知识点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/classes` | 我的班级列表 |
| POST | `/api/classes` | 创建班级 |
| GET | `/api/classes/[id]/students` | 班级学生列表 |
| GET | `/api/knowledge-points` | 知识点列表 |
| POST | `/api/knowledge-points` | 新建知识点 |
| PATCH | `/api/knowledge-points/[id]` | 编辑知识点 |

### 8.3 作业与题目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/assignments` | 作业列表 |
| POST | `/api/assignments` | 新建作业 |
| GET | `/api/assignments/[id]` | 作业详情 |
| PATCH | `/api/assignments/[id]` | 编辑作业 |
| POST | `/api/assignments/[id]/questions` | 批量添加题目 |
| GET | `/api/questions/[id]` | 题目详情 |
| PATCH | `/api/questions/[id]` | 编辑题目 |
| PUT | `/api/questions/[id]/standard-answer` | 设置/更新标准答案 |

### 8.4 导入与统计

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/assignments/[id]/import-submissions/preview` | 答题 CSV 预览校验 |
| POST | `/api/assignments/[id]/import-submissions` | 确认导入答题 |
| POST | `/api/assignments/[id]/import-grading/preview` | 批改 CSV 预览校验 |
| POST | `/api/assignments/[id]/import-grading` | 确认导入批改 |
| GET | `/api/assignments/[id]/stats` | 错误分布统计 |

### 8.5 AI 草稿

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/assignments/[id]/drafts:generate` | 触发 AI 生成（单题或全量） |
| GET | `/api/assignments/[id]/drafts` | 草稿列表 |
| GET | `/api/drafts/[id]` | 草稿详情 |
| PATCH | `/api/drafts/[id]` | 教师修改草稿 |
| GET | `/api/drafts/[id]/versions` | 草稿版本历史（P1） |
| POST | `/api/drafts/[id]/versions/[vid]:restore` | 恢复到某版本（P1） |
| POST | `/api/drafts/[id]:publish` | 发布 |
| POST | `/api/drafts/[id]:reject` | 拒绝 |

### 8.6 学生端

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/me/reviews` | 我的讲评列表 |
| GET | `/api/me/reviews/[id]` | 讲评详情（自动校验归属） |
| POST | `/api/reviews/[id]/corrections` | 提交订正 |
| POST | `/api/reviews/[id]/questions` | 提问 |

### 8.7 订正跟踪

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/assignments/[id]/corrections` | 订正情况列表 |
| PATCH | `/api/corrections/[id]` | 教师判定订正结果 |
| GET | `/api/assignments/[id]/student-questions` | 学生疑问列表 |
| POST | `/api/student-questions/[id]/reply` | 回复疑问 |

---

## 9. 安全与隐私（K12 专项）

> 本项目只用虚构数据，但仍按真实未成年人数据保护强度实现，作为设计底线。

### 9.1 认证安全（P0）

- 密码存储：bcrypt cost 12，永不明文
- 登录锁定：失败 5 次锁定 15 分钟
- 会话管理：服务端 Session 表 + 不透明 sessionId + httpOnly cookie
- 登出/改密：撤销所有 session，强制重登

### 9.2 授权安全（P0）

- 学生侧：自动注入 `studentId = session.userId`，用 404 防资源泄露
- 教师侧：按班级归属校验，跨班访问统一返回 404（与 §2.2 一致，防枚举）
- 教研侧：默认 PII 隔离，只能看聚合统计

### 9.3 输入安全（P0）

- CSRF：double-submit cookie 模式
- 输入校验：zod 校验所有请求体
- 文件上传：限大小 500KB、限扩展名、行数上限 5000
- Markdown 渲染：禁用 raw HTML；学生提交文本走白名单

### 9.4 数据最小化（P0）

- 学生档案只保留：loginName、显示名（虚构）、班级归属
- 不采集：真实姓名、身份证、手机号、照片、家庭住址、家长信息、设备指纹、地理位置
- `Grading.teacherNote` 允许教师写备注，但 seed 提示中禁止包含真实姓名

### 9.5 审计（P1）

- `AuditLog`：发布讲评、修改分数、AI 生成、教师查看具体学生错题原文，均记录
- `LoginAudit`：登录成功/失败均记录，含 IP 与 UA
- 审计表只写不删不改（应用层无 UPDATE/DELETE API）

### 9.6 红线声明（P0，README 首页大字写清）

- 严禁导入真实学生姓名/学号/家长联系方式
- 严禁将任何输入发往外部 LLM API 前未做去标识化处理
- 严禁 AI 直接面向学生输出：所有 AI 内容必经教师审核

---

## 10. 里程碑

| M | 内容 | 优先级 | 交付物 |
|---|---|---|---|
| **M1** | 脚手架 + 数据库 + seed + 认证体系（登录/会话/登出/改密） | P0 | `npm run dev` 起来，三种角色用密码分别登录、退出 |
| **M2** | 路由守卫 + 班级管理 / 知识点 / 作业题目 CRUD | P0 | 越权访问返回 403/404；教师只能改自己班级 |
| **M3** | CSV 导入（含校验预览） + 统计看板 | P0 | 看到错误分布；导入失败有明确提示 |
| **M4** | AI Provider + Mock + 草稿生成（结构化存储） | P0 | 草稿列表、缺依据状态、结构化字段存储 |
| **M5** | 草稿审核页（并排依据 + 结构化编辑） + 发布 | P0 | 教师审核流程闭环 |
| **M6** | 学生端：查看讲评 / 订正 / 提问 | P0 | 学生闭环 |
| **M7** | 订正跟踪 + 教师回复 | P0 | 教师可查看订正情况、判定结果、回复疑问 |
| **M8** | 草稿版本历史 + AI 订正辅助校验 | P1 | 可查看历史版本、可回退；AI 辅助判订正 |
| **M9** | 审计日志 + 安全打磨 | P1 | 关键操作可追溯 |
| **M10** | UI 打磨 + README + 部署演示脚本 | P0 | 交付 |

---

## 11. 验收场景与实现点对照

| # | 验收场景 | 对应模块 | 验证方式 |
|---|---|---|---|
| 1 | 教师导入批改结果后，系统能形成正确的错误分布 | F5 + F6 | 导入 45 份批改 CSV，统计看板数字与手动计算一致 |
| 2 | AI 讲评能够关联题目、标准答案和知识点依据 | F7 + F8 | 草稿页能看到三道依据（原题/答案/知识点），且与生成时快照一致 |
| 3 | 缺少依据的题目被标记为待教师处理，而不是编造讲解 | F7 | Q5 留空标准答案 → 状态直接 NEEDS_MANUAL，不调 AI |
| 4 | 未经教师确认的草稿不会展示给学生 | F8 + F9 | 学生端只看到 PUBLISHED 状态的讲评，DRAFT 状态的完全不可见 |
| 5 | 学生只能查看自己的成绩、讲评和订正记录 | F1 + F9 | 学生 A 登录后访问学生 B 的讲评 URL → 返回 404 |
| 6 | 教师修改并发布后，学生能够订正并提交疑问 | F6 + F10 | 教师发布 → 学生刷新可见 → 提交订正 → 教师端能看到 |
| 7 | 模型调用失败时，教师仍能手工完成讲评发布 | F7 + F8 | MOCK_AI_FAIL=true 环境下，走手工撰写路径并成功发布 |
| 8 | 草稿修改有版本历史，可回退 | F8（P1） | 修改草稿 2 次 → 版本列表有 3 条记录 → 恢复到 v1 → 内容正确 |
| 9 | CSV 导入有校验预览，错误行有明确提示 | F5 | 上传格式错误的 CSV → 预览页显示失败行和原因 → 可选择只导入成功行 |

---

## 12. 虚构数据 Seed 计划

- 1 位教师（teacher01）、1 位教研（researcher01）、1 位跨班教师（teacher02）
- 45 名学生（student01 … student45），虚构显示名"学生 1 号"…
- 1 个班级，45 名学生全部在班
- 8-10 个知识点（扁平列表，不做树）
- 1 次作业 5 道题：
  - Q1-Q4 有完整标准答案 + 评分说明
  - Q5 标准答案留空 → 演示"缺依据 → NEEDS_MANUAL"
- 45 份答题 + 批改 CSV，Q5 高错误率
- 预置 AI Mock 生成规则，让 Q1-Q4 都能出草稿

### 12.1 预置账号

| loginName | 初始密码 | 角色 | 备注 |
|---|---|---|---|
| `teacher01` | `Demo@2026` | 教师 | 带 1 个班 45 人 |
| `teacher02` | `Demo@2026` | 教师 | 演示跨班越权 |
| `student01` … `student45` | `Demo@2026` | 学生 | 虚构显示名 |
| `researcher01` | `Demo@2026` | 教研 | 只看知识点与聚合统计 |

---

## 13. 明确不做

- 不接入真实学校教务系统和未成年人个人数据
- 不做人脸识别、课堂监控和行为评分
- 不让 AI 自动评分主观题或决定成绩/订正结果
- 不建设直播、题库商城和完整在线考试平台
- ~~首版不做知识点树~~（v2.1 调整：知识点树已实现，扁平为其特例）
- 首版不做教研的公共模板审核

---

## 14. 技术选型

- **Next.js 14 App Router** + TypeScript
- **Prisma** + **SQLite**（`dev.db`，无需外部服务）
- **Tailwind CSS** + shadcn/ui
- **Recharts** 错误分布图表
- **zod** 校验
- **Auth**：bcrypt + 服务端 Session 表 + httpOnly cookie + CSRF
