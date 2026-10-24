# Step 3/5：简历编辑与 PDF

简历字段/DTO 在 `packages/shared/src/index.ts`；SQLite 初始迁移在 `prisma/migrations/20261022000000_init/migration.sql`；生产为独立 PostgreSQL 迁移目录。基本信息、求职意向、教育、工作、项目、技能、证书、自我评价均支持排序/隐藏，经历类支持多条记录。

编辑器左侧表单右侧 A4 预览；移动端切换编辑/预览。800ms 防抖且同一编辑器串行保存，保存期间继续编辑会在下一次请求持久化。服务端 revision 乐观锁冲突返回 409，界面保留本地修改，可下载冲突草稿后手动重载。离开未保存页面触发浏览器保护。自动快照最多最近 50 版，恢复生成新 revision。

API 和用户隔离见 `02-api.md`。简历所有读取/写入/删除/复制/版本/PDF 操作以服务端会话 userId 查询；他人 ID 返回 404。复制会重新生成模块 ID，防止引用或移动其他简历模块。

PDF 通过 `POST /api/resumes/:id/pdf`、body `{style:"professional"}` 请求；style 可为 professional/clean/compact，分别为原创专业蓝、简约、紧凑样式。输入为数据库当前保存版本，前端先 flush 保存；中文名以 RFC5987 下载名返回，兼容 ASCII 后备名。

服务端 HTML 全部转义，禁脚本、禁外部资源、禁 ServiceWorker；A4、16/17mm 页边距、尽量避免记录断页，超长记录可自然跨页。每用户每分钟最多 3 次、单 API 进程默认最多 2 个 PDF、输入默认 200KB、输出 10MiB、渲染阶段超时 20s；生产当前为单 API 实例，扩容需增加共享信号量或独立 PDF 队列。

Windows 检测系统 Edge/微软雅黑；Linux 安装 Chromium 与 Noto Sans CJK；自定义字体 `PDF_FONT_PATH`（最大30MiB）。无字体、无浏览器、超时、繁忙与内容过大均有明确错误 code。默认直接下载、不存服务器；可开启 S3 私有归档，需配置凭据、私有桶和生命周期。S3 归档开启而失败会显式报错，不返回假成功。

验收：创建/编辑→看到已保存→刷新恢复→排序/隐藏影响预览→保存快照→恢复旧版并产生新版本→第二账号 GET/PATCH/DELETE/duplicate/versions/pdf 全部404→填入多页中文内容→在桌面/手机下载 PDF 检查文字和分页。容器依赖命令及上线限制见 `09-deployment.md`。
