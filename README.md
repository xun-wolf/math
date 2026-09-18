# 初中数学作业讲评与错题跟踪助手

> 挑战赛道大作业 · AI 原生 Web 业务系统 · 教师批改之后的讲评与订正闭环
> 当前进度：**M10 完成（生产构建校验 + DEMO_MODE 守卫 + 空/加载态 + 部署与演示文档）· 全项目 M1–M10 收官**；核心闭环 + 两项 P1 增强 + 审计脱敏导出均已交付

设计文档见 [`PLAN.md`](./PLAN.md)。

## 快速开始

```bash
npm install
npm run db:migrate   # 首次或迁移变更
npm run db:seed      # 灌入虚构数据（45 学生 + 2 教师 + 1 教研）
npm run dev          # http://localhost:3000
```

打开 http://localhost:3000 → 会自动跳到 `/login`。

## 演示账号

见 seed 生成的 `SEED_ACCOUNTS.md`。默认所有账号密码：`Demo@2026`。

| loginName | 角色 |
|---|---|
| teacher01 / teacher02 | 教师 |
| student01 … student45 | 学生 |
| researcher01 | 教研 |

登录页底部有"开发模式快速登录"按钮，一键登入。

## 环境变量（`.env.local`）

| 键 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 路径，默认 `file:./dev.db` |
| `SESSION_SECRET` | ≥32 字符随机串，用于 CSRF 签名 |
| `AI_PROVIDER` | `mock` / `openai` / `deepseek`（M4 起使用） |
| `MOCK_AI_FAIL` | `true` 时 Mock Provider 抛错，演示 AI 不可用兜底 |
| `DEMO_MODE` | `true` 时关闭首次改密与登录锁定；生产构建必须 `false` |

## CLI 工具

```bash
npm run db:reset                                    # 清库 + 重新 seed
npm run db:studio                                   # Prisma Studio 浏览数据
npm run reset-password -- teacher01 NewPass123      # 重置某账号密码并撤销其会话
npm run revoke-sessions -- student03                # 强制某账号下线
```

## 部署（生产）

> 本项目为纯自托管 Next.js 全栈 + SQLite，无外部服务依赖，可直接跑在校内服务器 / 一台云主机上。

```bash
# 1) 准备生产环境变量（不要把 .env.local 提交进仓库）
cp .env.example .env.production.local
#   DATABASE_URL 指向持久化磁盘上的 sqlite 文件（务必放在会被备份的路径）
#   SESSION_SECRET 换成 openssl rand -hex 32 生成的长随机串
#   DEMO_MODE=false（否则 next build 会被 env.ts 守卫直接拒绝）
#   AI_PROVIDER=mock（真实 Provider 接入前需先完成去标识化 + 二次评审，见 PLAN §6.4）

# 2) 安装 + 生成 Prisma 客户端（postinstall 已含 prisma generate）
npm ci

# 3) 迁移（生产用 deploy 而非 dev，避免生成新迁移）
npx prisma migrate deploy
npx prisma db seed          # 仅演示环境需要灌虚构数据；真实部署禁止导入学生个人数据

# 4) 构建 + 启动
DEMO_MODE=false NODE_ENV=production npm run build
DEMO_MODE=false NODE_ENV=production npm run start   # 默认 :3000，可 PORT=xxxx 覆盖
```

- **DEMO_MODE 守卫**：`src/lib/env.ts` 在 `NODE_ENV=production && DEMO_MODE=true` 时抛错，构建/启动即失败，防止把「关闭首次改密 + 关闭登录锁定」的演示态带上生产。
- **备份**：SQLite 是单文件（`DATABASE_URL` 指向处），定期冷备该文件即可；上线前用 `sqlite3 dev.db ".backup 'bk.db'"` 一致性快照。
- **反向代理**：置于 Nginx/Caddy 之后，开启 HTTPS；`Set-Cookie` 在生产自动带 `Secure`（见 `session.ts`），故**必须**走 HTTPS，否则会话 cookie 不下发。
- **进程守护**：`pm2 start npm --name math-review -- start` 或 systemd 单元。

