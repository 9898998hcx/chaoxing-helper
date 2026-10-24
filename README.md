# 履历工坊 Resume Workshop

一个面向中文求职者的本地优先简历工作台。它把结构化简历编辑、模板结构参考、DeepSeek AI 辅助和中文 PDF 导出放在同一个工作流里，适合个人使用、求职展示和作为全栈开源项目学习。

## 核心功能

- 账号注册、登录、会话与 CSRF 防护。
- 简历创建、编辑、复制、删除、自动保存、版本快照和恢复。
- 基本信息、求职意向、教育、工作、项目、技能、证书、自我评价等模块的排序与显示控制。
- 左侧表单 + 右侧实时预览的响应式在线编辑器。
- DeepSeek 生成模块、润色、自我评价和改进建议；生成结果必须先预览，用户确认后才写入简历。
- BYOK（Bring Your Own Key）：用户可以在 AI 助手中保存自己的 DeepSeek API Key，服务端使用 AES-256-GCM 加密存储，接口和日志只显示脱敏值。
- 系统 Key 的每日额度、每分钟限流和月度 token 预算控制；自定义 Key 不占用系统每日额度。
- 多种模板结构、标签筛选、模板详情和“使用此结构生成”。模板只提供公开元数据和结构参考，爬虫默认关闭。
- 服务端 HTML + Playwright 生成 A4 中文 PDF，支持分页、中文字体和安全文件名。
- 最小管理后台：模板来源管理、抓取任务触发、审核、下架和审计日志。
- 完整测试：单元测试、HTTP 集成测试、爬虫合规测试和桌面/移动端 Playwright E2E。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web | Next.js 16、React 19、TypeScript |
| API | NestJS 11、Node.js、Zod |
| 数据 | Prisma 6、SQLite（本地默认）、PostgreSQL（可选部署配置） |
| 限流/队列 | 内存适配器（本地默认）、Redis、BullMQ worker（可选） |
| AI | DeepSeek Chat Completions；后端 JSON Schema/Zod 校验、超时、重试和错误映射 |
| PDF | Playwright/Chromium、服务端 HTML 模板、Noto Sans CJK 或系统中文字体 |
| 测试 | Vitest、Node test runner、Supertest、Playwright |
| 存储/安全 | 本地 SQLite；可选 S3 兼容归档；AES-256-GCM 密钥加密、Cookie 会话、CSRF、审计日志 |

## 运行前提

- Node.js **22.12 或更高版本**（推荐 Node.js 24）和 npm。
- Windows、macOS 或 Linux。默认不需要 Docker、PostgreSQL、Redis、SMTP 或云服务器。
- PDF 导出需要 Playwright 浏览器。脚本会尝试准备浏览器；手动运行时可执行 `npm run browser:install`。
- AI 功能需要 DeepSeek API Key；不配置 Key 时，注册、简历编辑、模板浏览和 PDF 导出仍可使用。

## 一键启动

在 GitHub 下载或克隆仓库后：

- Windows：双击项目根目录的 `start.bat`，或在 PowerShell 执行 `./start.bat`。
- macOS/Linux：在终端执行 `chmod +x start.sh && ./start.sh`。

启动脚本会检查 Node 版本、创建 `.env`（不会覆盖已有配置）、安装 npm 依赖、生成 Prisma Client、执行 SQLite 迁移，然后启动 API 和 Web。启动后打开：

```text
http://127.0.0.1:3000
```

首次启动建议保持终端窗口打开，以便查看 API、Next.js 和 PDF 浏览器错误。

后续重复启动会复用已有的 `node_modules` 和 Playwright 浏览器缓存；如果你更新了分支或 `package-lock.json`，请先手动执行 `npm ci`。

## 手动本地运行

如果不使用一键脚本，可以按以下步骤操作。

### 1. 安装依赖并复制环境变量

```bash
npm ci
cp .env.example .env
# Windows PowerShell：Copy-Item .env.example .env
```

如果 `.env` 已存在，请不要覆盖它。至少生成一个本地加密密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将输出的 **64 位十六进制字符串**填入：

```dotenv
USER_SECRET_ENCRYPTION_KEY=这里填入上一步生成的64位字符串
```

这个值用于加密用户自定义 DeepSeek Key。丢失它将无法解密已经保存的用户 Key；本地开发请妥善备份，但不要提交到 GitHub。

### 2. 初始化数据库

```bash
npm run db:setup
```

