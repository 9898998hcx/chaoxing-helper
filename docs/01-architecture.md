# Step 1：系统架构与数据设计

## 部署与模块

浏览器 → Next.js Web（3000）→ 同源 `/api` 代理 → NestJS API（3001）→ Prisma → SQLite（本地）/PostgreSQL（生产）。API 使用 Redis 做共享限流/额度；无 Redis 时本地单进程内存替代。BullMQ 独立 crawler worker 只在显式开启且配置 Redis 时启动。PDF 服务使用独立 Chromium 上下文、受控 HTML、限时/限大小/限并发。MVP 同步返回 PDF 字节，浏览器通过 blob 下载；S3 作为可选私有归档，不默认留存。

模块边界：auth 管身份/会话/邮箱验证；resume 管所有权/编辑/版本；ai 管提示词/模型/配额/脱敏日志；pdf 管原创样式/渲染/下载；template 管已审展示/推荐；crawler 管来源任务与队列；admin 管角色权限/审核/下架/审计。模块通过服务调用，不允许客户端提交 userId 决定资源所有者。

## 目录结构

```text
apps/
  web/                 Next.js 页面、编辑器、AI 预览、模板与后台
  api/src/
    auth/              注册登录、会话守卫、邮箱验证
    resume/            CRUD、乐观锁、快照恢复
    ai/                DeepSeek、JSON 校验、限额
    pdf/               受控 HTML、Playwright、可选 S3
    template/          模板查询与规则推荐
    crawler/           来源校验、队列生产者
    admin/             审核、下架、审计
    common/            DB、Redis/内存、错误、安全中间件
  worker/src/          独立队列消费者、合规采集
packages/shared/src/   Zod DTO、简历数据结构、模块默认值
prisma/                本地 SQLite schema、迁移、原创模板 seed
prisma/postgresql/     生产 PostgreSQL schema 与独立迁移
tests/                 单元/集成/E2E
scripts/               管理员赋权、数据库辅助
docs/                  PRD、架构、API、验收、部署
```

## ER 图文字版

```text
User 1──N Session；User 1──N EmailVerification
User 1──N Resume 1──N ResumeSection
                  └1──N ResumeVersion
TemplateSource 1──N Template 1──N Resume（可空）
TemplateSource 1──N CrawlJob
User 1──N AiGenerationLog N──0..1 Resume / Template
User 1──N AuditLog（actor 可空，保留最小审计）
```

## Prisma 等价字段设计

所有 ID 为服务端生成字符串，日期为 UTC DateTime。SQLite 无原生数组，标签和顺序用受校验的 Json 数组，生产保持相同接口。

| 模型 | 字段与约束 |
| --- | --- |
| User | id PK, email unique 规范化, passwordHash, role USER/ADMIN, emailVerifiedAt?, createdAt |
| Session | id PK, tokenHash unique, userId FK, csrfToken, expiresAt；注销删除；不落明文 session token |
| EmailVerification | id PK, tokenHash unique, userId FK, expiresAt；单次消费 |
| Resume | id PK, userId FK/index, title, templateId? FK, revision 默认 1, createdAt, updatedAt |
| ResumeSection | id PK, resumeId FK 级联删除, type, title, visible, order, content Json；8 类模块 |
| ResumeVersion | id PK, resumeId FK 级联删除, revision, data Json, createdAt；unique(resumeId,revision)，保留最近 50 版 |
| Template | id PK, slug unique, title, description, tags Json, industry?, style, layout, sectionOrder Json, thumbnailUrl?, sourceUrl?, sourceId? FK, status, license?, reviewNote?, createdAt, updatedAt |
| TemplateSource | id PK, name, baseUrl, tosUrl, tosEvidence?, enabled=false, permissionConfirmed=false, robotsRequired=true, rateLimitMs≥3000, metadataPath?, createdAt, updatedAt |
| CrawlJob | id PK, sourceId FK, status QUEUED/RUNNING/SUCCEEDED/SKIPPED/FAILED, reason?, processedCount, createdAt, startedAt?, finishedAt? |
| AiGenerationLog | id PK, userId FK, resumeId?, templateId?, scenario, status, inputTokens, outputTokens, estimatedTokens, durationMs, errorCode?, createdAt；不存 prompt、正文、JD、邮箱 |
| AuditLog | id PK, actorId? FK, action, targetType, targetId?, metadata? Json, createdAt；metadata 仅允许状态与非敏感标识 |

ResumeSection.content 为 `Record<string,string>[]`。基本信息字段 name/email/phone/city；求职意向 role/industry；教育 school/degree/major/start/end/description；工作 company/role/start/end/description；项目 name/role/start/end/description；技能 name/description；证书 name/date/issuer；自我评价 description。禁止存入可执行 HTML。

## 关键事务与边界

简历 PATCH 在数据库事务内以 `(id,userId,revision)` 匹配并递增 revision，再替换模块、存快照；旧版本 409，非所有者 404。版本恢复同样创建新 revision。AI 请求先验证简历与模板，再预留额度，调用 DeepSeek；仅返回结构化候选，采纳由客户端显式提交普通受保护简历 PATCH。模板引用仅传 sectionOrder/layout/style，原始标题、正文、图片与来源页面不进入模型。模板下架后不再公开展示/推荐，已有用户简历数据仍属于用户。

采集来源配置需人工确认许可并保存依据。robots 获取失败、规则禁止、来源未启用/未确认许可、总开关关闭时跳过；禁止登录/CAPTCHA 绕过；仅读取配置的公开元数据，有限并发/体积/条数，规范 URL 后去重，入库状态 PENDING。队列重试不得解除合规限制。

## API 与安全约定

详见 [API 表](02-api.md)。`/api` 前缀；会话 cookie HttpOnly、SameSite=Lax、生产 Secure；已登录变更请求需 `Origin` 与 `x-csrf-token`；注册/登录同样校验 Origin。JSON 返回对象包装。错误统一 `{error:{code,message}}`，不返回栈或完整上游响应。

通用错误：400 VALIDATION_ERROR；401 UNAUTHENTICATED；403 FORBIDDEN/CSRF_INVALID/EMAIL_NOT_VERIFIED；404 NOT_FOUND；409 REVISION_CONFLICT/EMAIL_EXISTS；413 PAYLOAD_TOO_LARGE；429 RATE_LIMITED/AI_QUOTA_EXCEEDED；503 AI_NOT_CONFIGURED/DEPENDENCY_UNAVAILABLE；504 AI_TIMEOUT/PDF_TIMEOUT。模块会保留更具体 code。

## 环境变量与实施顺序

环境模板在根 `.env.example`，包含 APP_ORIGIN、DATABASE_URL、REDIS_URL、EMAIL_VERIFICATION_REQUIRED、SMTP_*、DEEPSEEK_*、AI_*、PDF_*、S3_*、CRAWLER_ENABLED 等。只复制到忽略的 `.env`，不向 NEXT_PUBLIC_* 暴露密钥。

实施顺序：设计落盘 → Step2 框架/注册登录 → Step3 简历/编辑器 → Step4 AI → Step5 PDF → Step6 合规采集/后台 → Step7 结构参考 → Step8 整合 UI → Step9 测试/安全/部署配置。每个模块附本地验收步骤。数据库/部署默认已确认；PostgreSQL 迁移、SMTP、浏览器字体、真实模型、对象存储及容器部署必须在对应环境补充实测，不把未运行验证标为通过。