## 演示脚本（评审走查 · 约 5 分钟）

准备：`npm run db:seed` 后，三角色密码均 `Demo@2026`，登录页底部有「开发模式快速登录」。

1. **教师建作业挂知识点** → 登 `teacher01` → 布置作业（选班级）→ 录入题目 + 标准答案 + 关联知识点。
2. **导入答题与批改**（CSV 两步：预览→提交）→ 打开「错误分布看板」看按题 / 按知识点错误率。
3. **AI 生成讲评草稿** → 草稿列表对高错误率题点「生成」→ 进入审核页并排看「依据快照 vs 结构化正文」。
   - 演示「缺依据不生成」：对无标准答案的题生成 → `NEEDS_MANUAL`，提示教师手工撰写（AI 不越权定稿）。
   - 演示「AI 不可用兜底」：`MOCK_AI_FAIL=true` 重启再点生成 → 同样 `NEEDS_MANUAL`，流程不中断。
4. **教师审核 / 编辑 / 发布** → 修改保存生成新版本快照 → 「发布」→ 学生端方可见（必经人工审核）。
5. **学生订正 / 提问** → 登 `student01` → 我的错题 → 查看已发布讲评 → 提交订正 / 向教师提问（看不到他人数据，越权 URL 直接 404）。
6. **教师订正跟踪** → 「订正跟踪」复核：确认掌握 / 标记仍需订正（必填说明）/ 回复提问；可点「✨ AI 点评建议」获得参考后定稿。
7. **教研只读分析 + 脱敏导出** → 登 `researcher01` → 工作台看跨班知识点错误率 + 班级订正掌握率 → 「导出去标识化 CSV」（无姓名/学号/正文，仅聚合）。
8. **审计留痕**（可选）：`npx prisma studio` 打开 `AuditLog`，可见发布/复核/回复/导入/导出等关键动作，且不含任何答题正文。

关键不变量（演示中可强调）：AI 只产草稿、必经教师审核才发布；学生只见 `PublishedReview`；越权统一 404 防枚举；审计与教研导出一律脱敏。

## M1 验收清单

- [x] Next.js 14 全栈 + TypeScript + Tailwind 跑起来
- [x] Prisma + SQLite + 迁移；`prisma/schema.prisma` 覆盖 PLAN §4 全部表
- [x] 真实密码登录（bcrypt）、服务端 Session 表、HttpOnly Cookie
- [x] 登出、`GET /api/auth/me`、修改密码（改密后自动重签会话）
- [x] CSRF：HMAC 签名 token + 双提交 cookie 校验
- [x] 中间件粗粒度：未登录访问 `/teacher/**` 跳 `/login`；细粒度授权在 `auth-guard.ts`
- [x] Seed：45 学生 + 2 教师 + 1 教研 + 2 班级 + 4 知识点 + `SEED_ACCOUNTS.md` 输出
- [x] 演示模式：登录页快速登录按钮；`DEMO_MODE=true` 不强制改密

## M2 验收清单

- [x] 细粒度守卫接入每一层：`requireRole` + `assertTeacherOwnsClass/Assignment/Question` + `assertCanManageKnowledge`
- [x] 越权语义：教师访问他人班级/作业/题目 → **404「资源不存在」**（防枚举）；角色不符 → 403
- [x] 班级管理：新建班级、按登录名加入学生、移出学生、班级详情（学生名单 + 作业列表）
- [x] 知识点树：教研负责人可增/改/删（树状展示，父节点下拉），教师只读；
      删除保护——有子节点或被题目引用时拒绝
