# 初中数学作业讲评与错题跟踪助手 · 方案设计

> 挑战赛道大作业 · AI 原生 Web 业务系统
> 版本：v0.1 草案 · 待评审

---

## 0. 一句话定位

教师批改完作业之后，用 AI 起草讲评、教师审核发布、学生订正反馈、教师跟踪改进的**闭环系统**。AI 是流程里的一环，不是外挂聊天框。

## 1. AI 原生四特征如何满足

| 特征 | 本项目落点 |
|---|---|
| 接收自然语言输入 | 题面文本、标准答案文本、评分说明、教师批改备注、学生疑问 |
| AI 转成结构化候选 | 生成 `ReviewDraft`（讲评草稿，含知识点、错因、讲解段、候选练习） |
| 用户可看依据、可改 | 讲评草稿页强制展示原题、标准答案、评分依据；教师改后发布 |
| AI 失败仍可人工完成 | AI 调用异常 → 状态置为 `NEEDS_MANUAL`；教师手工撰写讲评入口始终可用 |

## 2. 角色与权限

| 角色 | 权限范围 |
|---|---|
| 教师 | 管理自己带班的班级/作业/题目/批改；触发 AI 草稿；编辑、发布讲评；查看本班学生订正情况 |
| 学生 | 只能看**自己**的成绩、讲评、订正记录；提交订正、提问 |
| 教研负责人 | 维护全局知识点树、公共讲评模板；审核跨班共享的讲评 |

首版数据模型只区分权限边界，UI 上不做多角色切换演示，通过"以某身份登录"的简化机制演示（Demo 账号）。

## 3. 数据分层（挑战点里强调的"区分"）

```
┌─ 原始事实层（教师录入，唯一真相源） ─────────────────┐
│  Assignment 作业                                  │
│  Question 题目 · StandardAnswer 标准答案 · Rubric 评分说明 │
│  Submission 学生答题 · Grading 教师批改结果            │
└──────────────────────────────────────────────────┘
                    ↓ 派生
┌─ 统计层（系统只读，可重算） ────────────────────────┐
│  ErrorStat 题目/知识点错误分布                       │
└──────────────────────────────────────────────────┘
                    ↓ 喂给 AI
┌─ AI 草稿层（未发布，教师可改） ─────────────────────┐
│  ReviewDraft 讲评草稿 · 每条关联 questionId +       │
│  standardAnswerId + knowledgePointIds             │
│  PracticeSuggestion 候选练习                        │
└──────────────────────────────────────────────────┘
                    ↓ 教师审核
┌─ 正式结论层（教师署名发布） ────────────────────────┐
│  PublishedReview 已发布讲评（面向学生）              │
│  Correction 学生订正 · StudentQuestion 疑问         │
└──────────────────────────────────────────────────┘
```

**关键不变量**：学生只能看到 `PublishedReview`，永远不能看到 `ReviewDraft`。

## 4. 数据模型（表结构）

> 采用 SQLite + Prisma。字段列核心，非全。

### 4.1 用户与组织
- `User` (id, name, **loginName 唯一**, **passwordHash (bcrypt)**, role: TEACHER/STUDENT/RESEARCHER,
  mustChangePassword, failedAttempts, lockedUntil, lastLoginAt, createdAt)
- `Session` (id, userId, tokenHash, userAgent, ip, expiresAt, revokedAt, createdAt)
  — 服务端会话表，可撤销；cookie 只存不透明 sessionId
- `ClassRoom` (id, name, teacherId) — 班级
- `ClassEnrollment` (classId, studentId, joinedAt) — 虚构学生与班的关联
- `LoginAudit` (id, loginName, ok, ip, ua, at) — 登录尝试审计（成功/失败都记）

### 4.2 教学内容
- `KnowledgePoint` (id, code, name, parentId, description) — 树状知识点，教研维护
- `Assignment` (id, classId, title, dueDate, createdBy, status)
- `Question` (id, assignmentId, seq, stemText, difficulty, sourceNote)
- `QuestionKnowledgePoint` (questionId, knowledgePointId) — 多对多
- `StandardAnswer` (id, questionId, answerText, rubricText, commonMistakeNote) — 一题一版
  - 唯一约束：`(questionId)` 保证 AI 引用不歧义

