/**
 * 学习通课程助手 · DeepSeek
 * 后台服务（Service Worker）：
 *   1. 代理 DeepSeek API 请求（内容脚本跨域请求会被 CORS 限制）
 *   2. 转发侧边栏控制器的播放/暂停命令到页面内容脚本
 *   3. 维护各标签页的视频状态缓存，供侧边栏面板轮询展示
 */

"use strict";

const DEFAULTS = {
  apiKey: "",
  model: "deepseek-chat",
  rate: 1,
  autoPlay: true,
  autoNext: true,
  antiPause: true,
  autoAnswer: false,
  autoSubmit: false
};

/** tabId -> { status, frameId, ts } 最近一次视频状态上报 */
const statusByTab = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  // ---- DeepSeek 请求代理 ----
  if (msg.type === "deepseek-ask") {
    handleAsk(msg).then(sendResponse);
    return true;
  }

  // ---- 内容脚本上报视频状态 ----
  if (msg.type === "cxh-status" && sender && sender.tab) {
    statusByTab.set(sender.tab.id, {
      status: msg.status || null,
      frameId: sender.frameId,
      ts: Date.now()
    });
    return false;
  }

  // ---- 侧边栏：查询某标签页的视频状态 ----
  if (msg.type === "cxh-get-status") {
    const entry = statusByTab.get(msg.tabId);
    const fresh = entry && Date.now() - entry.ts < 8000 ? entry.status : null;
    sendResponse({ ok: true, status: fresh });
    return false;
  }

  // ---- 侧边栏：向标签页发送播放/暂停命令 ----
  if (msg.type === "cxh-send-command") {
    try {
      chrome.tabs.sendMessage(msg.tabId, { type: "cxh-command", command: msg.command }, () => {
        const err = chrome.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      return false;
    }
    return true;
  }

  // ---- 内容脚本（悬浮面板）请求转发命令到本标签页所有帧 ----
  if (msg.type === "cxh-forward-command") {
    if (!sender || !sender.tab) {
      sendResponse({ ok: false, error: "no tab" });
      return false;
    }
    try {
      chrome.tabs.sendMessage(sender.tab.id, { type: "cxh-command", command: msg.command }, () => {
        const err = chrome.runtime.lastError;
        sendResponse(err ? { ok: false, error: err.message } : { ok: true });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      return false;
    }
    return true;
  }

  return false;
});

// 标签页关闭 / 跳转后丢弃旧状态
chrome.tabs.onRemoved.addListener((tabId) => statusByTab.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") statusByTab.delete(tabId);
});

/**
 * 调用 DeepSeek Chat Completions。
 * @param {{messages: Array<{role: string, content: string}>}} msg
 * @returns {Promise<{ok: boolean, content?: string, error?: string}>}
 */
async function handleAsk(msg) {
  try {
    const cfg = await chrome.storage.local.get({ apiKey: "", model: "deepseek-chat" });
    if (!cfg.apiKey) {
      return { ok: false, error: "未配置 DeepSeek API Key，请点击扩展图标在设置中填写。" };
    }

    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model || "deepseek-chat",
        temperature: 0.2,
        max_tokens: 1200,
        messages: msg.messages
      })
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const detail =
        data && data.error && data.error.message
          ? data.error.message
          : "HTTP " + resp.status;
      return { ok: false, error: "DeepSeek API 错误：" + detail };
    }

    const content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message.content === "string"
        ? data.choices[0].message.content.trim()
        : "";

    if (!content) {
      return { ok: false, error: "DeepSeek 返回内容为空。" };
    }
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: "请求失败：" + (e && e.message ? e.message : String(e)) };
  }
}