- [x] 作业 CRUD：新建作业（选班级/标题/截止日）、题目列表带完成度标签、开放/截止切换
- [x] 题目 CRUD：自动/指定序号（`assignmentId+seq` 唯一）、删除保护（有作答不可删）
- [x] 标准答案与评分说明：`StandardAnswer` upsert；评分说明必填（AI 讲评依赖依据）
- [x] 题目↔知识点多对多关联编辑
- [x] 写操作统一走 Server Action（Next 14 自带 Origin 校验）+ `runAction` 兜底，
      越权/校验失败以行内错误提示返回，`redirect` 信号原样抛出

## M3 验收清单

- [x] CSV 解析：手写解析器，处理引号包裹、内嵌逗号/换行、`""` 转义、CRLF、UTF-8 BOM
- [x] 两步导入流：先「解析并预览」出校验报告（总/成功/失败行数 + 失败明细 + 成功前 10 行预览），教师确认后才写库
- [x] 答题导入 `Submission`（`questionId+studentId` upsert，重复导入按覆盖处理并提示）
- [x] 批改导入 `Grading`（verdict 限 CORRECT/WRONG/PARTIAL；无对应答题记录 → 校验失败「请先导入答题」）
- [x] 校验规则：学生不在本班 / 题号不存在 / 答题内容为空 / 判题结果非法 / 分数格式，逐行给出原因
- [x] 导入闸门：仅 `.csv`、≤500KB、≤5000 行（前端拦截 + 后端二次校验）
- [x] `ErrorStat` 重算：导入批改后按题 + 按关联知识点聚合，`$transaction` 先删后建
- [x] 错误分布看板 `/teacher/assignments/[id]/stats`：按题错误率条形 + 按知识点未掌握比例（CSS 条，无额外图表依赖）
- [x] 示例 CSV 下载 `GET /api/assignments/[id]/sample-csv?type=submissions|grading`：本班学生 × 题目生成，末题高错误率便于演示
- [x] 安全：Route Handler 走 `checkCsrfFromRequest`（缺/错 CSRF → 403）；非本人班级/作业 → 404；有无效行且未勾选「仅导入成功行」→ 422 并回传报告
- [x] 作业详情页工具栏入口：导入答题 / 导入批改 / 统计看板

冒烟验证（真实浏览器 + evaluate_script，:3001）：teacher01 登录 → 答题 `imported:45` → 批改 `imported:45 statRows:4` → 看板「第1题 错 84%（对7·半对5·错33·共45）」、3 知识点各 84% → 非法 CSV 预览 `invalidCount:3`（学生不在本班/题号不存在/答题内容为空）→ 守卫 `{422 gate, 404 bogus, 403 noCsrf}` 全部符合预期。

## M4 验收清单

- [x] Schema 迁移：`ReviewDraft` 拆结构化字段（`summary` / `errorCauses`(JSON 串) / `explanation` / `workedExample` / `aiFailReason` / `source` / `currentVersion`），移除 `draftContent`；新增 `ReviewDraftVersion`（`@@unique(draftId,versionNum)`，含 `contentSnapshot`/`changeType`）；迁移非破坏（旧列无数据）
- [x] AI Provider 抽象 `lib/ai/provider.ts`：`AIProvider` 接口 + `ReviewInput`/`ReviewOutput`/`AIProviderError` + `getProvider()` 按 `AI_PROVIDER` 切换；`mock.ts` 模板拼接（按难度/知识点数分支，输出结构可解析）；`openai.ts`/`deepseek.ts` 占位一律抛 `AIProviderError`（接入前需 §6.4 去标识化二次评审）
- [x] 生成服务 `lib/drafts.ts`：前置校验——缺 `StandardAnswer` 或 `rubricText` 空 → 直接 `NEEDS_MANUAL`，**不调用 AI**；Provider 抛错 → 捕获 → `NEEDS_MANUAL` 记 `aiFailReason`；成功 → `DRAFT`，写依据三快照 + 知识点关联（过滤幻觉 id）+ 候选练习 + v1 版本快照
- [x] 生成入口（Server Action）：单题 `generateDraft` / 批量 `generateAllDrafts`，走 `requireRole("TEACHER")` + `assertTeacherOwnsAssignment/Question`，`revalidatePath` 刷新
- [x] 草稿列表页 `/teacher/assignments/[id]/drafts`：状态徽标（待审核/待人工/已发布）、摘要+错因+讲解预览、依据缺失时「去补标准答案」跳转、Provider/MOCK_AI_FAIL 指示、按状态筛选 tab；作业详情加「讲评草稿」入口
- [x] 安全不变量：AI 产物只落 `ReviewDraft`，学生无任何读路径（草稿页仅 `requireRole("TEACHER")`）；发布与"学生可见"留待 M5
- [x] Mock 输出仅本地模板拼接，`AI_PROVIDER=mock` 下零外发