### 4.3 答题与批改
- `Submission` (id, questionId, studentId, answerText, submittedAt)
- `Grading` (id, submissionId, score, verdict: CORRECT/WRONG/PARTIAL, teacherNote, gradedAt)

### 4.4 统计（派生，可重算）
- `ErrorStat` (assignmentId, questionId, knowledgePointId?, total, wrongCount, partialCount, updatedAt)

### 4.5 AI 草稿
- `ReviewDraft` (id, questionId, assignmentId, status: DRAFT/NEEDS_MANUAL/APPROVED/PUBLISHED/REJECTED,
  basedOnQuestionSnapshot, basedOnAnswerSnapshot, basedOnErrorSummary,
  draftContent, modelTag, createdAt, updatedAt)
- `ReviewDraftKnowledge` (draftId, knowledgePointId)
- `PracticeSuggestion` (id, draftId, questionRefText, rationale)

### 4.6 正式发布与学生反馈
- `PublishedReview` (id, draftId, classId, finalContent, publishedBy, publishedAt)
- `Correction` (id, publishedReviewId, studentId, submissionId, correctedAnswerText, status: PENDING/RESOLVED/STILL_WRONG, teacherResolvedNote, updatedAt)
- `StudentQuestion` (id, publishedReviewId, studentId, questionText, teacherReply, createdAt, repliedAt)

### 4.7 审计
- `AuditLog` (id, actorId, action, entity, entityId, before, after, at)
  - 记录发布、改分、AI 触发等关键动作

## 5. 核心业务流程

### 5.1 主链路（教师视角）
```
建班级 → 维护知识点 → 布置作业 → 录入题目/标准答案/评分说明
      → 关联知识点 → 导入学生答题（CSV 或手工）
      → 录入批改结果 → 系统算错误分布
      → 触发 AI 生成讲评草稿（按题）
      → 教师逐条审：接受 / 改后接受 / 拒绝
      → 发布讲评（可选：先教研审核）
      → 查看订正完成情况 → 处理学生疑问
```

### 5.2 AI 生成逻辑（关键）
输入（严格）：
1. 题目原文 `stemText`
2. 标准答案 `answerText` + `rubricText` + `commonMistakeNote`
3. 该题错误分布 `ErrorStat`（哪个知识点错得多）
4. 常见错因样本（3-5 条 `teacherNote` 摘要）

**前置校验**：若 `StandardAnswer` 缺失 或 `rubricText` 为空 → 状态直接置 `NEEDS_MANUAL`，**不调用 AI**，UI 显示"缺依据，需教师补充"。

输出（结构化 JSON）：
```json
{
  "summary": "本次第五题主要错在……",
  "knowledgePoints": ["kp-001", "kp-003"],
  "errorCauses": [{"cause": "...", "count": 12, "evidence": "抽样批改备注"}],
  "explanation": "分步骤讲解……",
  "workedExample": "示例题演示……",
  "practiceSuggestions": [{"text": "...", "rationale": "..."}]
}
```

Mock 生成器：按题目 difficulty 和知识点数走模板拼接；保证输出结构可解析、有依据字段。

## 6. 页面清单

