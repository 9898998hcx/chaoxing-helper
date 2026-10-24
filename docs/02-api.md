# REST API 合约

前缀 `/api`。鉴权栏：公开=无需会话；用户=会话；管理员=会话+ADMIN。所有已登录写操作同时校验 CSRF。资源 id 均由服务端校验所有权，列表不返回其他用户数据。

| 方法/路径 | 鉴权 | 请求字段 | 成功响应 | 主要失败 |
| --- | --- | --- | --- | --- |
| GET /health | 公开 | 无 | status | 503 |
| POST /auth/register | 公开+Origin | email,password(≥10) | user,csrfToken,verificationRequired | 400,409,429,503邮件 |
| POST /auth/login | 公开+Origin | email,password | user,csrfToken | 401,429 |
| GET /auth/me | 用户 | 无 | user,csrfToken | 401 |
| POST /auth/logout | 用户 | 无 | ok | 403 |
| POST /auth/verify-email | 公开+Origin | token | ok | 400过期/已使用 |
| POST /auth/resend-verification | 用户 | 无 | ok | 429,503 |
| GET /resumes | 用户 | 无 | resumes[] | 401 |
| POST /resumes | 用户 | title,sections?,templateId? | resume | 400,404模板 |
| GET /resumes/:id | 用户 | 无 | resume | 404 |
| PATCH /resumes/:id | 用户 | revision,title,sections,templateId? | resume(新revision) | 400,404,409 |
| DELETE /resumes/:id | 用户 | 无 | ok | 404 |
| POST /resumes/:id/duplicate | 用户 | 无 | resume | 404 |
| GET /resumes/:id/versions | 用户 | 无 | versions[{id,revision,createdAt}] | 404 |
| POST /resumes/:id/versions | 用户 | 无 | version | 404 |
| POST /resumes/:id/versions/:versionId/restore | 用户 | revision | resume | 404,409 |
| GET /ai/quota | 用户 | 无 | configured,remaining,dailyLimit,resetAt | 401 |
| POST /ai/generate | 用户 | resumeId,scenario,sectionType?,jd?,experience?,content?,templateId? | generationId,scenario,result{sectionType,items[],suggestions[]},quota | 400,404,429,502结构错误,503无Key,504超时 |
| POST /resumes/:id/pdf | 用户 | style=professional/clean/compact | application/pdf，安全 Content-Disposition 文件名 | 404,413,429并发,503字体/浏览器,504 |
| GET /templates | 公开 | tag?,style?,industry? | templates[]（仅APPROVED） | 400 |
| GET /templates/recommendations | 公开 | role?,industry?,experience? | templates[],fallback,method | 400 |
| GET /templates/:id | 公开 | 无 | template | 404 |
| GET /admin/sources | 管理员 | 无 | sources[] | 403 |
| POST /admin/sources | 管理员 | name,baseUrl,tosUrl,tosEvidence?,metadataPath?,permissionConfirmed,enabled,rateLimitMs | source | 400,403 |
| PATCH /admin/sources/:id | 管理员 | 上述字段部分更新 | source | 400,404 |
| POST /admin/sources/:id/crawl | 管理员 | 无 | job | 404,409来源禁用,503总开关/Redis |
| GET /admin/crawl-jobs | 管理员 | 无 | jobs[] | 403 |
| GET /admin/templates | 管理员 | status? | templates[] | 400,403 |
| PATCH /admin/templates/:id | 管理员 | status,reviewNote | template | 400,404 |
| GET /admin/audit-logs | 管理员 | 无 | logs[] | 403 |

AI scenario：generate-section / polish / summary / suggestions。sectionType 为 basic / intent / education / work / projects / skills / certificates / summary。items 为字段字符串对象数组；suggestions 为字符串数组；返回值经服务端 schema 校验，不能作为 HTML 执行。

ResumeDocument：id,userId,title,templateId,revision,sections,createdAt,updatedAt。Section：id,type,title,visible,order,content。时间使用 ISO8601 UTC。默认 8 个模块均可排序和显示/隐藏。

错误 envelope 示例：`{"error":{"code":"REVISION_CONFLICT","message":"简历已在其他页面修改，请重新加载后再保存"}}`。实际实现若增加具体错误 code，详见模块源码及验收记录。
