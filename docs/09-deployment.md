# 测试、安全与部署

## 交付边界

仓库提供本地开发环境和生产部署配置。本次未运行 Docker、真实 PostgreSQL/Redis、SMTP、S3、真实 DeepSeek 调用，也未部署到外部服务器。对应联调与上线检查仍须在目标环境完成；不能把配置文件存在视为部署验收通过。

本地使用 SQLite 与单进程内存限流，便于直接运行。生产 Compose 使用 PostgreSQL、Redis、独立 Web/API/Worker 与一次性迁移服务。生产场景必须使用真实 Redis；内存限流不能在多个副本间共享额度或队列。

## 本地与 CI 命令

复制 `.env.example` 为 `.env` 并按需调整；Node.js 推荐 24 LTS。安装命令与 CI 使用同一依赖解析选项。

```sh
npm ci --legacy-peer-deps
npm run db:setup
npx playwright install chromium
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Linux 如缺少浏览器依赖或中文字体：

```sh
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk
npx playwright install --with-deps chromium
```

PDF 默认使用 Noto Sans CJK；Windows 会检测微软雅黑与 Edge。若字体或 Chromium 位于其他路径，配置 `PDF_FONT_PATH`、`PLAYWRIGHT_EXECUTABLE_PATH`，并实际打开导出的中文 PDF 检查字形、复制文本与分页。

GitHub Actions 配置位于 `.github/workflows/ci.yml`，执行数据库迁移/种子、单元和集成测试、爬虫单元测试、类型检查/构建、Playwright E2E 与生产依赖审计。浏览器失败产物仅保留 7 天；测试必须使用虚构个人信息，禁止把真实简历上传到 CI。

## PostgreSQL 模型与迁移

本地模型为 `prisma/schema.prisma`，生产模型为 `prisma/postgresql/schema.prisma`，对应迁移分别放在各自目录。初始 PostgreSQL 基线可用以下离线命令生成，脚本不会连接数据库：

```sh
node scripts/prepare-postgres.mjs
```

已有初始迁移时脚本不会改写迁移历史。之后变更业务模型，应在专用 PostgreSQL 开发数据库中生成新的有版本迁移，先在预发布环境验证，再执行 `prisma migrate deploy`。SQLite 迁移不能直接用于 PostgreSQL。Docker 构建只生成 PostgreSQL Prisma Client；本地重回 SQLite 需执行 `npm run db:generate`，避免混用生成客户端。

## Compose 上线流程

准备服务器 Docker Engine 与 Compose v2、域名与 HTTPS 反向代理。Web 仅映射 `127.0.0.1:3000`，由服务器上的反向代理转发公网请求；PostgreSQL、Redis 和 API 不对宿主机暴露端口。

创建不会提交到 Git 的 `.env.production`。最小配置示例不包含可用密钥：

```dotenv
APP_ORIGIN=https://resume.example.com
POSTGRES_USER=resume
POSTGRES_DB=resume
POSTGRES_PASSWORD=replace_with_random_64_hex_characters
WEB_PORT=3000
EMAIL_VERIFICATION_REQUIRED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=replace_me
SMTP_PASSWORD=replace_me
SMTP_FROM=Resume <noreply@example.com>
DEEPSEEK_API_KEY=
CRAWLER_ENABLED=false
S3_ARCHIVE_PDFS=false
```

`POSTGRES_PASSWORD` 为 Compose 必填值，建议密码生成器产生 64 位十六进制字符；连接 URL 中若使用其他保留字符，须单独处理 URL 编码，不能直接粘贴。文件权限限制为部署账号可读；正式平台优先注入受管密钥。不要把生产 `.env` 放入镜像、Git、构建参数、日志或前端公开环境变量。

```sh
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps -a
docker compose --env-file .env.production logs --tail=100 api worker
```

不要输出完整 `docker compose config`，其中可能展开密钥。`migrate` 服务首先应用生产迁移；只有迁移成功后 API/Worker 才会启动，Web 等待 API 健康检查。健康端点只确认 API 进程响应；数据库与 Redis 还需检查各自健康状态和真实业务请求。

初始化原创模板及管理员：

```sh
docker compose --env-file .env.production exec api node --import tsx prisma/seed.ts
docker compose --env-file .env.production exec api node --import tsx scripts/admin.ts admin@example.com
```

管理员须先通过注册页面创建账号并完成邮箱验证，再由有服务器权限的维护者赋予角色；没有默认管理员密码。默认 Worker 打印已关闭并正常退出，`on-failure:3` 不会对正常退出反复重启。

Next.js `/api` 重写在构建时固定，镜像用 `API_INTERNAL_URL=http://api:3001` 构建，运行时保留相同地址。修改内部 API 主机名后须重新构建 Web。浏览器只请求同源 `/api`，无需公开内部 API 地址。反向代理须正确转发主机、协议，并只接受可信代理传入的转发头；生产使用安全 Cookie，需要 HTTPS。修改域名后同时更新 `APP_ORIGIN`、反向代理与邮件中的验证链接。