| # | 路由 | 角色 | 说明 |
|---|---|---|---|
| 1 | `/` | - | 登录/身份选择 |
| 2 | `/teacher/dashboard` | 教师 | 班级列表 + 快捷入口 |
| 3 | `/teacher/classes/[id]` | 教师 | 班级详情：学生、作业 |
| 4 | `/teacher/knowledge-points` | 教研 | 知识点树维护 |
| 5 | `/teacher/assignments/new` | 教师 | 新建作业 |
| 6 | `/teacher/assignments/[id]` | 教师 | 作业详情：题目列表 + 状态 |
| 7 | `/teacher/assignments/[id]/questions/[qid]` | 教师 | 题目+标准答案+评分说明编辑 |
| 8 | `/teacher/assignments/[id]/import` | 教师 | 导入答题 CSV / 手工录入 |
| 9 | `/teacher/assignments/[id]/grading` | 教师 | 批改结果录入/导入 |
| 10 | `/teacher/assignments/[id]/stats` | 教师 | 错误分布看板（按题/知识点） |
| 11 | `/teacher/assignments/[id]/drafts` | 教师 | AI 讲评草稿列表（含状态） |
| 12 | `/teacher/drafts/[id]` | 教师 | **单条草稿审：并排展示依据 + 可编辑正文** |
| 13 | `/teacher/assignments/[id]/published` | 教师 | 已发布讲评 |
| 14 | `/teacher/assignments/[id]/corrections` | 教师 | 订正完成情况、追问 |
| 15 | `/student/dashboard` | 学生 | 我的作业、错题 |
| 16 | `/student/reviews/[id]` | 学生 | 查看讲评、提交订正、提问 |

## 7. API 路由（Next Route Handlers）

约定：`/api/*` 全部走服务端鉴权（读 cookie session），返回 JSON。

- `POST /api/auth/login`
- `GET /api/classes`, `POST /api/classes`
- `GET /api/knowledge-points`, `POST /api/knowledge-points`
- `GET/POST /api/assignments`, `GET/PATCH /api/assignments/[id]`
- `POST /api/assignments/[id]/questions` 批量
- `PUT  /api/questions/[id]/standard-answer`
- `POST /api/assignments/[id]/import-submissions` (CSV)
- `POST /api/assignments/[id]/import-grading`   (CSV)
- `GET  /api/assignments/[id]/stats`
- `POST /api/assignments/[id]/drafts:generate`  触发 AI（单题或全量）
- `GET  /api/drafts/[id]`
- `PATCH /api/drafts/[id]`                     教师修改
- `POST /api/drafts/[id]:publish`              发布
- `POST /api/drafts/[id]:reject`               拒绝
- `GET  /api/me/reviews`                       学生拉自己的
- `POST /api/reviews/[id]/corrections`         学生提交订正
- `POST /api/reviews/[id]/questions`           学生提问

## 8. AI 调用抽象（可替换接口）

```
lib/ai/provider.ts
  interface AIProvider {
    generateReviewDraft(input: ReviewInput): Promise<ReviewOutput | AIUnavailable>
  }
lib/ai/mock.ts       —— 首版默认
lib/ai/openai.ts     —— 预留（环境变量切换）
lib/ai/deepseek.ts   —— 预留
```

- 通过 `AI_PROVIDER=mock|openai|deepseek` 环境变量切换。
- 任何 Provider 抛错 → 上层捕获 → `ReviewDraft.status = NEEDS_MANUAL`。
- 教师手工撰写入口与 AI 生成入口在 UI 上并列，**永远可用**。

## 9. 目录结构

```
D:/ai/
  PLAN.md                        ← 本文件
  README.md
  package.json
  prisma/
    schema.prisma
    seed.ts                      ← 虚构数据
  src/
    app/
      layout.tsx
      page.tsx
      (auth)/login/page.tsx
      teacher/...                ← 页面清单第 2-14 项
      student/...                ← 第 15-16 项
      api/...                    ← API 路由
    components/
      DraftEditor.tsx            ← 依据+草稿并排
      ErrorStatChart.tsx
      KnowledgePointTree.tsx
    lib/
      db.ts                      ← Prisma client 单例
      auth.ts                    ← session 与角色守卫
      ai/
        provider.ts
        mock.ts
      csv.ts
      types.ts
  .env.example
```

## 10. 技术选型细节

