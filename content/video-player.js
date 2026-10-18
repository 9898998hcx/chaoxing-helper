/**
 * 学习通课程助手 · 视频自动播放模块（v1.3.3）
 *
 * 运行在所有 chaoxing / xueyinonline 页面（含 iframe，all_frames: true）。
 * 职责：
 *   1. 自动播放课程视频（被浏览器拦截时先静音尝试，成功后恢复声音）
 *   2. 应用用户设置的倍速
 *   3. 断播自动恢复（防挂机暂停，且不打扰用户手动暂停）
 *   4. 定期点击"继续播放 / 继续观看 / 我知道了"等挂机提示
 *   5. 自动识别视频播放完成（ended 事件 + 进度轮询兜底），
 *      完成后自动进入下一节（分段优先本帧下一集，否则通知顶层点下一章节）
 *   6. 响应侧边栏控制器的播放 / 暂停命令，并每 2 秒上报视频状态
 *   7. **页面内悬浮视频控制器**：检测到视频后，在页面右下角弹出
 *      一个小面板（状态 / 进度 / 播放暂停按钮 / 关闭），无需打开侧边栏
 *
 * v1.3.3 更新（真实学习通页面实测修复）：
 *   - 去掉"暂停后自动恢复播放"：它会把用户手动暂停的视频立刻播起来，
 *     表现为"暂停不管用"。播放/暂停完全由用户、悬浮面板或播放器控件控制。
 *   - 播放/暂停命令优先调用学习通使用的 Video.js 播放器 API / 播放器控件
 *     （vjs-play-control / vjs-big-play-button），比直接操作 <video> 更可靠。
 *   - 只控制"可见"的视频帧，隐藏的任务点帧不再干扰状态与命令。
 *
 * v1.3.2 更新（真实页面实测修复）：
 *   - 不再点击"知道了"类挂机提示：它们是 javascript: 链接，点击被页面 CSP 拦截
 *     （Running the JavaScript URL violates CSP），还会导致页面反复暂停
 *   - 悬浮面板的播放/暂停命令改由后台转发到所有帧（含嵌套 iframe），
 *     修复面板按钮点了没反应的问题
 *
 * v1.3.1 更新（修复"未播完就跳下一个视频"）：
 *   - 完成判定只认"自然播放到结尾"：timeupdate 记录 __cxhNearEnd，
 *     暂停在结尾附近不再被误判为完成（这正是之前提前跳转的主因）
 *   - 平台自动切段/重播时跳过手动点击，避免连点造成跳段
 *   - 忽略过期 iframe 发来的结束消息
 *   - 完成消息增加 15 秒冷却，避免同一次完成触发多次跳转
 *
 * v1.3 更新：
 *   - 新增页面内悬浮控制器（弹窗），视频页自动出现，直接控制播放/暂停
 *   - iframe 内视频状态通过 postMessage 中继到顶层帧渲染
 *
 * v1.2 更新：
 *   - 侧边栏控制：接收 cxh-command（play / pause / toggle），上报 cxh-status
 *   - 手动暂停锁定：侧边栏/悬浮面板暂停后不会被自动恢复逻辑抢播
 *
 * v1.1 更新：
 *   - 持续监听视频元素：播放器换片段/换源时自动重新绑定
 *   - 完成检测双保险：ended 不触发时靠进度轮询兜底
 *   - 分段视频优先在本帧连播，不误跳章节
 *   - 顶层翻页加冷却与切换校验，避免一次完成触发多次点击
 *   - 用户手动暂停后 3 秒内不自动恢复
 */

"use strict";

