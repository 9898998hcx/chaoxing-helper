/**
 * 学习通课程助手 · 设置弹窗
 * 读写 chrome.storage.local，保存后立即生效（内容脚本监听 onChanged）。
 */

"use strict";

const $ = (id) => document.getElementById(id);

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

(async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $("apiKey").value = cfg.apiKey || "";
  $("model").value = cfg.model;
  $("rate").value = String(cfg.rate);
  $("autoPlay").checked = !!cfg.autoPlay;
  $("autoNext").checked = !!cfg.autoNext;
  $("antiPause").checked = !!cfg.antiPause;
  $("autoAnswer").checked = !!cfg.autoAnswer;
  $("autoSubmit").checked = !!cfg.autoSubmit;
  if (!cfg.apiKey) $("status").textContent = "提示：请先填写 API Key";
})();

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const cfg = {
    apiKey: $("apiKey").value.trim(),
    model: $("model").value,
    rate: Number($("rate").value),
    autoPlay: $("autoPlay").checked,
    autoNext: $("autoNext").checked,
    antiPause: $("antiPause").checked,
    autoAnswer: $("autoAnswer").checked,
    autoSubmit: $("autoSubmit").checked
  };
  await chrome.storage.local.set(cfg);
  $("status").textContent = "已保存 ✓";
  setTimeout(() => {
    if ($("status").textContent === "已保存 ✓") $("status").textContent = "";
  }, 1500);
});

// 打开浏览器侧边栏视频控制面板（Chrome 116+ / Edge 116+）
$("openPanel").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ tabId: tab.id });
    $("status").textContent = "已打开侧边栏面板";
  } catch (e) {
    $("status").textContent = "打开失败：请点浏览器右上角侧边栏图标";
  }
  setTimeout(() => { $("status").textContent = ""; }, 2500);
});