- **Next.js 14 App Router** + TypeScript
- **Prisma** + **SQLite**（`dev.db`，无需外部服务）
- **Tailwind CSS** + shadcn/ui（表单/表格/对话框）
- **Recharts** 错误分布柱图/饼图
- **zod** 校验 CSV 导入和 AI 输出
- **Auth**：真实密码登录。bcrypt (cost 12) 存哈希；服务端 `Session` 表 + 不透明 sessionId
  写入 `httpOnly; SameSite=Lax; Secure(prod)` cookie；写操作带 CSRF token；登录失败 5 次锁 15 分钟
- **不做**：真实学校教务接入、未成年人真实数据、人脸识别、直播、题库商城、在线考试

## 11. 核心验收场景 → 实现点对照

| 验收场景 | 实现点 |
|---|---|
| 导入批改后形成正确错误分布 | `/api/.../import-grading` 写入后触发 `ErrorStat` 重算 |
| AI 讲评关联题目/标准答案/知识点 | `ReviewDraft.basedOn*Snapshot` 三字段非空，草稿页强制展示 |
| 缺依据 → 标记待处理而非编造 | 生成前校验 `StandardAnswer` 存在且 `rubricText` 非空 → 状态 `NEEDS_MANUAL` |
| 未确认草稿不展示给学生 | 学生接口只查 `PublishedReview`，`ReviewDraft` 无学生侧读路径 |
| 学生只能看自己 | 服务端 session 强制注入 `studentId = session.userId`；URL 参数只作为**过滤条件**，永远不作为**授权依据**；教师接口按 `ClassRoom.teacherId` 校验班级归属 |
| 教师发布后学生能订正/提问 | `/student/reviews/[id]` 提供订正提交与提问入口 |
| 模型失败仍可手工发布 | AI 抛错→状态 `NEEDS_MANUAL`；教师手工撰写 UI 与 AI 入口并列 |

## 12. 文字原型（关键 3 页）

### 12.1 讲评草稿审核页 `/teacher/drafts/[id]`
```
┌─ 讲评草稿 #D-042 ──────────────────────── 状态: DRAFT ─┐
│                                                        │
│  ┌── 依据（只读，AI 输入源）────┐  ┌── AI 草稿 ──────┐  │
│  │ 📝 题目原文                  │  │ 摘要            │  │
│  │  "第五题：解一元一次方程…"   │  │ "本题主要错在…" │  │
│  │                             │  │                 │  │
│  │ ✅ 标准答案                  │  │ 错因分析 (3)    │  │
│  │  "x = 3/2"                  │  │  · 移项变号 12人│  │
│  │ 📏 评分说明                  │  │  · 分数运算 8人 │  │
│  │  "步骤分：移项/合并/结果…"   │  │  · 检验未做 5人 │  │
│  │ 🔗 关联知识点                │  │                 │  │
│  │  · 一元一次方程解法          │  │ 分步讲解        │  │
│  │  · 分数运算                  │  │  1. …           │  │
│  │ 📊 该题错误分布              │  │  2. …           │  │
│  │  错 25 / 半对 7 / 对 13      │  │                 │  │
│  │ 👤 抽样批改备注              │  │ 候选练习 (2)    │  │
│  │  "3 号：去分母时未同时乘"    │  │  ☐ 练习 A       │  │
│  │  "17 号：正负号弄反"         │  │  ☐ 练习 B       │  │
│  └─────────────────────────────┘  └─────────────────┘  │
│                                                        │
│  [ 手工改写整段 ]  [ 重新生成 ]                         │
│  [ ❌ 拒绝 ]           [ ✏️ 保存修改 ]   [ ✅ 发布 ]    │
└────────────────────────────────────────────────────────┘
```

### 12.2 作业统计看板 `/teacher/assignments/[id]/stats`
```
共 45 名学生 · 5 道题
┌── 按题错误分布 ─────────────────┐  ┌── 按知识点未掌握 ──────┐
│ Q1 ███████░ 72% ✓               │  │ 一元一次方程解法 44%   │
│ Q2 ████░░░░ 42%                 │  │ 分数运算        38%    │
│ Q3 ██░░░░░░ 18%                 │  │ 移项变号        67% ⚠  │
│ Q4 █████░░░ 51%                 │  │ 应用题建模      22%    │
│ Q5 ███░░░░░ 15%  ← 高错误       │  │                        │
│ [ 为 Q5 生成讲评草稿 → ]        │  │                        │
└─────────────────────────────────┘  └────────────────────────┘
```

