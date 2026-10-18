# 参与开发

欢迎提交 Bug 复现、功能 PR 与平台兼容反馈。

## 快速开始

1. 克隆仓库
2. 浏览器打开 `chrome://extensions`（Edge 为 `edge://extensions`）
3. 打开「开发者模式」
4. 点击「加载已解压的扩展程序」，选择仓库根目录（含 `manifest.json` 的文件夹）
5. 修改代码后，在扩展管理页点「刷新」并刷新学习通页面即可看到效果

## 目录结构

```
├── manifest.json            # 扩展清单（MV3）
├── background.js            # 后台：DeepSeek 代理 + 侧边栏命令/状态中转
├── content/
│   ├── tasks.js             # 学习页面板：任务点识别/按序完成、视频控制、倍速、章节跳转、悬浮球
│   ├── video-player.js      # 视频帧：自动播放、完成检测、状态上报（含 iframe）
│   └── answer-helper.js     # 刷题助手：识别题目 → DeepSeek 生成答案 → 自动填选
├── sidepanel/               # 浏览器侧边栏视频控制器
├── popup/                   # 设置弹窗（API Key / 模型 / 倍速 / 开关）
└── icons/                   # 16/48/128 图标
```

## 核心接口

- **DeepSeek 调用**：内容脚本通过 `chrome.runtime.sendMessage({ type: "deepseek-ask", messages })`
  请求后台代理（`background.js`），后台携带用户配置的 API Key 调用
  `https://api.deepseek.com/chat/completions`，返回 `{ ok, content }` 或 `{ ok:false, error }`。
- **视频控制**：合并面板通过 `chrome.runtime.sendMessage({ type: "cxh-forward-command", command })`
  转发到标签页所有帧（`tabs.sendMessage`），视频帧收到 `cxh-command` 后执行 `play/pause/toggle`。
- **任务点状态**：学习通把 `ans-job-finished` 加在 `.ans-attach-ct` 上；任务点类型由 iframe 的
  `ans-insertvideo-online`（视频）/ `insertdoc-online-*`（图文）区分。

## 开发建议

- 学习通 DOM 会随平台更新变化，选择器集中在 `content/tasks.js` 与 `content/video-player.js` 顶部常量处，便于调整。
- 提交 PR 前请确保 `node --check` 通过所有 JS 文件，并说明测试环境（浏览器版本 / 平台页面）。
- 不要提交账号、密码、API Key 等敏感信息。
- 自动化测试可使用 `puppeteer-core` 加载扩展做回归（参考仓库外 `edge-test` 目录的测试脚本写法）。

## 合规提醒

本项目仅供个人学习辅助使用。请遵守所在学校与课程平台的规定，考试场景请勿使用自动化答题功能。