本地默认数据库是 `prisma/dev.db`。它是持久化 SQLite 文件，不是临时内存数据库；不要把包含个人简历的数据库提交到公开仓库。

### 3. 准备 PDF 浏览器并启动

```bash
npm run browser:install
npm run dev
```

浏览器访问 `http://127.0.0.1:3000`。API 默认在 `http://127.0.0.1:3001`，Web 会通过 Next.js rewrite 访问 API。

## DeepSeek API Key 配置

项目支持两种 Key，用途不同。

### 方式 A：系统默认 Key（维护者或本地单用户）

1. 登录 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 API Key。
2. 打开项目根目录的 `.env`，填写服务端变量：

   ```dotenv
   DEEPSEEK_API_KEY=sk-你的系统Key
   DEEPSEEK_BASE_URL=https://api.deepseek.com
   DEEPSEEK_MODEL=deepseek-flash
   ```

3. 保存文件并重启 `npm run dev`。

该 Key 只在 API 进程读取，**不要**写成 `NEXT_PUBLIC_DEEPSEEK_API_KEY`，也不要放进前端代码、截图、Issue 或提交记录。未配置系统 Key 时，AI 面板会提示用户配置自己的 Key。

### 方式 B：用户自己的 Key（BYOK）

1. 启动网站并注册/登录。
2. 打开任意简历的“AI 助手”。
3. 在“DeepSeek API Key”设置区域粘贴自己的 `sk-...` Key，点击“保存 Key”。
4. 页面只显示类似 `sk-****abcd` 的脱敏结果；服务端使用 `USER_SECRET_ENCRYPTION_KEY` 加密后写入数据库。
5. 留空或点击“清除并使用系统额度”后，用户会回退到系统 Key 和默认每日 3 次额度。

BYOK Key 永远不会返回给浏览器、写入 AI 生成日志或出现在异常响应中。上游返回 401 时，界面会显示“您的 API Key 无效，请检查后重试”。请只粘贴 DeepSeek Key，不要粘贴其他服务的 Token。

## 可选配置

`.env.example` 已列出完整配置。常用项如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `file:./dev.db` | 本地 SQLite；生产 PostgreSQL 使用独立 schema 和迁移 |
| `REDIS_URL` | `memory://` | 本地单进程限流；多进程/worker 时使用 Redis |
| `AI_DAILY_LIMIT` | `3` | 系统 Key 的每日生成次数 |
| `AI_REQUESTS_PER_MINUTE` | `5` | 每用户每分钟生成次数 |
| `USER_SECRET_ENCRYPTION_KEY` | 必填 | 32 字节 AES-256-GCM 密钥，64 位十六进制 |
| `PDF_FONT_PATH` | 空 | 需要时指定 Noto Sans CJK 或其他中文字体文件 |
| `CRAWLER_ENABLED` | `false` | 合规爬虫总开关，保持关闭直到来源授权完成 |

## 管理员与模板审核

本地注册后，在项目根目录执行以下命令将账号设为管理员：

```bash
npm run admin -- your-email@example.com
```

然后重新登录并访问 `/admin`。模板采集默认关闭；只有明确获得授权、通过 robots.txt/ToS 检查并在后台审核通过的公开元数据才会展示。项目不绕过登录、验证码或访问控制，也不复制受版权保护的模板源文件、完整图片或正文。

## 项目截图（发布前补充）

建议把图片放在 `docs/screenshots/`，并在此处替换占位符。最能体现项目完成度的截图是：

1. 首页或登录页：展示产品定位和简洁视觉风格。
2. 简历编辑器桌面端：左侧模块表单、右侧实时预览、模块排序/显示控制同屏可见。
3. AI 助手面板：展示“生成内容预览”以及“采纳/放弃”按钮，突出不会自动覆盖简历。
4. BYOK 设置：展示脱敏 Key、额度提示和隐私说明，切勿截入真实 Key。
5. 模板详情：展示结构标签、来源链接和“使用此结构生成”入口。
6. PDF 成品：展示中文字体、A4 分页和专业模板效果。
7. 移动端编辑器：展示响应式布局和 AI 面板可用性。

```markdown
<!-- 发布前将文件放入 docs/screenshots/ 后取消注释 -->
![简历编辑器](docs/screenshots/resume-editor.png)
![AI 预览与采纳](docs/screenshots/ai-preview.png)
![模板详情](docs/screenshots/template-detail.png)
![中文 PDF](docs/screenshots/pdf-preview.png)
```