验证：`scripts/m4-verify.ts` 直驱服务层——A（有依据）→ `DRAFT`、三快照非空、结构化字段齐、版本+1；B（缺依据）→ `NEEDS_MANUAL` 含「缺依据」、未写正文；C（`MOCK_AI_FAIL=true`）→ `NEEDS_MANUAL` 含「AI 生成失败」。浏览器实跑：teacher01 越权/不存在 → 404、teacher02 跨班 → 404（防枚举）、student01 → 403，均渲染 Forbidden；批量「生成草稿」Server Action 真实提交 → 提示「已处理 1 题」且 `currentVersion 1→2` 落库重校验。

## M5 验收清单

- [x] 草稿归属守卫 `assertTeacherOwnsDraft`：draft→question→assignment→class.teacherId 链校验，他人/不存在统一 404（防枚举），非教师 403
- [x] 审核页 `/teacher/drafts/[id]`：左侧「依据（只读）」渲染生成时锁定的题目/标准答案/评分说明/常见错误/错误分布快照；右侧「AI 草稿」结构化可编辑（`DraftEditor`）
- [x] 逐段编辑 `summary/explanation/workedExample`；错因与候选练习以隐藏 JSON 原样保留不丢失；`保存修改` 写 `ReviewDraftVersion(MANUAL_EDIT)` + `currentVersion++`
- [x] 乐观并发：表单带 `baseUpdatedAt`，保存/发布时与库中 `updatedAt` 比对，冲突返回「已有更新，请刷新后重试」
- [x] 发布 `publishDraft`：空正文（缺摘要或讲解）拒绝发布；组装 `finalContent`（摘要+错因+讲解+示例+练习）→ `status=PUBLISHED` + upsert `PublishedReview`（`classId` 取作业班级，`draftId` 唯一）；已发布不可再编辑（转只读）
- [x] 拒绝 `rejectDraft`：非已发布 → `REJECTED`；已发布拒绝被拦
- [x] 手工兜底：`NEEDS_MANUAL` 草稿在右侧补写讲解保存 → 自动转 `DRAFT`（`source=MANUAL`、清 `aiFailReason`）→ 可发布（验收场景 #7）
- [x] 版本历史列表展示（P1 回退留 M8）；草稿列表页加「进入审核/编辑」「查看已发布讲评」入口

验证（真实浏览器 + Server Action 实跑）：编辑保存 `v2→v3` 且内容持久化、刷新后 `baseUpdatedAt` 更新；伪造过期 `baseUpdatedAt` 保存 → 「已有更新…并发编辑冲突」；发布 DRAFT → `ReviewDraft.PUBLISHED` + `PublishedReview`（`classMatches:true`、`finalContent` 含摘要/讲解/教师手工标记，len 443）；空 NEEDS_MANUAL 发布 → 「发布前请补全…」，手工补写保存 → `待审核 v1→2` → 发布成功；拒绝新 DRAFT → `已拒绝`。守卫：teacher02 跨班访问 draftId → 404、student01 → 403、teacher01 → 正常。

## M6 验收清单