### 12.3 学生讲评页 `/student/reviews/[id]`
```
┌─ Q5 · 讲评 ─────────── 已由 张老师 发布 ─┐
│                                          │
│ 题目：解方程 (2x+1)/3 - (x-2)/2 = 1      │
│ 标准答案：x = 13/7                        │
│                                          │
│ 你的作答：x = 13/5                        │
│ 批改：错误 · 老师备注 "去分母时未同时乘"   │
│                                          │
│ ── 讲评 ──                               │
│ 本题主要错在去分母步骤……                  │
│                                          │
│ ── 完成订正 ──                            │
│ ┌──────────────────────────────────────┐ │
│ │ 请重写你的解答过程：                  │ │
│ │ [textarea]                           │ │
│ └──────────────────────────────────────┘ │
│              [ 提交订正 ]                 │
│                                          │
│ ── 还有疑问？──                           │
│ [input…                    ] [ 提问 ]    │
└──────────────────────────────────────────┘
```

## 13. 虚构数据 seed 计划

- 1 位教师、1 位教研、45 名学生
- 3 个知识点（一元一次方程解法、移项变号、分数运算）
- 1 次作业 5 道题，其中：
  - Q1-Q4 有完整标准答案+评分说明
  - Q5 标准答案留空 → 演示"缺依据 → NEEDS_MANUAL"
- 45 份答题 + 批改 CSV，Q5 高错误率
- 预置 AI Mock 生成规则，让 Q1-Q4 都能出草稿

## 14. 里程碑（等你 OK 后开工）

| M | 内容 | 交付物 |
|---|---|---|
| M1 | 脚手架 + 数据库 + seed + **真实密码登录/会话/登出/改密** | `npm run dev` 起来，三种角色用密码分别登录、退出 |
| M2 | 路由守卫 + 班级管理 / 知识点 / 作业题目 CRUD | 越权访问返回 403；教师只能改自己班级 |
| M3 | CSV 导入答题与批改 + 统计看板 | 看到错误分布 |
| M4 | AI Provider + Mock + 草稿生成 | 草稿列表、缺依据状态 |
| M5 | 草稿审核页（并排展示依据） + 发布 | 教师审核流程闭环 |
| M6 | 学生端：查看/订正/提问 | 学生闭环 |
| M7 | AI 失败兜底 & 手工撰写 & 审计日志 | 演示时拔掉 LLM 也能走完 |
| M8 | 打磨 UI、README、部署演示脚本 | 交付 |

## 15. 明确不做（写在 README 首页）

- ❌ 真实学生数据 / 未成年人隐私（严格使用虚构数据）
- ❌ 自动评分主观题
- ❌ AI 直接发布（无教师审核）
- ❌ 直播 / 题库商城 / 完整在线考试
- ❌ 人脸识别 / 课堂监控 / 行为评分

## 16. 隐私与安全（针对 K12 / 未成年人场景）

> 本项目**只用虚构数据**，但仍按真实未成年人数据保护强度实现，作为设计底线。

### 16.1 认证
- **密码存储**：bcrypt (cost 12)，永不明文；日志、错误消息中不回显密码
- **登录策略**：失败 5 次锁定 15 分钟；账号状态字段 `failedAttempts / lockedUntil`
- **会话**：`Session` 表存 `tokenHash`（不透明随机串 SHA-256 后的哈希），数据库是唯一真相；
  cookie 只携带 `sessionId`，`httpOnly + SameSite=Lax + Secure(prod)`
- **登出/改密**：撤销当前用户**所有** session；密码修改后强制重登
- **首登改密**：seed 出来的账号 `mustChangePassword=true`，展示初始密码只出现在 seed 输出的 README 中