截图注意事项：使用演示账号和虚构经历；Key、邮箱、手机号、公司内部信息和本地文件路径都要打码。

## 测试与质量检查

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

E2E 测试会覆盖桌面和移动视口；AI 成功响应使用受控 mock，不会产生模型费用。HTTP 集成测试使用 `artifacts/` 下的临时 SQLite 文件。真实 DeepSeek、SMTP、S3 和 Docker 服务不在默认本地测试中调用。

## 常见问题（FAQ）

### Node 版本不对怎么办？

查看版本：

```bash
node -v
```

项目要求 Node.js `>=22.12`。如果使用 nvm：

```bash
nvm install 22.12.0
nvm use 22.12.0
npm ci
```

Windows 也可以使用 nvm-windows；安装后重新打开终端，再执行 `node -v` 确认生效。

### 双击脚本后窗口立即关闭怎么办？

从 PowerShell 或终端运行脚本以保留错误输出：

```powershell
./start.bat
```

常见原因是 Node 版本过低、端口被占用或依赖安装失败。先执行 `node -v`、`npm -v`，再重新运行 `npm ci`。

### 端口 3000 或 3001 被占用怎么办？

Windows：

```powershell
Get-NetTCPConnection -LocalPort 3000,3001 -ErrorAction SilentlyContinue
```

macOS/Linux：

```bash
lsof -i :3000
lsof -i :3001
```

停止占用端口的进程，或在 `.env` 修改 `PORT` 并同步调整 `APP_ORIGIN`/`API_INTERNAL_URL`。

### AI 提示未配置或额度用完怎么办？

确认 `.env` 中的 `DEEPSEEK_API_KEY` 没有引号、空格或换行，并重启 API。个人用户也可以直接在 AI 助手中配置自己的 Key；系统 Key 默认每日 3 次，BYOK 不占用系统每日额度。Key 无效时请重新从 DeepSeek 控制台复制。

### PDF 中文乱码或浏览器找不到怎么办？

先安装浏览器：

```bash
npm run browser:install
```

Linux 还需要中文字体，例如 Debian/Ubuntu：

```bash
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk
```

必要时在 `.env` 设置 `PLAYWRIGHT_EXECUTABLE_PATH` 和 `PDF_FONT_PATH`。Windows 通常会自动检测 Edge 与系统中文字体。

### 没有 Redis 能不能运行？

可以。本地默认 `REDIS_URL=memory://`，适用于单进程开发。多 API 进程、独立 worker 或正式部署时应使用 Redis，否则限流状态不会跨进程共享。

### 手机能访问本地网站吗？

默认开发服务绑定 `127.0.0.1`，只能本机访问。需要手机联调时，将 Web 绑定到局域网地址（例如 `0.0.0.0`）、把 `.env` 的 `APP_ORIGIN` 改为电脑局域网 IP，并允许防火墙放行 3000 端口；然后用手机打开 `http://电脑局域网IP:3000`。不要把开发端口直接暴露到公网。

### 模板爬虫为什么没有数据？

这是默认安全策略。`CRAWLER_ENABLED=false`，且每个来源还必须明确授权、通过 robots/ToS 检查并经过管理员审核。未知或不允许采集的来源会被跳过，不会通过绕过登录或验证码来强行抓取。

### 如何清空本地开发数据？

停止开发服务后删除 `prisma/dev.db`，再执行：

```bash
npm run db:setup
```

此操作会删除本地账号、简历和模板，只适合没有需要保留的数据时使用。公开展示前请确认 `.gitignore` 未被修改，并且没有提交 `.env`、数据库或测试产物。

## 目录概览

```text
apps/web       Next.js 页面、编辑器、AI 面板和模板库
apps/api       NestJS API、认证、简历、AI、PDF、模板和后台模块
apps/worker    BullMQ/爬虫独立 worker
packages/shared 共享类型、校验 schema 和简历初始模块
prisma         SQLite schema、PostgreSQL schema 和迁移
tests          HTTP 集成、E2E 和爬虫合规测试
docs           PRD、架构、API、验收和部署记录
```

## 开源说明

这是一个本地优先的求职展示项目。默认不上传简历内容、不自动调用第三方模板站点，也不包含支付和多人协作。发布到 GitHub 前请补充适合你的开源许可证，并检查提交历史中没有 API Key、加密密钥、个人简历或测试账号。