(() => {
  if (window.__CXH_VIDEO_INIT__) return;
  window.__CXH_VIDEO_INIT__ = true;

  const TAG = "[学习通助手·视频]";
  const isTop = () => window === window.top;

  /** 学习页上由任务点助手按顺序控制播放，避免多个视频帧同时自动抢播 */
  function isStudyPage() {
    try {
      return /\/mycourse\/studentstudy/.test(window.top.location.pathname);
    } catch (e) {
      return false;
    }
  }

  const settings = {
    autoPlay: true,
    autoNext: true,
    antiPause: true,
    rate: 1
  };

  let videoEl = null;
  let currentSrc = "";
  let lastPlayAttempt = 0;
  let lastUserInteraction = 0;
  let userMuted = false;
  let manualPaused = false;

  chrome.storage.local.get(settings, (cfg) => {
    Object.assign(settings, cfg);
    applyRate();
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes)) {
      if (key in settings) settings[key] = changes[key].newValue;
    }
    applyRate();
  });

  // 记录用户交互时间：手动暂停 / 点按视频时不与用户"抢"播放
  ["mousedown", "touchstart", "keydown"].forEach((type) => {
    document.addEventListener(type, () => { lastUserInteraction = Date.now(); }, true);
  });

  function applyRate() {
    if (!videoEl) return;
    const rate = Math.min(4, Math.max(0.5, Number(settings.rate) || 1));
    if (Math.abs(videoEl.playbackRate - rate) > 0.01) {
      videoEl.playbackRate = rate;
      console.info(TAG, "倍速设置为", rate);
    }
  }

  // ---------- 视频定位、绑定与持续监听 ----------

  function videoSrcOf(video) {
    return video.currentSrc || video.src || "";
  }

  /** 视频是否可见（页面可能有多个隐藏的视频帧，只控制可见的那个） */
  function videoVisible() {
    if (!videoEl || !document.body.contains(videoEl)) return false;
    const rect = videoEl.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** 获取学习通使用的 Video.js 播放器实例 */
  function getPlayer() {
    try {
      if (window.videojs && videoEl) {
        const players = window.videojs.getPlayers ? window.videojs.getPlayers() : null;
        if (players) {
          for (const key of Object.keys(players)) {
            const p = players[key];
            if (p && typeof p.el === "function" && p.el().contains(videoEl)) return p;
          }
        }
        if (players && players.video) return players.video;
        try { return window.videojs("video"); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function clickPlayerControl(selector) {
    const el = document.querySelector(selector);
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  /** 通过播放器 API / 播放器控件播放，比直接 video.play() 更可靠 */
  function playVideo() {
    if (!videoEl) return false;
    const player = getPlayer();
    if (player) {
      try {
        player.play();
        return true;
      } catch (_) { /* 回落 */ }
    }
    if (clickPlayerControl(".vjs-big-play-button")) return true;
    if (clickPlayerControl(".vjs-play-control.vjs-paused")) return true;
    attemptPlay();
    return false;
  }

  /** 通过播放器 API / 播放器控件暂停 */
  function pauseVideo() {
    if (!videoEl) return false;
    const player = getPlayer();
    if (player) {
      try {
        player.pause();
        return true;
      } catch (_) { /* 回落 */ }
    }
    if (clickPlayerControl(".vjs-play-control.vjs-playing")) return true;
    videoEl.pause();
    return true;
  }

  function bindVideo(video) {
    videoEl = video;
    currentSrc = videoSrcOf(video);
    video.__cxhBound = true;
    video.__cxhDone = false;
    video.__cxhNearEnd = false;
    applyRate();
    // 学习页由任务点助手按顺序控制播放，避免多个视频帧同时自动播放
    if (!isStudyPage() && settings.autoPlay && !manualPaused && videoVisible()) playVideo();

    video.addEventListener("ended", () => markCompleted(video, "ended 事件"));

    // 自然播放到结尾附近的证据：只有"边播放边接近结尾"才算，
    // 暂停在结尾或拖到结尾都不算（防止误判完成而提前跳转）
    video.addEventListener("timeupdate", () => {
      if (
        !video.paused &&
        !video.ended &&
        video.duration > 5 &&
        video.currentTime >= video.duration - 2
      ) {
        video.__cxhNearEnd = true;
      }
    });

    video.addEventListener("play", () => {
      // 用户或控制器重新播放：解除手动暂停锁定
      manualPaused = false;
    });

    // 说明：不再对暂停做"自动恢复"——用户通过播放器或面板手动暂停时，
    // 自动恢复会立刻把视频播起来（用户表现为"暂停不管用"）。
    // 挂机弹窗的"继续播放"由 scanPrompts 点击处理，播放/暂停完全交给用户与面板。
    video.addEventListener("pause", () => {
      if (video.ended) return;
      console.info(TAG, "视频已暂停（等待用户或面板指令）");
    });

    video.addEventListener("playing", () => {
      if (video.muted && !userMuted) video.muted = false;
    });

    // 视频帧状态即时上报（事件驱动，让学习页合并面板实时同步播放/暂停）
    if (!isTop()) {
      ["play", "playing", "pause", "ended", "seeking", "seeked", "waiting", "ratechange"].forEach((ev) => {
        video.addEventListener(ev, () => relayStatusToTop());
      });
      let lastRelay = 0;
      video.addEventListener("timeupdate", () => {
        const now = Date.now();
        if (now - lastRelay < 500) return;
        lastRelay = now;
        relayStatusToTop();
      });
    }
  }

  /**
   * 持续监听：视频元素被替换（分段播放器 / SPA 换页）或换源时重新绑定。
   */
  function watchVideos() {
    const video = document.querySelector("video");
    if (!video) return;
    if (video !== videoEl) {
      console.info(TAG, "检测到新的视频元素，重新绑定");
      bindVideo(video);
      return;
    }
    const src = videoSrcOf(video);
    if (src && currentSrc && src !== currentSrc) {
      // 同一元素换了播放源 = 新的一段视频
      console.info(TAG, "视频源已切换，重置完成状态");
      currentSrc = src;
      video.__cxhDone = false;
      video.__cxhNearEnd = false;
      applyRate();
      if (settings.autoPlay && !manualPaused) attemptPlay();
    }
  }

  /**
   * 轮询兜底：部分播放器停在最后一帧不触发 ended。
   * 条件：时长 > 5s、已接近结尾、且处于暂停状态（手动暂停时不判定）。
   */
  function pollCompletion() {
    const video = videoEl;
    if (!video || video.__cxhDone) return;
    if (!settings.autoPlay || manualPaused) return;
    if (!document.body.contains(video)) return; // 旧元素（播放器已换片）不判定
    if (!videoVisible()) return; // 隐藏帧不判定
    if (!video.duration || video.duration < 5) return;
    if (video.seeking) return;
    // 必须存在"自然播放到结尾附近"的证据：暂停在结尾或拖到结尾都不算
    if (!video.__cxhNearEnd) return;
    if (video.paused && video.currentTime >= video.duration - 0.8) {
      markCompleted(video, "进度轮询");
    }
  }

  async function markCompleted(video, source) {
    if (!video || video.__cxhDone) return;
    video.__cxhDone = true;
    console.info(
      TAG,
      "视频播放完成（" + source + "）：" +
        video.currentTime.toFixed(1) + " / " + video.duration.toFixed(1) + "s"
    );

    // 等平台自己切到下一段：若 2.5 秒内已经换了新视频，就不要再点，避免跳段
    await sleep(2500);
    if (videoEl && videoEl !== video) {
      console.info(TAG, "平台已自动切换新视频，跳过手动点击");
      return;
    }
    if (videoEl === video && !video.paused && !video.ended) {
      console.info(TAG, "视频已重新播放，跳过手动点击");
      return;
    }

    // 1) 同一章节内的分段视频：本帧点"下一集"
    if (tryNextInFrame()) {
      console.info(TAG, "已在本分段内点击下一集，等待新视频");
      return;
    }

    // 2) 通知顶层页面进入下一章节
    try {
      window.top.postMessage({ type: "CXH_VIDEO_ENDED" }, "*");
    } catch (_) { /* 跨域容错 */ }
  }

  function attemptPlay() {
    if (!videoEl) return;
    lastPlayAttempt = Date.now();
    const promise = videoEl.play();
    if (promise && promise.catch) {
      promise.catch(() => {
        // 浏览器自动播放策略拦截：静音后重试
        videoEl.muted = true;
        const retry = videoEl.play();
        if (retry && retry.catch) {
          retry.catch(() => {
            console.info(TAG, "自动播放被浏览器拦截，请手动点击一次视频");
          });
        }
        setTimeout(() => {
          if (videoEl && !videoEl.paused && !userMuted) videoEl.muted = false;
        }, 800);
      });
    }
  }

  // ---------- 挂机提示 & 下一集 ----------

  // 只处理视频播放器自身的"继续播放/继续观看"按钮。
  // 不再点击"知道了"类提示：真实页面里它们是 javascript: 链接，
  // 点击会被页面 CSP 拦截（Running the JavaScript URL violates CSP），
  // 并导致页面反复暂停播放，干扰手动暂停/继续功能。
  const PROMPT_TEXTS = ["继续播放", "继续观看"];

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scanPrompts() {
    if (!settings.antiPause) return;
    const nodes = document.querySelectorAll("button, a, div[role=button], span");
    for (const el of nodes) {
      if (el.closest && el.closest('a[href^="javascript:"]')) continue; // 跳过 javascript: 链接，避免 CSP 拦截
      const text = (el.textContent || "").trim();
      if (text && text.length <= 8 && PROMPT_TEXTS.includes(text) && visible(el)) {
        console.info(TAG, "点击播放提示：" + text);
        el.click();
        break;
      }
    }
  }

  /** 本帧内点击"下一集"（同一章节的分段视频） */
  function tryNextInFrame() {
    const texts = ["下一集", "下一节"];
    const nodes = document.querySelectorAll("button, a, div[role=button]");
    for (const el of nodes) {
      const text = (el.textContent || "").trim();
      if (texts.includes(text) && visible(el)) {
        console.info(TAG, "点击本帧下一集");
        el.click();
        return true;
      }
    }
    return false;
  }

  // ---------- 顶层：自动进入下一章节 ----------

  /** 记录当前章节与 iframe 源，用于判断点击是否真的切换了页面 */
  function snapshot() {
    let iframeSrcs = "";
    try {
      iframeSrcs = Array.from(document.querySelectorAll("iframe"))
        .map((f) => f.src || "")
        .join("|");
    } catch (_) { /* 忽略 */ }
    return location.href + "||" + iframeSrcs;
  }

  function changedSince(before) {
    return snapshot() !== before;
  }

  const NEXT_TEXTS = [
    "继续下一章节",
    "下一章节",
    "下一章",
    "下一节",
    "下一集",
    "立即学习",
    "开始学习"
  ];

  function isDialogLike(el) {
    let node = el;
    for (let i = 0; i < 6 && node && node !== document.body; i++) {
      const style = window.getComputedStyle(node);
      if ((style.position === "fixed" || style.position === "absolute") && style.zIndex !== "auto") {
        return true;
      }
      const cls = String(node.className || "");
      if (/(popup|dialog|modal|tip|mask|layer)/i.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function findNextControl() {
    // 1) 精确文本按钮
    const nodes = document.querySelectorAll("a, button, div[role=button], span");
    for (const el of nodes) {
      const text = (el.textContent || "").trim();
      if (NEXT_TEXTS.includes(text) && visible(el)) {
        return { el, text };
      }
    }

    // 2) 弹层里的"继续学习"
    for (const el of nodes) {
      const text = (el.textContent || "").trim();
      if (text === "继续学习" && (el.tagName === "BUTTON" || el.tagName === "A") && visible(el) && isDialogLike(el)) {
        return { el, text };
      }
    }

    // 3) class / onclick 提示
    const hinted = document.querySelectorAll(
      "[onclick*='next'], [onclick*='Next'], [class*='nextbtn'], [class*='nextBtn'], [class*='next_chapter'], [class*='nextChapter']"
    );
    for (const el of hinted) {
      if (visible(el)) return { el, text: "下一节（按类名匹配）" };
    }
    return null;
  }

  /** 回退：侧边栏第一个"未完成"章节链接 */
  function sidebarNext() {
    const curId = new URLSearchParams(location.search).get("chapterId") || "";
    const links = Array.from(document.querySelectorAll('a[href*="studentstudy"]'));
    for (const a of links) {
      let id = "";
      try {
        id = new URL(a.href, location.origin).searchParams.get("chapterId") || "";
      } catch (_) { /* 忽略 */ }
      if (!id || id === curId) continue;
      const row = a.closest(".posCatalog_select, li, dd, tr, div") || a;
      const text = row.textContent || "";
      if (/未完成|学习中/.test(text) && !/已完成/.test(text) && visible(a)) {
        console.info(TAG, "侧边栏回退：点击未完成章节");
        a.click();
        return true;
      }
    }
    return false;
  }

  let advanceCooldownUntil = 0;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function advanceOnce(attempt) {
    if (!settings.autoNext) return;
    const before = snapshot();
    const hit = findNextControl();
    if (hit) {
      console.info(TAG, "点击进入下一节：" + hit.text);
      hit.el.click();
      await sleep(2800);
      if (changedSince(before)) {
        console.info(TAG, "已切换到下一节");
        return;
      }
      if (attempt >= 3) {
        sidebarNext();
        return;
      }
      await sleep(1200);
      return advanceOnce(attempt + 1);
    }
    if (sidebarNext()) return;
    if (attempt < 4) {
      await sleep(1800);
      return advanceOnce(attempt + 1);
    }
    console.info(TAG, "未找到下一节入口，请手动切换");
  }

  function onVideoCompletedMessage() {
    const now = Date.now();
    if (now < advanceCooldownUntil) {
      console.info(TAG, "冷却中，忽略重复的完成消息");
      return;
    }
    advanceCooldownUntil = now + 15000;
    console.info(TAG, "收到视频结束消息，准备进入下一章节");
    advanceOnce(1);
  }

  // ---------- 页面内悬浮视频控制器（顶层帧） ----------

  let floatPanel = null;
  let floatClosed = false;
  let floatHideTimer = null;
  let lastFloatStatus = null;

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function broadcastVideoCommand(cmd) {
    // 通过后台转发给本标签页所有帧（含嵌套 iframe），比 postMessage 更可靠
    try {
      chrome.runtime.sendMessage({ type: "cxh-forward-command", command: cmd }, () => {
        if (chrome.runtime.lastError) { /* 后台未就绪时忽略 */ }
      });
    } catch (_) { /* 扩展重载后旧内容脚本会抛错，忽略 */ }
    // 顶层自身有视频时直接执行
    if (videoEl) {
      if (cmd === "pause") {
        manualPaused = true;
        videoEl.pause();
      } else {
        manualPaused = false;
        attemptPlay();
      }
    }
  }

  function buildFloatPanel() {
    if (floatPanel) return floatPanel;
    const box = document.createElement("div");
    box.id = "cxh-video-float";
    Object.assign(box.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483645",
      width: "220px",
      padding: "10px 12px",
      borderRadius: "12px",
      background: "rgba(24,26,38,0.9)",
      color: "#fff",
      font: "12px/1.5 system-ui,'Microsoft YaHei',sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      display: "none",
      userSelect: "none"
    });

    const head = document.createElement("div");
    Object.assign(head.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "6px"
    });
    const title = document.createElement("span");
    title.textContent = "视频控制";
    Object.assign(title.style, { fontWeight: "600", fontSize: "13px" });
    const close = document.createElement("span");
    close.id = "cxh-float-close";
    close.textContent = "×";
    Object.assign(close.style, {
      cursor: "pointer",
      color: "#9aa0b8",
      fontSize: "16px",
      lineHeight: "1",
      padding: "0 2px"
    });
    close.addEventListener("click", () => {
      floatClosed = true;
      box.style.display = "none";
    });
    head.appendChild(title);
    head.appendChild(close);

    const statusLine = document.createElement("div");
    statusLine.textContent = "检测中…";
    Object.assign(statusLine.style, { color: "#c9cede", marginBottom: "6px" });

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      height: "4px",
      borderRadius: "999px",
      background: "rgba(255,255,255,0.15)",
      marginBottom: "8px",
      overflow: "hidden"
    });
    const fill = document.createElement("div");
    Object.assign(fill.style, {
      height: "100%",
      width: "0%",
      borderRadius: "999px",
      background: "#4f6bff",
      transition: "width .4s"
    });
    bar.appendChild(fill);

    const btn = document.createElement("button");
    btn.textContent = "▶ 播放";
    Object.assign(btn.style, {
      width: "100%",
      border: "none",
      borderRadius: "8px",
      padding: "7px 0",
      cursor: "pointer",
      background: "#4f6bff",
      color: "#fff",
      fontSize: "13px",
      fontWeight: "600"
    });
    btn.addEventListener("click", () => {
      const playing = lastFloatStatus && lastFloatStatus.playing;
      broadcastVideoCommand(playing ? "pause" : "play");
    });

    box.appendChild(head);
    box.appendChild(statusLine);
    box.appendChild(bar);
    box.appendChild(btn);
    document.documentElement.appendChild(box);

    // ---------- 浮窗拖拽移动 ----------
    const FLOAT_POS_KEY = "cxhFloatPos";
    const applyPos = (x, y) => {
      const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.round(Math.min(Math.max(0, x), maxX)) + "px";
      box.style.top = Math.round(Math.min(Math.max(0, y), maxY)) + "px";
    };
    try {
      const saved = JSON.parse(localStorage.getItem(FLOAT_POS_KEY) || "null");
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        box.style.right = "auto";
        box.style.bottom = "auto";
        applyPos(saved.left, saved.top);
      }
    } catch (_) { /* 忽略 */ }

    let drag = null;
    let dragOverlay = null;
    const ensureOverlay = () => {
      if (dragOverlay) return;
      dragOverlay = document.createElement("div");
      Object.assign(dragOverlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483646",
        cursor: "move",
        background: "transparent"
      });
      document.documentElement.appendChild(dragOverlay);
    };
    const removeOverlay = () => {
      if (dragOverlay) {
        dragOverlay.remove();
        dragOverlay = null;
      }
    };
    const beginDrag = (clientX, clientY) => {
      const r = box.getBoundingClientRect();
      drag = { dx: clientX - r.left, dy: clientY - r.top };
      box.style.right = "auto";
      box.style.bottom = "auto";
      box.style.left = Math.round(r.left) + "px";
      box.style.top = Math.round(r.top) + "px";
      ensureOverlay();
    };
    const onMove = (e) => {
      if (!drag) return;
      applyPos(e.clientX - drag.dx, e.clientY - drag.dy);
    };
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      removeOverlay();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", endDrag, true);
      try {
        localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ left: box.offsetLeft, top: box.offsetTop }));
      } catch (_) { /* 忽略 */ }
    };
    const startDragMouse = (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("#cxh-float-close")) return;
      beginDrag(e.clientX, e.clientY);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", endDrag, true);
      e.preventDefault();
    };
    const startDragTouch = (e) => {
      if (e.target && e.target.closest && e.target.closest("#cxh-float-close")) return;
      const t = e.touches[0];
      if (!t) return;
      beginDrag(t.clientX, t.clientY);
      e.preventDefault();
    };
    const onTouchMove = (e) => {
      if (!drag) return;
      const t = e.touches[0];
      if (!t) return;
      applyPos(t.clientX - drag.dx, t.clientY - drag.dy);
      e.preventDefault();
    };
    const onTouchEnd = () => {
      if (!drag) return;
      drag = null;
      removeOverlay();
      try {
        localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ left: box.offsetLeft, top: box.offsetTop }));
      } catch (_) { /* 忽略 */ }
    };
    head.style.cursor = "move";
    head.addEventListener("mousedown", startDragMouse);
    head.addEventListener("touchstart", startDragTouch, { passive: false });
    head.addEventListener("touchmove", onTouchMove, { passive: false });
    head.addEventListener("touchend", onTouchEnd);
    window.addEventListener("resize", () => {
      if (box.style.left && box.style.left !== "auto") {
        applyPos(box.offsetLeft, box.offsetTop);
      }
    });

    floatPanel = { box, statusLine, fill, btn };
    return floatPanel;
  }

  function updateFloatPanel(status) {
    if (!status || !status.hasVideo) return;
    // 学习页上任务点助手使用的是合并面板，这里不再单独弹出视频浮窗
    if (window.__CXH_TASKS_PAGE__) return;
    if (floatClosed) return;
    lastFloatStatus = status;
    const p = buildFloatPanel();
    p.box.style.display = "block";

    const ratio = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
    p.fill.style.width = (ratio * 100).toFixed(1) + "%";

    const stateText = status.ended ? "播放完成" : status.playing ? "播放中" : "已暂停";
    const rateText = status.rate && status.rate !== 1 ? " · " + status.rate + "x" : "";
    p.statusLine.textContent =
      stateText + " · " + fmtTime(status.currentTime) + "/" + fmtTime(status.duration) + rateText;
    p.btn.textContent = status.playing ? "⏸ 暂停" : "▶ 播放";

    clearTimeout(floatHideTimer);
    floatHideTimer = setTimeout(() => {
      if (floatPanel) floatPanel.box.style.display = "none";
    }, 15000);
  }

  // ---------- 侧边栏控制器：命令与状态上报 ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "cxh-command") return false;
    if (!videoEl) {
      sendResponse({ ok: true, hasVideo: false });
      return false;
    }
    try {
      if (msg.command === "play") {
        // 只让可见的视频帧响应播放，避免隐藏帧干扰
        if (!videoVisible()) {
          sendResponse({ ok: true, hasVideo: true, hidden: true });
          return false;
        }
        manualPaused = false;
        playVideo();
      } else if (msg.command === "pause") {
        manualPaused = true;
        pauseVideo();
      } else if (msg.command === "toggle") {
        if (videoVisible() && (videoEl.paused || videoEl.ended)) {
          manualPaused = false;
          playVideo();
        } else {
          manualPaused = true;
          pauseVideo();
        }
      }
      sendResponse({ ok: true, hasVideo: true });
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
    return false;
  });

  /** 每 2 秒上报一次视频状态给后台（供侧边栏面板展示） */
  function pushStatus() {
    if (!videoEl) return;
    const v = videoEl;
    const payload = {
      hasVideo: true,
      playing: !v.paused && !v.ended,
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime || 0,
      duration: v.duration || 0,
      rate: v.playbackRate || 1,
      title: (document.title || "").slice(0, 80)
    };
    try {
      const p = chrome.runtime.sendMessage({ type: "cxh-status", status: payload });
      if (p && p.catch) p.catch(() => { /* 后台休眠或扩展重载 */ });
    } catch (_) { /* 扩展重载后旧内容脚本会抛错，忽略 */ }
  }

  /** iframe 内视频状态中继给顶层帧（悬浮面板用） */
  function relayStatusToTop() {
    if (isTop() || !videoEl) return;
    if (!videoVisible()) return; // 只上报可见帧的状态
    const v = videoEl;
    try {
      window.top.postMessage(
        {
          type: "CXH_VIDEO_STATUS",
          status: {
            hasVideo: true,
            playing: !v.paused && !v.ended,
            paused: v.paused,
            ended: v.ended,
            currentTime: v.currentTime || 0,
            duration: v.duration || 0,
            rate: v.playbackRate || 1
          }
        },
        "*"
      );
    } catch (_) { /* 忽略 */ }
  }

  // ---------- 启动 ----------

  if (isTop()) {
    window.addEventListener("message", (ev) => {
      if (!ev.data) return;
      if (ev.data.type === "CXH_VIDEO_ENDED") {
        // 只接受当前页面里现存 iframe 的通知，忽略过期帧的消息
        const fromCurrentFrame =
          ev.source === window ||
          Array.from(document.querySelectorAll("iframe")).some((f) => {
            try { return f.contentWindow === ev.source; } catch (_) { return false; }
          });
        if (!fromCurrentFrame) {
          console.info(TAG, "忽略过期帧的结束消息");
          return;
        }
        onVideoCompletedMessage();
      } else if (ev.data.type === "CXH_VIDEO_STATUS" && ev.data.status) {
        updateFloatPanel(ev.data.status);
      }
    });

    // 顶层自身就是视频页时（少见），直接刷新悬浮面板
    setInterval(() => {
      if (!videoEl) return;
      updateFloatPanel({
        hasVideo: true,
        playing: !videoEl.paused && !videoEl.ended,
        paused: videoEl.paused,
        ended: videoEl.ended,
        currentTime: videoEl.currentTime || 0,
        duration: videoEl.duration || 0,
        rate: videoEl.playbackRate || 1
      });
    }, 1000);

    setInterval(scanPrompts, 3000);
  } else {
    // iframe：接收顶层悬浮面板的播放/暂停命令
    window.addEventListener("message", (ev) => {
      if (!ev.data || ev.data.type !== "CXH_VIDEO_CMD") return;
      if (!videoEl) return;
      if (ev.data.command === "pause") {
        manualPaused = true;
        pauseVideo();
      } else if (ev.data.command === "play") {
        if (!videoVisible()) return;
        manualPaused = false;
        playVideo();
      } else if (ev.data.command === "toggle") {
        if (videoVisible() && (videoEl.paused || videoEl.ended)) {
          manualPaused = false;
          playVideo();
        } else {
          manualPaused = true;
          pauseVideo();
        }
      }
    });

    setInterval(scanPrompts, 3000);
    setInterval(relayStatusToTop, 1000);
  }

  // 所有帧：持续监听视频元素、兜底检测完成、上报状态
  setInterval(watchVideos, 2000);
  setInterval(pollCompletion, 2000);
  setInterval(pushStatus, 2000);
  pushStatus();
})();