- [x] 学生取数服务 `src/lib/student-reviews.ts`：`getMyReviews` / `getMyReviewDetail` / `assertStudentCanAct`，**只查 `PublishedReview`，`ReviewDraft` 无任何学生读路径**（守住关键不变量）
- [x] 列表只含「本人所在班级已发布 且 本人对该题有作答记录」的讲评；无作答记录的讲评不泄漏（防把无关讲评暴露给学生）
- [x] `studentId` 一律由会话（服务端 `requireRole("STUDENT").id`）注入，URL 的 `reviewId` 只作过滤；越权（非本班 / 无本人作答 / 不存在）统一 **404 防枚举**，非 403
- [x] 详情页展示：题目 + 我的作答 + 批改结果 + 教师评语 + 已发布讲评正文（`finalContent`），不暴露草稿内部字段（`draft`/`aiFailReason` 等）
- [x] 订正 `submitCorrection`：按 `(publishedReviewId, studentId)` upsert，重复提交覆盖并回到 `status=PENDING` 等待教师复核（验收场景：订正闭环）
- [x] 提问 `askQuestion`：写 `StudentQuestion`，仅本人可见，未回复显示「等待教师回复」
- [x] 角色隔离：学生访问 `/teacher/**` → 403；教师/他人无法借学生路由越权

验证（真实浏览器 + Server Action 实跑，student01）：`/student/dashboard` 渲染「第 1 题」入口 → 详情含本人作答与讲评正文；提交订正 Server Action 真实落库（刷新后 `status=PENDING`、`textarea` 回填原文）；提问落库并显示「等待教师回复」；伪造 `reviewId` → 渲染 404「资源不存在」；student01 访问 `/teacher/drafts/*` → 403「访问被拒绝」。服务层脚本 `scripts/m6-verify.ts` 9 项全绿（有权读列表/详情、同班无作答临时学生 → 404、越权 `assertStudentCanAct` → 404、不存在 → 404、返回体无草稿内部字段）。

## M7 验收清单

- [x] 归属守卫 `assertTeacherOwnsCorrection` / `assertTeacherOwnsStudentQuestion`：经 `correction/question → review → draft → assignment → class.teacherId` 链校验，他人教师/不存在统一 **404（防枚举）**，非教师 403
- [x] 跟踪取数 `src/lib/corrections.ts`：`getAssignmentCorrections` / `getAssignmentStudentQuestions`（含学生显示名、题目 seq、状态、内容、时间）、`getCorrectionStats`（PENDING/RESOLVED/STILL_WRONG 分布 + 掌握率）
- [x] 复核 Server Actions：`resolveCorrection`（→ RESOLVED + `teacherResolvedNote`/`resolvedBy`/`updatedAt`，说明可空）、`markStillWrong`（→ STILL_WRONG，**说明必填**）、`replyStudentQuestion`（写 `teacherReply`/`repliedBy`/`repliedAt`）
- [x] 教师端页 `/teacher/assignments/[id]/corrections`：左订正复核、右学生提问双栏，`CorrectionActions`（同一 note 框、两个 `formAction` 按钮）与 `QuestionReply`；作业详情工具栏与看板加「订正跟踪」入口
- [x] 掌握率纳入统计看板顶部（订正记录/待复核/已掌握/仍需订正/掌握率%）
- [x] 闭环回流学生端：复核/回复经 `revalidatePath('/student/reviews/[id]')` → 学生详情页显示「教师已确认掌握 / 仍需订正」及教师回复，仍可「重新提交订正」（状态回 PENDING）
- [x] 校验信息修复：`firstZodMessage` 增加读取 `issues[0].message`，裸字符串 schema 的根级错误（如「请输入回复内容」）不再退化为「输入不合法」

