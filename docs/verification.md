# 本次交付与实际验证记录

日期：2026-10-22（Asia/Shanghai）。环境：Windows、Node.js 24.22.0、SQLite、内存限流、系统 Edge 与微软雅黑。本次为本地源码交付，没有发布网站或调用付费模型。

## 交付映射

| 步骤 | 源码/配置 | 说明 |
| --- | --- | --- |
| 0/1 | docs/00-product.md、01-architecture.md、02-api.md、.env.example | PRD、范围、页面流程、已确认默认项、架构、ER、字段、API、目录、环境变量 |
| 2 | apps/api/src/auth、common；apps/web 的 login/register/verify-email | 密码哈希、服务端会话、CSRF、邮箱验证可配置、管理员 CLI |
| 3 | apps/api/src/resume；apps/web 编辑器；packages/shared | 8 模块、全部排序/显隐、CRUD、复制、串行自动保存、409 保护、50 版快照 |
| 4 | apps/api/src/ai；apps/web/components/ai-panel.tsx | 服务端 Key、结构校验、有限重试/超时、持久化配额预留、脱敏日志、预览后采纳 |
| 5 | apps/api/src/pdf；Dockerfile | 受控 HTML、原创样式、A4、中文、分页、权限、容量/并发限制、可选 S3 |
| 6 | apps/api/src/template/crawler/admin；apps/worker | 来源默认禁用、独立队列、robots/ToS、限速、SSRF、元数据白名单、审核/下架 |
| 7/8 | apps/web 模板与后台页面；template 推荐；AI 结构投影 | 规则推荐无需 AI、只传结构/风格、保留模板 ID、正文保留、响应式/基础可访问性 |
| 9 | tests、Dockerfile、compose.yml、.github/workflows/ci.yml | 单元/集成/E2E、依赖审计、生产迁移、部署/备份/监控/上线清单 |

## 已运行且通过

| 检查 | 结果 |
| --- | --- |
| npm install / 锁文件 | 安装完成，使用 `.npmrc` 固定 peer 解析策略 |
| npm run db:generate | Prisma Client 6.19.3；SQLite schema 可用 |
| npm run db:migrate | SQLite 初始迁移应用成功；预创建文件解决 Windows 空库首次连接问题，不截断已有库 |
| npm run db:seed | 3 个项目原创结构；0 个预置第三方采集来源 |
| npm run typecheck | 后端、worker、共享类型、前端及测试 TypeScript 通过 |
| npm test | 33 项 Vitest 单元/真实 SQLite HTTP 集成 + 17 项独立爬虫测试，共 50 项通过 |
| npm run build | Next.js 生产构建通过，含 login/register/resumes/templates/admin/verify-email 全部路由 |
| npm run test:e2e | 桌面、手机视口共 4 项通过，使用真实 API/SQLite/Edge，AI 成功响应受控模拟 |
| npm audit --audit-level=high | 0 vulnerabilities（含开发依赖） |
| npm run worker | 关闭状态正常退出，无 Redis/外部采集连接 |
| node scripts/prepare-postgres.mjs | 生成 PostgreSQL schema/独立初始 SQL，无数据库连接；再次执行幂等 |
| Compose 与 CI YAML | 语法解析通过；不代表容器已运行 |

HTTP 集成覆盖：注册、重复邮箱、错误密码、会话恢复/退出、Origin/CSRF、创建/保存/刷新、409、快照恢复、其他用户 GET/PATCH/DELETE/duplicate/versions/PDF 404、AI 无 Key 与日志无敏感测试串、普通用户无后台权限、模板批准后可见和下架后立即不可见、规则推荐，以及实际多页 PDF。

AI 单元覆盖：缺 Key、每分钟限流、超时有限重试、上游错误、非法输出、日/月限额、模板只传结构和日志脱敏。预算按最坏情况下的输入字节和最大输出/重试预留，可能提前耗尽额度；不是供应商实际费用，需另外配置供应商账单告警。

E2E 覆盖：注册 → 新建 → 姓名保存/刷新恢复 → 模块排序 → 选专业模板并应用到已有简历（确认正文保留、模板 ID 与顺序持久化）→ AI 自评预览（数据库未变）→ 显式采纳（数据库更新）→ 实际 PDF 下载 → 删除确认；另检查公开模板库与错误登录。手机额外检查编辑/预览切换与无横向溢出。

## 视觉/PDF 证据

- `artifacts/editor-desktop.png`、`artifacts/editor-mobile.png`：实际端到端截图，已检查布局与中文排版。
- `artifacts/integration-multipage.pdf`：虚构中文经历，共 4 页，A4、Tagged PDF、无 JavaScript，约 70KiB，包含 ToUnicode 文本映射。
- `artifacts/pdf-page-1.png`、`artifacts/pdf-page-2.png`：Poppler 渲染后检查，中文正常，记录分页不截断，页边距正常。
- `artifacts/resume-desktop.pdf`、`artifacts/resume-mobile.pdf`：浏览器实际下载产物。

## 尚需目标环境联调

Docker 未安装，按用户要求仅交付配置，未执行镜像构建或容器启动。PostgreSQL/Redis 多进程、真实 SMTP 邮件、DeepSeek 实际成功调用/费用/质量、S3 私有归档、真实授权来源采集、HTTPS 生产 Cookie、实体 Android/iOS 下载、监控告警与备份恢复尚未实测。已在 `09-deployment.md` 与 `acceptance.md` 列出上线步骤，不将这些标为通过。

本地内存限流重启清空，不能替代生产共享 Redis。PDF 并发当前按 API 进程限制，Compose 设计为单实例；多实例扩容前需共享信号量或单独 PDF 队列。AI token 预留和每日次数落在数据库，不受进程重启影响。采集总开关与全部来源保持默认关闭。