### 16.2 授权（关键：URL 参数不能授权）
所有服务端 handler 走统一守卫 `requireRole(...)` 与 `requireScope(...)`：
- **学生**：任何查询自动加 `WHERE studentId = session.userId`；即使 URL 是
  `/student/reviews/123`，服务端仍校验 `review.studentId == session.userId`，不匹配返回 404
  （用 404 不用 403，避免泄露资源是否存在）
- **教师**：只能操作 `ClassRoom.teacherId == session.userId` 的班级；跨班访问 403
- **教研**：可读知识点树、跨班聚合统计；**默认不能看具体学生的答题原文**（PII 隔离），
  除非教师主动分享某条讲评到公共模板库

### 16.3 CSRF & 输入
- 所有非 GET `/api/*` 需 CSRF token（double-submit cookie 模式）
- `zod` 校验所有请求体；文件上传（CSV）限大小 500 KB、限扩展名、行数上限 5000
- Markdown 渲染禁用 raw HTML；学生提交文本走白名单

### 16.4 数据最小化
学生档案只保留：`loginName`、显示名（虚构）、班级归属。**不采集**：真实姓名、身份证、手机号、
照片、家庭住址、家长信息、设备指纹、地理位置。

`Grading.teacherNote` 允许教师写备注，但 seed 提示中禁止包含真实姓名。

### 16.5 审计
- `AuditLog`：发布讲评、修改分数、AI 生成、教师查看具体学生错题原文，均记录
- `LoginAudit`：登录成功/失败均记录，含 IP 与 UA
- 审计表**只写不删不改**（应用层无 UPDATE/DELETE API）

### 16.6 传输与存储
- 生产环境强制 HTTPS（HSTS）
- `.env` 不入库；提供 `.env.example`
- `dev.db`（SQLite 文件）加入 `.gitignore`，防误提交
- 备份/导出功能只导出**聚合统计**，不导出学生明细，除非教师登录状态下主动请求且写审计

### 16.7 删除权（虚构数据下仍实现）
- 学生可请求删除本人订正/疑问记录（教师批改结果保留匿名版以维持统计）
- 教师离职模拟：管理员可换班主任，历史作业归属保留 `originalTeacherId`

### 16.8 明确红线（README 首页大字写清）
- 严禁导入真实学生姓名/学号/家长联系方式
- 严禁将任何输入发往外部 LLM API 前未做去标识化处理；本项目 Mock Provider 不外发；
  真实 Provider 接入前需二次评审
- 严禁 AI 直接面向学生输出：所有 AI 内容必经教师审核（技术上由 `PublishedReview` 才对学生可见保证）

## 17. 登录与演示说明

> 目的：把 §16 的密码/会话/授权落到可操作的流程上，避免"设计很严但演示进不去"。

### 17.1 凭证约定

Seed 预置账号，密码 bcrypt 后入库；明文只出现在 seed 控制台输出与生成的 `SEED_ACCOUNTS.md`
（`.gitignore` 掉）。

| loginName | 初始密码 | 角色 | 备注 |
|---|---|---|---|
| `teacher01` | `Demo@2026` | 教师 | 带 1 个班 45 人 |
| `teacher02` | `Demo@2026` | 教师 | 演示跨班越权 |
| `student01` … `student45` | `Demo@2026` | 学生 | 虚构显示名 "学生 1 号"… |
| `researcher01` | `Demo@2026` | 教研 | 只看知识点与聚合统计 |

密码规则：≥ 8 位、包含大小写与数字；`Demo@2026` 满足。

### 17.2 DEMO_MODE 开关

生产 build 与开发默认走完整安全策略。演示时通过环境变量放宽体验，**不放宽授权**：

```bash
# .env.local
DEMO_MODE=true        # 关掉首次强制改密 + 关掉登录失败锁定
```

- `DEMO_MODE=true` 时：
  - `mustChangePassword` 不弹窗拦截
  - 登录失败不累计 `failedAttempts`
  - `/login` 页底部渲染"快速登录"按钮（下节）
- **不影响**：密码哈希、会话机制、行级授权、CSRF、审计
- **构建期保护**：`next build` 时若 `NODE_ENV=production` 且 `DEMO_MODE=true` → 直接抛错