验证（真实浏览器 + Server Action 实跑，teacher01）：空 note「仍需订正」→ 「请输入回复内容」且状态仍 PENDING（未写库）；填 note「仍需订正」→ `STILL_WRONG` + 说明持久化 + 看板「仍需订正 1」；「确认掌握」→ `RESOLVED` + 掌握率 100%；回复提问 → `teacherReply` 落库、页面转「已回复」并移除输入框；切 student01 详情见「教师已确认掌握」+ 教师回复 + 「重新提交订正」。服务层脚本 `scripts/m7-verify.ts` 12 项全绿（归属教师放行 / 他人教师 404 / 学生 403 / 不存在 404，订正与提问双守卫；跟踪取数含显示名、统计求和自洽）。

## M8 验收清单（P1 增强）

- [x] 草稿版本回退 `restoreDraftVersion`：守卫 `assertTeacherOwnsDraft` + 拒绝 `PUBLISHED` + `baseUpdatedAt` 乐观并发；读目标 `ReviewDraftVersion.contentSnapshot` 覆盖 `summary/explanation/workedExample/errorCauses`，按快照重建 `practiceSuggestion`（与 `knowledgePointIds`，旧人工快照缺 `knowledgePointIds` 则保留现状），`currentVersion++` 并追加一条 `RESTORED` 版本（历史不删、可再回退）
- [x] 审核页版本历史每条非当前版本加「恢复到此版本」入口（隐藏 `baseUpdatedAt`），已发布态隐藏并提示走「重新生成」
- [x] AI 辅助订正点评建议：`AIProvider` 增 `generateCorrectionAdvice(CorrectionAdviceInput)→{advice,modelTag}`，`mock` 依「原批改结论 + 评语 + 订正文本 + rubric」拼装有依据的建议；`openai/deepseek` 占位一律抛 `AIProviderError`（待 §6.4 二次评审）
- [x] `suggestCorrectionAdvice(correctionId)` 服务：**缺依据（无标准答案 / rubric 空）直接不调 AI → NEEDS_MANUAL**；Provider 抛错（含 `MOCK_AI_FAIL` / 未接入）捕获 → NEEDS_MANUAL，**不阻断教师手工填写**；输入仅去标识化文本、输出仅回教师端（学生无此路径）
- [x] `aiCorrectionAdvice` Server Action（`assertTeacherOwnsCorrection` 守卫）+ `CorrectionActions` 增「✨ AI 点评建议」按钮，结果渲染建议卡片并可「填入复核说明」写回 note 框（教师定稿后才随复核动作落库）
- [x] `runAction` 扩展支持返回 `{ message, data }`；`ActionState` 增 `data?`；三动作共表单 form（按钮各自 `formAction`）

验证（真实浏览器 + Server Action 实跑，teacher01）：版本回退 —— 重新生成使 REJECTED→DRAFT v2，手工编辑标记→v3，点 v1「恢复到此版本」→ `v4 版本恢复`、标记消失、讲解回到 v1 模板；AI 订正建议 —— Q1 订正点「AI 点评建议」→ 蓝色建议卡（引用真实评语「关键步骤/符号出错」与 rubric「移项得 2x=4」）→「填入复核说明」写回 note（102 字）。服务层脚本 `scripts/m8-verify.ts` 正常 7 项全绿（OK 建议非空且含讲评语义 / 缺依据不调 AI / 不存在不抛异常，临时链建后清除）；`MOCK_AI_FAIL=true` 2 项（兜底 NEEDS_MANUAL 不抛错）。回退/建议的越权与并发复用 M5/M7 已验证的 `assertTeacherOwnsDraft`/`assertTeacherOwnsCorrection` 与 `baseUpdatedAt` 路径。

## M9 验收清单（审计与脱敏导出）

