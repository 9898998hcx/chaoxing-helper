# 合规模板库与独立采集 Worker

本地默认使用原创种子模板。`CRAWLER_ENABLED=false` 时，Web 不能触发采集，Worker 启动后直接退出，不创建 Redis 连接。启用采集需部署真实 Redis；`memory://` 仅支持 Web 的本地限流，不能运行 BullMQ。

## 后台与来源授权

所有 `/api/admin/*` 接口同时校验登录状态与 `ADMIN` 角色。后台提供来源列表、新增与更新、任务触发、采集任务列表、模板审核/下架、审计日志。

来源默认禁用，须填写 `name`、`baseUrl`、`tosUrl`。采集前还须由管理员审核实际服务条款或书面授权，在 `tosEvidence` 记录依据、日期与适用范围，设置 `permissionConfirmed=true`、`enabled=true`，并配置同来源公开 JSON 端点 `metadataPath`。未知或不允许的来源保持禁用。`robotsRequired` 固定为 `true`，不能通过后台关闭；`rateLimitMs` 最低为 3000 毫秒。

权限勾选不能自动证明授权存在。维护者须留存可复核授权依据，并定期复核条款；本项目不会自动推断任何网站允许采集，也没有预置启用的第三方来源。

## 元数据协议与技术边界

公开端点应返回 `{ "templates": [...] }`。每条只接受以下字段：

- `title`：简短标题；`sourceUrl`：同来源公开详情地址。
- `tags`：标签数组；`style` 与 `layout`：短布局/风格标识；`industry`：可选行业。
- `sectionOrder`：`basic`、`intent`、`education`、`work`、`projects`、`skills`、`certificates`、`summary` 的无重复子集。
- `thumbnailUrl`：可选公开 HTTPS 缩略图链接，仅存 URL，不下载图片。

包含正文、源文件、完整图片、下载地址等额外字段的记录会被丢弃。每次最多处理 20 条，JSON 响应上限 256 KiB、robots 响应上限 64 KiB，单次请求超时 10 秒。不会抓取 HTML、登录页面、模板文件或图片字节，不接受 Cookie，也不绕过登录、验证码或访问限制。

Worker 启动命令为 `npm run worker`，入口 `apps/worker/src/main.ts`，队列为 `template-crawl`。BullMQ 全局并发为 1，并用 Redis 保存每个来源的实际请求间隔；遵守更长的 robots `Crawl-delay`。每次请求/重定向都校验同来源、路径范围、公共 DNS 结果并固定已校验的连接 IP，拒绝私网、环回、链路本地及云元数据地址；生产环境仅允许 HTTPS。对公网域名的多地址 DNS 结果，只要存在非公共地址即拒绝。

`robots.txt` 缺失、不可读取、格式不能识别或禁止端点时，跳过任务。robots 允许访问本身不代表版权授权；来源授权仍为独立的前置条件。

## 审核与下架

新采集模板状态为 `PENDING`，公共列表与详情只读取 `APPROVED`。管理员使用 `PATCH /api/admin/templates/:id` 提交 `status` 与非空 `reviewNote`。外部来源批准前会再次检查授权依据。

收到权利人请求或发现超范围采集时，应立即把模板改为 `TAKEN_DOWN` 并记录理由，必要时关闭来源。下架之后公共详情与新生成请求不能再取得该模板；列表也立即排除它。历史已采纳的用户简历仅保留模板 ID 以便追溯，其中不含第三方模板正文或图片。

所有来源变更、任务触发、审核/下架与任务完成写入 `AuditLog`。重复采集按规范化来源 URL 和散列 slug 去重，不会自动恢复已拒绝或下架的记录。单独禁用来源会停止后续采集；如需撤回已经批准的模板，应逐个下架相关模板。

## 风险与验收

- 站点条款、授权和 robots 可能变化，需定期复核；失效时关闭来源并下架受影响记录。
- 元数据标题或公开缩略图链接也可能有权利或隐私限制。人工审核不能省略，不在本系统再分发源文件及完整图片。
- 第三方缩略图可能追踪访客；前端应保留来源标注，避免服务端下载或代理未经审核图片。
- 队列和 Redis 为独立部署组件；生产环境需告警失败任务及长时间 `RUNNING` 的异常任务。

自动验收执行 `npx tsx --test tests/crawler.test.ts`，覆盖默认关闭、授权缺失、robots 禁止/缺失、robots 延迟、持久限速、去重、字段白名单、数量上限、拒绝访问、停用来源、SSRF 与 URL 规范化。

手动验收：管理员新增禁用来源；未授权启动应返回 `SOURCE_NOT_AUTHORIZED`；配置明确授权后使用禁止端点的 robots 应得到 `SKIPPED/ROBOTS_DENIED`；公开 JSON 进入待审核，普通用户不能访问待审核模板；批准后可展示与参考结构，下架后公共详情返回 404。采集接口在默认关闭时返回 `503 CRAWLER_DISABLED`，无真实 Redis 时返回 `503 CRAWLER_REDIS_REQUIRED`。
