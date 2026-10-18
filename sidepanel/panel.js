/**
 * 学习通课程助手 · 侧边栏视频控制器
 *
 * 每 1 秒轮询一次：
 *   1. 当前活动标签页是否学习通页面
 *   2. 通过后台向内容脚本查询视频状态（播放中 / 已暂停 / 完成 / 进度）
 *
 * 播放 / 暂停按钮通过后台发送 cxh-command 命令到页面内容脚本。
 * 三个开关（自动播放 / 自动连播 / 防挂机）直接写 chrome.storage.local，
 * 内容脚本监听 onChanged 实时生效。
 */

"use strict";

const $ = (id) => document.getElementById(id);

const CHAO_RE = /^https:\/\/([a-z0-9-]+\.)?(chaoxing\.com|xueyinonline\.com)\//i;
const SWITCHES = ["autoPlay", "autoNext", "antiPause"];
const DEFAULTS = { autoPlay: true, autoNext: true, antiPause: true };

let currentTabId = null;
let lastStatus = null;

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function render() {
  const badge = $("stateBadge");
  const title = $("videoTitle");
  const fill = $("barFill");
  const time = $("timeText");
  const btn = $("toggleBtn");

  if (currentTabId === null) {
    badge.textContent = "未连接";
    badge.className = "badge";
    title.textContent = "当前标签页不是学习通页面";
    fill.style.width = "0%";
    time.textContent = "00:00 / 00:00";
    btn.disabled = true;
    btn.textContent = "▶ 播放";
    return;
  }

  const st = lastStatus;
  if (!st || !st.hasVideo) {
    badge.textContent = "未检测到视频";
    badge.className = "badge";
    title.textContent = "当前页面没有学习通视频";
    fill.style.width = "0%";
    time.textContent = "00:00 / 00:00";
    btn.disabled = true;
    btn.textContent = "▶ 播放";
    return;
  }

  const ratio = st.duration > 0 ? Math.min(1, st.currentTime / st.duration) : 0;
  fill.style.width = (ratio * 100).toFixed(1) + "%";
  time.textContent = fmt(st.currentTime) + " / " + fmt(st.duration);

  if (st.ended) {
    badge.textContent = "播放完成";
    badge.className = "badge done";
    btn.textContent = "▶ 播放";
  } else if (st.playing) {
    badge.textContent = "播放中";
    badge.className = "badge playing";
    btn.textContent = "⏸ 暂停";
  } else {
    badge.textContent = "已暂停";
    badge.className = "badge paused";
    btn.textContent = "▶ 播放";
  }
  btn.disabled = false;

  const rate = st.rate && st.rate !== 1 ? " · " + st.rate + "x" : "";
  title.textContent = (st.title || "课程视频") + rate;
}

async function poll() {
  let tab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0] ? tabs[0] : null;
  } catch (_) { tab = null; }

  const nextTabId = tab && tab.url && CHAO_RE.test(tab.url) ? tab.id : null;
  currentTabId = nextTabId;
  lastStatus = null;

  if (currentTabId !== null) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "cxh-get-status", tabId: currentTabId });
      if (resp && resp.ok && resp.status) lastStatus = resp.status;
    } catch (_) { /* 后台未就绪 */ }
  }
  render();
}

$("toggleBtn").addEventListener("click", async () => {
  if (currentTabId === null) return;
  const cmd = lastStatus && lastStatus.playing ? "pause" : "play";
  try {
    await chrome.runtime.sendMessage({ type: "cxh-send-command", tabId: currentTabId, command: cmd });
  } catch (_) { /* 忽略发送失败 */ }
  setTimeout(poll, 300);
});

(async function init() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  for (const key of SWITCHES) {
    $(key).checked = !!cfg[key];
    $(key).addEventListener("change", () => {
      chrome.storage.local.set({ [key]: $(key).checked });
    });
  }
  poll();
  setInterval(poll, 1000);
})();