Dockerfile 基于 Node 24 Bookworm，安装 Chromium 系统依赖和 `fonts-noto-cjk`，使用非 root 的 `node` 用户运行应用。PDF 上下文禁用 JavaScript、Service Worker 和网络请求，输入按文本转义；浏览器、字体、文件大小、生成超时与并发都需在目标平台实测。镜像包含 TypeScript 运行器，所以未裁剪其运行时依赖。

## 安全与运维检查

- 认证：密码哈希、HttpOnly/SameSite Cookie、生产 Secure、会话失效；注册与登录限流；决定并配置邮箱验证。
- 隔离：所有简历、历史、AI 与 PDF 操作按当前用户取数；跨用户统一返回 404，避免泄露资源是否存在。
- 请求：有副作用的会话请求校验 Origin 与 CSRF token；JSON 体积和字段均受限；React 与 PDF 文本转义，禁止拼接未转义用户 HTML。
- 密钥：DeepSeek/SMTP/S3 只存在后端；按最小权限配置，定期轮换；日志不记录完整简历、Prompt、响应正文、Cookie 或连接字符串。
- AI：配置每日次数、每分钟请求、月 token 限额与预警比例；额度提示不等同于真实账单。结合供应商账单设置费用告警，持续核对估算误差。
- PDF：限制输入/输出大小、并发和时长；私有对象存储归档默认关闭；如开启，确认 Bucket 非公开、访问权限和保留周期。
- 爬虫：全局默认关闭；每个来源须独立授权依据和 robots 校验，来源变更后复核授权。详见 `06-crawler.md`。不得因为 robots 允许而默认获得版权授权。
- 依赖：使用锁文件和 `npm ci --legacy-peer-deps`；CI 审计高危及以上生产依赖；更新后重跑测试和构建，定期扫描基础镜像。

监控应采集 API 的错误率/延迟、登录异常、AI 的失败/耗时/额度预警、PDF 超时与繁忙率、数据库容量、Redis 内存、队列积压和失败/长时间运行任务。外部告警平台与真实 DeepSeek 账单告警没有在本次自动接入，须由部署方配置并演练通知。

数据库使用持久卷仍需定时备份。建议每日 `pg_dump -Fc`、加密保存到独立存储，并定期向隔离数据库恢复演练；同时备份对象存储策略、来源授权证据与部署配置。Redis 的 AOF 用于重启恢复，不能替代数据库备份。升级前做备份，迁移失败时停止发布并调查；涉及数据变更的回滚需要独立方案，不能只回退镜像。

## 上线确认清单

- [ ] 生产环境变量、HTTPS 域名、Cookie/CSRF、SMTP 与邮箱验证联调完成。
- [ ] PostgreSQL 新版本迁移在预发布通过，数据库备份和恢复演练通过。
- [ ] Redis 正常、无公开端口，限流和 Worker 队列跨进程生效。
- [ ] 无 Key、AI 超时/429、预算耗尽与用户提示均通过，真实供应商预算告警已演练。
- [ ] Chromium 与中文字体、跨页长简历、移动端下载均已实测。
- [ ] Bucket 为私有；未启用归档时确认 PDF 不被长期存储。
- [ ] 爬虫保持关闭，或每个启用来源都有可复核授权、robots 结果与下架负责人。
- [ ] 日志脱敏、依赖/镜像审计、健康检查与外部监控告警已通过。
- [ ] 已按 `acceptance.md` 完成目标环境人工验收，记录未完成项与负责人。