### 17.3 登录页与快速登录

`/login` 结构：
```
┌───────────────────────────────┐
│   登录 · 数学作业讲评助手      │
│                               │
│  账号 [________]              │
│  密码 [________]              │
│  [ 登 录 ]                    │
│                               │
│  ─── 开发模式快速登录 ───     │  ← 仅 DEMO_MODE=true
│  [ 张老师 ] [ 学生 3 号 ]      │
│  [ 教研   ] [ 教师 2 号 ]      │
└───────────────────────────────┘
```
点击 → `POST /api/auth/login` 带对应 loginName + `Demo@2026`。

### 17.4 会话与登出

- Cookie 名：`sid`；值：`Session.id`（不透明随机串）；服务端存 `tokenHash`
- `httpOnly / SameSite=Lax / Secure(生产) / Path=/ / Max-Age=7d`
- 顶栏右上角"退出登录" → `POST /api/auth/logout` → 撤销当前 session → 清 cookie → 跳 `/login`
- 修改密码 → 撤销该用户**所有** session → 强制重登

### 17.5 多角色并存演示

- 用不同浏览器或隐身窗口分别登录教师 / 学生 / 教研
- 演示越权：学生登录状态下手动访问 `/student/reviews/[otherId]` → 服务端返回 404
- 演示跨班：`teacher02` 访问 `teacher01` 班级下的任何资源 → 403
- 演示 AI 失败：`AI_PROVIDER=mock` + `.env` 加 `MOCK_AI_FAIL=true` 强制抛错 → 演示手工撰写讲评路径

### 17.6 常见卡点与工具

| 卡点 | 处理 |
|---|---|
| 忘了改后的密码 | `npm run reset-password -- <loginName> [新密码]`，CLI 直连数据库 |
| 数据库脏了 | `npm run db:reset` = `prisma migrate reset --force && tsx prisma/seed.ts` |
| 会话不失效 | `npm run revoke-sessions -- <loginName>` 一键踢出 |
| Cookie 域踩坑 | 统一使用 `http://localhost:3000`，不用 `127.0.0.1` |
| CSRF 与登录死锁 | 访问 `/login` 时 GET 返回匿名 CSRF token 塞进 cookie + form 隐藏字段 |

### 17.7 演示脚本（照着念即可）

1. 开 3 个浏览器/隐身窗口：A=Chrome 常规、B=Chrome 隐身、C=Firefox
2. A 点"以张老师登录" → 进 `/teacher/dashboard`
3. B 点"以学生3号登录" → 只能看到自己
4. C 点"以教研登录" → 只能看知识点树 + 跨班聚合
5. A：新建作业 → 录题 Q1-Q5 → 只给 Q1-Q4 填标准答案与评分说明（Q5 故意留空）
6. A：导入 45 份答题 CSV → 导入批改 CSV → 打开统计看板
7. A：点"为 Q1-Q5 生成讲评草稿" → Q1-Q4 进入 DRAFT，Q5 直接 `NEEDS_MANUAL`
8. A：打开 Q5 草稿 → 演示"缺依据不调 AI" → 手工撰写 → 发布
9. A：打开 Q1 草稿 → 并排展示依据/草稿 → 编辑 → 发布
10. B：学生刷新 → 看到 Q1、Q5 讲评 → 提交订正 → 提疑问
11. A：查看订正完成情况 → 回复疑问
12. 切 `MOCK_AI_FAIL=true` 重启 A → 演示模型不可用时手工撰写照常走
13. B 手动访问 `/student/reviews/[id 属于他人]` → 404
14. C 尝试打开 `/student/...` → 403

**这一节就是开工 M1 时 `README.md` 的直接来源**：seed 输出与快速登录必须按这里实现。

---

**下一步**：你 review 完这份方案，告诉我 (a) OK 直接开工 M1，或 (b) 需要改的地方（数据模型？页面清单？AI 抽象？里程碑切分？）