- [x] `src/lib/audit.ts` `writeAudit({actorId,action,entity,entityId,before?,after?})`：**before/after 只放状态 / 计数等标量，绝不写入答题、订正、讲评正文**（数据最小化）
- [x] 关键动作埋点：`review.publish` / `review.reject` / `draft.restore`（draftReview）、`correction.resolve` / `correction.still_wrong` / `question.reply`（corrections）、`correction.submit` / `question.ask`（student）、`import.grading` / `import.submissions`（Route Handler，仅记写入条数）、`research.export`；登录审计沿用 `LoginAudit`，改密沿用 `PASSWORD_CHANGE`
- [x] `src/lib/research.ts` `getResearchStats()`：跨全部班级从 `Grading` 现算**知识点错误率** + 从 `Correction` 现算**班级订正掌握率**（含班级批改错误率），返回纯聚合结构，不含任何学生个人标识与正文
- [x] `/researcher/dashboard` 只读分析页（`requireRole("RESEARCHER")` + 未改密跳转 + `AuthError→Forbidden`）：全局概览 + 知识点错误率排行 + 班级订正掌握率表
- [x] `/researcher/export.csv` Route Handler：`requireRole("RESEARCHER")` 守卫，输出**去标识化 CSV**（仅知识点/班级两级聚合 + 匿名序号，带 UTF-8 BOM；无姓名/学号/正文），并写 `research.export` 审计

验证（真实浏览器，researcher01）：登录后 `/researcher/dashboard` 渲染「批改 45 / 整体错误率 84% / 订正 1 / 掌握率 100%」+ 3 个知识点错误率 + 初二（3）班掌握率行；`/researcher/export.csv` 返回 200 `text/csv`、`Content-Disposition: research-deidentified.csv`，正文仅聚合与匿名序号。服务层脚本 `scripts/m9-verify.ts` 9 项全绿：审计写入读回、**全表扫描零正文泄漏**、聚合输出不含学号/姓名/正文（命中 0 项）、`research.export` 动作落库。教研越权复用已验证的 `requireRole` 路径（非 RESEARCHER 经 `AuthError` → 403）。

## 冒烟脚本（当前实现已验证）
```
GET  /login                 200
GET  /api/auth/csrf         { token }
POST /api/auth/login        200  { ok, user, redirectTo }
GET  /api/auth/me           200  { user }
POST /api/auth/logout       200
GET  /api/auth/me (after)   307 → /login
POST /api/auth/login        401  { error }        密码错误
GET  /student/dashboard     307 → /login          未登录拦截
```

## 目录结构

```
D:/ai/
  PLAN.md               方案设计
  SEED_ACCOUNTS.md      演示账号清单（gitignored）
  prisma/
    schema.prisma       全量表结构（M1 只用 User/Session/LoginAudit/ClassRoom/…）
    seed.ts
  scripts/
    reset-password.ts
    revoke-sessions.ts
  src/
    middleware.ts       粗粒度未登录跳 /login
    lib/                db / env / password / session / csrf / auth-guard / action / types
                        csv（解析+校验）/ stats（ErrorStat 重算+看板取数）/ import-api
                        drafts（AI 草稿生成服务：缺依据拦截+失败兜底）
                        student-reviews（学生取数：只查 PublishedReview + 越权 404）
                        corrections（订正/提问跟踪取数 + 掌握率统计 + AI 点评建议 suggestCorrectionAdvice）
                        audit（writeAudit：关键动作审计，只存标量不存正文）/ research（教研跨班聚合：知识点错误率 + 班级订正掌握率）
      ai/               provider（AIProvider：generateReviewDraft + generateCorrectionAdvice + getProvider）/ mock / openai·deepseek（占位抛错）
      actions/          classes / knowledge / assignments / questions / drafts / draftReview / student / corrections（Server Actions）
    components/         AppShell / Nav / ActionForm / Forbidden / LogoutButton / DraftEditor（结构化编辑）/ CorrectionActions（复核）/ QuestionReply（回复）
    app/
      login/            页面 + LoginForm（含快速登录按钮）
      account/change-password/
      api/auth/         login / logout / me / change-password / csrf
      api/assignments/[id]/  import-submissions(/preview) / import-grading(/preview) / sample-csv
      teacher/
        dashboard/                 班级列表 + 新建
        classes/[id]/              班级详情：学生增删 + 作业列表
        knowledge-points/          知识点树（教研可编辑 / 教师只读）
        assignments/new/           新建作业
        assignments/[id]/          作业详情 + 题目 CRUD + 导入/看板/草稿入口
        assignments/[id]/questions/[qid]/  题目信息 + 标准答案 + 知识点关联
        assignments/[id]/import-submissions/  答题 CSV 两步导入（CsvImport）
        assignments/[id]/import-grading/      批改 CSV 两步导入
        assignments/[id]/stats/            错误分布看板
        assignments/[id]/drafts/           AI 讲评草稿列表（生成/重新生成 + 状态筛选）
        drafts/[id]/                      草稿审核页（并排依据 + 结构化编辑 + 发布/拒绝 + 版本历史）
        assignments/[id]/corrections/    订正与提问跟踪（复核/仍错/回复 + 掌握率）
      student/dashboard/                 我的错题讲评列表（本班已发布 + 本人有作答）
      student/reviews/[id]/              讲评详情：我的作答/批改/教师讲评正文 + 提交订正 + 提问
      researcher/dashboard/              教研跨班只读分析（知识点错误率 + 班级订正掌握率）
      researcher/export.csv/             Route Handler：去标识化聚合 CSV（无姓名/学号/正文）
```

## 安全底线（摘自 PLAN §16-17）

- **密码**：bcryptjs 存哈希；开发 cost=10，生产 12；日志/响应绝不回显明文
- **会话**：`Session.tokenHash = SHA-256(随机 token)` 存 DB；cookie 仅携带不透明 token；
  `httpOnly + SameSite=Lax + Secure(生产)`；登出/改密立即撤销
- **授权**：URL 参数只作过滤不作授权；学生访问他人资源统一返回 404（避免探测）
- **审计**：登录成功/失败写 `LoginAudit`；关键动作写 `AuditLog`
- **DEMO_MODE**：生产构建期抛错保护
- **虚构数据**：真实学生姓名/身份证/手机号/家长信息一律不采集

## M10 验收清单（收尾）

- [x] 生产构建：`DEMO_MODE=false NODE_ENV=production next build` 通过，31 条路由全部编译产出（`tsc --noEmit` 干净）
- [x] `DEMO_MODE` 生产守卫实测：`DEMO_MODE=true` 下 prod build 在收集页面数据阶段即抛 `DEMO_MODE=true 时禁止生产构建`，构建失败退出码 1
- [x] 加载态：`src/app/{teacher,student,researcher}/loading.tsx` + `components/PageLoading`（RSC 导航 Suspense 骨架/转圈）
- [x] 空态与提交态复核：各列表页空状态文案齐备；`ActionForm` 提交中禁用按钮并显示「提交中…」、成功/失败内联反馈（`useFormStatus`）
- [x] 部署文档（生产环境步骤、DEMO_MODE/HTTPS/备份/进程守护）+ 分角色 8 步演示脚本，含「缺依据不生成」「AI 不可用兜底」「越权 404」「脱敏导出」不变量走查

回归验证（真实浏览器，teacher01 会话）：`/teacher/dashboard`、`/teacher/assignments/new`、`/teacher/knowledge-points` 均 200；越权访问 `/researcher/dashboard` 渲染「403 访问被拒绝」且页面正文不含任何知识点/批改数据（`hasRealData=false`）；Route Handler `/researcher/export.csv` 对非教研直接返回 JSON `403`。`scripts/m9-verify.ts` 9 项全绿复跑。

> 全项目 M1–M10 收官。后续如需增强（非当前必做）：审计流水的站内可视化视图、真实 AI Provider 的去标识化接线（需 §6.4 二次评审）、图表化看板。

## 明确不做

- ❌ 真实学校教务系统接入 · ❌ 未成年人真实数据
- ❌ AI 直接面向学生输出（教师审核必经）· ❌ 主观题自动评分
- ❌ 直播 / 题库商城 / 完整在线考试 · ❌ 人脸识别 / 课堂监控
