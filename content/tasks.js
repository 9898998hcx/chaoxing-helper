/**
 * 学习通课程助手 · 学习通助手面板（v1.5.0，悬浮球折叠 + 可拖拽 + 按序自动完成 + 播放控制 + 倍速 + 章节前后跳转）
 *
 * 运行在学习页（mooc1.chaoxing.com/mycourse/studentstudy*）。
 * 职责：
 *   1. 识别本节所有任务点（视频 / 图文 / 其他），读取完成状态
 *   2. 提供「任务点助手」弹窗，让用户自己选择：
 *        ▶ 播放下一个视频   📄 打开下一个图文   ⚡ 自动完成全部
 *   3. 图文任务点自动滚动阅读（PDF/PPT 阅读器逐段滚动到底）
 *   4. 视频任务点：滚动到该任务点并自动播放（平台要求观看 ≥90%，保持 1x 播放）
 *
 * 页面结构（真实页面实测）：
 *   - 任务点位于 iframe#knowledge/cards 内的 #pageDiv .ans-attach-ct
 *   - 视频任务点：iframe.ans-insertvideo-online（ananas/modules/video）
 *   - 图文任务点：iframe.insertdoc-online-pdf / insertdoc-online-ppt（ananas/modules/pdf）
 *   - 完成状态：.ans-job-icon 的 class（含 finish/done/complete 等视为已完成）
 */

"use strict";

(() => {
  if (window.__CXH_TASKS_INIT__) return;
  if (!/\/mycourse\/studentstudy/.test(location.pathname + location.search)) return;
  window.__CXH_TASKS_INIT__ = true;
  window.__CXH_TASKS_PAGE__ = true; // 告诉 video-player.js：本页使用合并面板

  const TAG = "[学习通助手·任务点]";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let running = false;
  let panelEl = null;

  // ---------- 任务点扫描 ----------

  function getCardsFrame() {
    return [...document.querySelectorAll("iframe")].find((f) => /knowledge\/cards/.test(f.src || ""));
  }

  function getCardsDoc() {
    const frame = getCardsFrame();
    try {
      return frame ? frame.contentDocument : null;
    } catch (e) {
      return null;
    }
  }

  /** 任务点完成状态：平台把 ans-job-finished 加在 .ans-attach-ct 容器上 */
  function taskDone(ct) {
    const cls = (ct.className || "").toString();
    return /ans-job-finished|ans-job-finish/i.test(cls);
  }

  function listTasks() {
    const doc = getCardsDoc();
    if (!doc) return [];
    return [...doc.querySelectorAll(".ans-attach-ct")].map((ct, i) => {
      const iframe = ct.querySelector("iframe");
      const cls = iframe ? (iframe.className || "").toString() : "";
      const src = iframe ? iframe.src || "" : "";
      let type = "other";
      if (/ans-insertvideo-online|modules\/video/.test(cls + " " + src)) type = "video";
      else if (/insertdoc-online|modules\/pdf/.test(cls + " " + src)) type = "doc";
      return { i, ct, iframe, type, done: taskDone(ct) };
    });
  }

  function getVideoOf(task) {
    try {
      const vdoc = task.iframe && task.iframe.contentDocument;
      return vdoc ? vdoc.querySelector("video") : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- 打开任务点 ----------

  /** 打开任务点：用 getBoundingClientRect 计算外层页面滚动位置（offsetTop 部分卡片不可靠） */
  function openTask(task) {
    const frame = getCardsFrame();
    if (!frame) return false;
    let scrolled = false;
    try {
      const fr = frame.getBoundingClientRect();
      const cr = task.ct.getBoundingClientRect();
      const target = Math.max(0, window.scrollY + fr.top + cr.top - 90);
      window.scrollTo({ top: target, behavior: "smooth" });
      scrolled = true;
    } catch (e) {
      scrolled = false;
    }
    if (!scrolled) {
      try {
        task.ct.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) { /* 忽略 */ }
    }
    console.info(TAG, "定位任务点 #" + (task.i + 1));
    return true;
  }

  /** 播放视频任务点：直接点击播放器按钮触发加载与播放（不依赖元数据是否已预加载） */
  async function playTaskVideo(task) {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const v = getVideoOf(task);
      if (v) {
        try {
          const vdoc = task.iframe.contentDocument;
          const player = vdoc.querySelector(".vjs-big-play-button") || vdoc.querySelector(".vjs-play-control.vjs-paused");
          if (player) player.click();
          const p = v.play();
          if (p && p.catch) {
            p.catch(() => {
              // 自动播放策略拦截：先静音播放，再恢复声音
              v.muted = true;
              v.play().catch(() => {});
              setTimeout(() => { v.muted = false; }, 1000);
            });
          }
        } catch (e) { /* 忽略 */ }
        await sleep(1500);
        const v2 = getVideoOf(task);
        if (v2 && !v2.paused) return true;
      }
      await sleep(1000);
    }
    return false;
  }

  // ---------- 图文：递归滚动所有可滚动容器到底 ----------

  function collectScrollables(doc, out = []) {
    try {
      // 文档级滚动容器
      const roots = [doc.scrollingElement, doc.documentElement, doc.body].filter(Boolean);
      for (const el of roots) {
        try { if (el.scrollHeight - el.clientHeight > 80) out.push(el); } catch (e) {}
      }
      // 任意可滚动元素（不强制 overflow 样式，PDF 阅读器可能用 JS 滚动）
      for (const el of doc.querySelectorAll("*")) {
        try {
          if (el.scrollHeight - el.clientHeight > 80 && !roots.includes(el)) out.push(el);
        } catch (e) { /* 单个元素异常忽略 */ }
      }
      // 递归嵌套 iframe（同源才可访问）
      for (const f of doc.querySelectorAll("iframe")) {
        try {
          if (f.contentDocument) collectScrollables(f.contentDocument, out);
        } catch (e) { /* 跨域忽略 */ }
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }

  async function autoScrollDoc(task, steps = 24, delay = 350) {
    let doc = null;
    try {
      doc = task.iframe && task.iframe.contentDocument;
    } catch (e) { /* ignore */ }
    if (!doc) {
      console.info(TAG, "图文 iframe 无法访问");
      return false;
    }
    openTask(task);
    await sleep(800);
    const scrollers = collectScrollables(doc);
    if (scrollers.length === 0) {
      console.info(TAG, "图文内容较短，直接展示即视为阅读");
      return true;
    }
    for (const sc of scrollers) {
      try { sc.scrollTop = 0; } catch (e) { /* ignore */ }
    }
    console.info(TAG, "开始逐段滚动图文（" + scrollers.length + " 个滚动容器）");
    for (let s = 0; s < steps; s++) {
      for (const sc of scrollers) {
        try {
          const max = sc.scrollHeight - sc.clientHeight;
          sc.scrollTop = Math.min(max, Math.round((max * (s + 1)) / steps));
          sc.dispatchEvent(new Event("scroll", { bubbles: true }));
        } catch (e) { /* ignore */ }
      }
      await sleep(delay);
    }
    await sleep(600);
    return true;
  }

  // ---------- 弹窗 UI ----------

  function pendingTasks() {
    return listTasks().filter((t) => !t.done && (t.type === "video" || t.type === "doc"));
  }

  function typeLabel(t) {
    return t.type === "video" ? "视频" : t.type === "doc" ? "图文" : "其他";
  }

  // ---------- 视频控制（合并自悬浮视频控制器） ----------

  let lastVideoStatus = null;
  let lastVideoTs = 0;
  let videoTask = null; // 当前面板锁定的视频任务点（直接控制，避免多视频帧串状态）
  let currentSpeed = 1; // 当前倍速
  let autoNextSection = true; // 完成本节后自动跳转下一节
  let lastAutoJumpAt = 0; // 上次自动跳转时间（防重复触发）

  function getTaskVideo(task) {
    try {
      const d = task.iframe && task.iframe.contentDocument;
      return d ? d.querySelector("video") : null;
    } catch (e) {
      return null;
    }
  }

  function applySpeed(rate) {
    currentSpeed = rate;
    try {
      chrome.storage.local.set({ rate: rate });
    } catch (e) { /* 忽略 */ }
    if (videoTask) {
      const v = getTaskVideo(videoTask);
      if (v) {
        try { v.playbackRate = rate; } catch (e) { /* 忽略 */ }
      }
    }
    updateSpeedButtons();
    if (rate === 1) {
      setAction("倍速已设为 1x");
      return;
    }
    setAction("倍速已设为 " + rate + "x");
    // 学习通对未完成任务点的视频强制 1x：2 秒后校验实际倍速
    setTimeout(() => {
      if (!videoTask) return;
      const v = getTaskVideo(videoTask);
      if (!v) return;
      if (Math.abs(v.playbackRate - rate) > 0.05) {
        setAction("平台限制：该任务点视频完成前不可倍速（已恢复 1x）");
        currentSpeed = 1;
        try { chrome.storage.local.set({ rate: 1 }); } catch (e) { /* 忽略 */ }
        updateSpeedButtons();
      }
    }, 2000);
  }

  function updateSpeedButtons() {
    const btns = document.querySelectorAll("#cxh-tasks-panel [data-rate]");
    if (!btns.length) return;
    btns.forEach((b) => {
      const r = Number(b.dataset.rate);
      b.style.background = r === currentSpeed ? "#4f6bff" : "transparent";
      b.style.borderColor = r === currentSpeed ? "#4f6bff" : "rgba(255,255,255,0.25)";
    });
  }

  function taskVideoStatus(task) {
    const v = getTaskVideo(task);
    if (!v) return null;
    return {
      hasVideo: true,
      playing: !v.paused && !v.ended,
      paused: v.paused,
      ended: v.ended,
      currentTime: v.currentTime || 0,
      duration: v.duration || 0,
      rate: v.playbackRate || 1
    };
  }

  function playPauseTaskVideo(task, action) {
    const v = getTaskVideo(task);
    if (!v) return false;
    try {
      const d = task.iframe.contentDocument;
      if (action === "pause") {
        const c = d.querySelector(".vjs-play-control.vjs-playing");
        if (c) c.click();
        v.pause();
      } else {
        const b = d.querySelector(".vjs-big-play-button") || d.querySelector(".vjs-play-control.vjs-paused");
        if (b) b.click();
        v.play().catch(() => {});
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 给锁定的视频挂事件监听：播放/暂停/进度变化即时同步面板 */
  function bindVideoEvents(task) {
    const v = getTaskVideo(task);
    if (!v || v.__cxhTaskBound) return;
    v.__cxhTaskBound = true;
    const sync = () => {
      if (videoTask !== task) return;
      const s = taskVideoStatus(task);
      if (s) updateVideoSection(s);
    };
    ["play", "playing", "pause", "ended", "seeking", "seeked", "waiting", "ratechange"].forEach((ev) => {
      v.addEventListener(ev, sync);
    });
    v.addEventListener("timeupdate", () => {
      if (videoTask !== task) return;
      const now = Date.now();
      if (now - (v.__cxhLastSync || 0) < 300) return;
      v.__cxhLastSync = now;
      const s = taskVideoStatus(task);
      if (s) updateVideoSection(s);
    });
  }

  /** 自动检测一个可见的视频任务点（优先正在播放的视频） */
  function findActiveVideoTask() {
    let fallback = null;
    for (const t of listTasks()) {
      if (t.type !== "video") continue;
      const v = getTaskVideo(t);
      if (!v || !(v.duration > 0)) continue;
      const r = v.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (!v.paused) return t; // 优先锁定正在播放的视频
      if (!fallback) fallback = t;
    }
    return fallback;
  }

  function relayCommand(cmd) {
    try {
      chrome.runtime.sendMessage({ type: "cxh-forward-command", command: cmd }, () => {
        if (chrome.runtime.lastError) { /* 后台未就绪 */ }
      });
    } catch (e) { /* 扩展重载后忽略 */ }
  }

  function fmtVideoTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function updateVideoSection(status) {
    if (!status || !status.hasVideo) return;
    lastVideoStatus = status;
    lastVideoTs = Date.now();
    const state = document.getElementById("cxh-video-state");
    const fill = document.getElementById("cxh-video-fill");
    const btn = document.getElementById("cxh-video-toggle");
    if (!state || !fill || !btn) return;
    const ratio = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
    fill.style.width = (ratio * 100).toFixed(1) + "%";
    const stateText = status.ended ? "播放完成" : status.playing ? "播放中" : "已暂停";
    state.textContent = "视频：" + stateText + " · " + fmtVideoTime(status.currentTime) + " / " + fmtVideoTime(status.duration);
    btn.textContent = status.playing ? "⏸ 暂停" : "▶ 播放";
  }

  function buildPanel() {
    if (panelEl) return panelEl;
    const panel = document.createElement("div");
    panel.id = "cxh-tasks-panel";
    Object.assign(panel.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "2147483645",
      width: "300px",
      padding: "10px 12px",
      borderRadius: "12px",
      background: "rgba(24,26,38,0.92)",
      color: "#fff",
      font: "12px/1.5 system-ui,'Microsoft YaHei',sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      userSelect: "none"
    });

    const head = document.createElement("div");
    Object.assign(head.style, { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" });
    const title = document.createElement("span");
    title.textContent = "📚 学习通助手";
    Object.assign(title.style, { fontWeight: "600", fontSize: "13px" });
    const headActions = document.createElement("div");
    Object.assign(headActions.style, { display: "flex", alignItems: "center", gap: "10px" });
    const collapseBtn = document.createElement("span");
    collapseBtn.id = "cxh-collapse-btn";
    collapseBtn.textContent = "—";
    collapseBtn.title = "折叠为悬浮球";
    Object.assign(collapseBtn.style, { cursor: "pointer", color: "#9aa0b8", fontSize: "14px", lineHeight: "1" });
    const close = document.createElement("span");
    close.id = "cxh-close-btn";
    close.textContent = "×";
    close.title = "关闭面板";
    Object.assign(close.style, { cursor: "pointer", color: "#9aa0b8", fontSize: "16px", lineHeight: "1" });
    close.addEventListener("click", () => { panel.style.display = "none"; });
    headActions.appendChild(collapseBtn);
    headActions.appendChild(close);
    head.appendChild(title);
    head.appendChild(headActions);

    // ---- 视频控制区（合并自悬浮视频控制器） ----
    const vbox = document.createElement("div");
    Object.assign(vbox.style, {
      marginBottom: "8px",
      paddingBottom: "8px",
      borderBottom: "1px solid rgba(255,255,255,0.10)"
    });
    const vstate = document.createElement("div");
    vstate.id = "cxh-video-state";
    vstate.textContent = "视频：未检测到";
    Object.assign(vstate.style, { color: "#c9cede", marginBottom: "4px" });

    const vbar = document.createElement("div");
    Object.assign(vbar.style, { height: "4px", borderRadius: "999px", background: "rgba(255,255,255,0.15)", marginBottom: "6px", overflow: "hidden" });
    const vfill = document.createElement("div");
    vfill.id = "cxh-video-fill";
    Object.assign(vfill.style, { height: "100%", width: "0%", borderRadius: "999px", background: "#4f6bff", transition: "width .4s" });
    vbar.appendChild(vfill);

    const vbtn = document.createElement("button");
    vbtn.id = "cxh-video-toggle";
    vbtn.textContent = "▶ 播放";
    Object.assign(vbtn.style, {
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
    vbtn.addEventListener("click", () => {
      if (videoTask) {
        bindVideoEvents(videoTask);
        const st = taskVideoStatus(videoTask);
        playPauseTaskVideo(videoTask, st && st.playing ? "pause" : "play");
        // 立即更新 UI（乐观更新），随后事件监听会再校准
        const now = taskVideoStatus(videoTask);
        if (now) updateVideoSection(now);
        setTimeout(() => {
          const s = taskVideoStatus(videoTask);
          if (s) updateVideoSection(s);
        }, 150);
        return;
      }
      const playing = lastVideoStatus && lastVideoStatus.playing;
      relayCommand(playing ? "pause" : "play");
    });
    vbox.appendChild(vstate);
    vbox.appendChild(vbar);
    vbox.appendChild(vbtn);

    // 倍速控制：1x / 1.5x / 2x
    const speedLabel = document.createElement("div");
    speedLabel.textContent = "倍速";
    Object.assign(speedLabel.style, { color: "#8a90a8", fontSize: "11px", marginTop: "6px", marginBottom: "2px" });
    const speedRow = document.createElement("div");
    Object.assign(speedRow.style, { display: "flex", gap: "6px" });
    [1, 1.5, 2].forEach((r) => {
      const b = document.createElement("button");
      b.textContent = r + "x";
      b.dataset.rate = String(r);
      Object.assign(b.style, {
        flex: "1",
        border: "1px solid rgba(255,255,255,0.25)",
        borderRadius: "6px",
        padding: "4px 0",
        cursor: "pointer",
        background: "transparent",
        color: "#fff",
        fontSize: "11px",
        fontWeight: "600"
      });
      b.addEventListener("click", () => applySpeed(r));
      speedRow.appendChild(b);
    });
    vbox.appendChild(speedLabel);
    vbox.appendChild(speedRow);

    // ---- 任务点区 ----
    const status = document.createElement("div");
    status.id = "cxh-tasks-status";
    Object.assign(status.style, { color: "#c9cede", marginBottom: "8px" });

    // 操作反馈行：让每次点击都有可见结果，不再"点了没反应"
    const action = document.createElement("div");
    action.id = "cxh-tasks-action";
    Object.assign(action.style, { color: "#ffd479", fontSize: "11px", marginBottom: "6px", minHeight: "14px" });

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "6px", marginBottom: "6px" });

    const btnVideo = document.createElement("button");
    btnVideo.textContent = "▶ 下一个视频";
    const btnDoc = document.createElement("button");
    btnDoc.textContent = "📄 下一个图文";
    const btnAll = document.createElement("button");
    btnAll.textContent = "⚡ 自动完成全部";
    btnAll.style.width = "100%";
    btnAll.style.marginBottom = "6px";

    const styleBtn = (b, bg) => {
      Object.assign(b.style, {
        flex: "1",
        border: "none",
        borderRadius: "8px",
        padding: "6px 0",
        cursor: "pointer",
        background: bg,
        color: "#fff",
        fontSize: "12px",
        fontWeight: "600"
      });
    };
    styleBtn(btnVideo, "#4f6bff");
    styleBtn(btnDoc, "#2e9e6b");
    styleBtn(btnAll, "#7b3fe4");

    const list = document.createElement("div");
    list.id = "cxh-tasks-list";
    Object.assign(list.style, { maxHeight: "170px", overflowY: "auto", marginBottom: "6px" });

    // 下一章节：自动跳转开关 + 手动按钮（选择权在用户）
    const jumpLabel = document.createElement("label");
    Object.assign(jumpLabel.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      color: "#8a90a8",
      fontSize: "11px",
      marginBottom: "4px",
      cursor: "pointer"
    });
    const autoCheck = document.createElement("input");
    autoCheck.type = "checkbox";
    autoCheck.id = "cxh-auto-next-section";
    autoCheck.checked = autoNextSection;
    autoCheck.style.accentColor = "#4f6bff";
    const autoText = document.createElement("span");
    autoText.textContent = "完成本节后自动跳转下一节";
    jumpLabel.appendChild(autoCheck);
    jumpLabel.appendChild(autoText);
    autoCheck.addEventListener("change", () => {
      autoNextSection = autoCheck.checked;
      try { chrome.storage.local.set({ autoNextSection: autoNextSection }); } catch (e) { /* 忽略 */ }
      setAction(autoNextSection ? "已开启：完成本节后自动跳转" : "已关闭自动跳转");
    });

    const btnNextSection = document.createElement("button");
    btnNextSection.textContent = "⏭ 下一章节";
    const btnPrevSection = document.createElement("button");
    btnPrevSection.textContent = "⏮ 上一章节";
    const navBtnStyle = {
      flex: "1",
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: "8px",
      padding: "6px 0",
      cursor: "pointer",
      background: "transparent",
      color: "#fff",
      fontSize: "12px",
      fontWeight: "600"
    };
    Object.assign(btnNextSection.style, navBtnStyle);
    Object.assign(btnPrevSection.style, navBtnStyle);
    btnNextSection.addEventListener("click", () => { goNextSection(); });
    btnPrevSection.addEventListener("click", () => { goPrevSection(); });

    // 上一节 / 下一节 合并为同一行，选择权交给用户
    const navRow = document.createElement("div");
    Object.assign(navRow.style, { display: "flex", gap: "6px", marginBottom: "6px" });
    navRow.appendChild(btnPrevSection);
    navRow.appendChild(btnNextSection);

    const foot = document.createElement("div");
    foot.textContent = "视频控制 + 任务点：点视频或图文按钮，或点下方任一条目";
    Object.assign(foot.style, { color: "#8a90a8", fontSize: "11px" });

    btnVideo.addEventListener("click", () => { openNextOfType("video"); });
    btnDoc.addEventListener("click", () => { openNextOfType("doc"); });
    btnAll.addEventListener("click", () => { autoCompleteAll(); });

    panel.appendChild(head);
    panel.appendChild(vbox);
    panel.appendChild(status);
    panel.appendChild(action);
    panel.appendChild(btnRow);
    btnRow.appendChild(btnVideo);
    btnRow.appendChild(btnDoc);
    panel.appendChild(btnAll);
    panel.appendChild(jumpLabel);
    panel.appendChild(navRow);
    panel.appendChild(list);
    panel.appendChild(foot);
    document.documentElement.appendChild(panel);
    panelEl = panel;
    updateSpeedButtons();

    // ---------- 面板拖拽移动 ----------
    const PANEL_POS_KEY = "cxhPanelPos";
    const applyPos = (x, y) => {
      const maxX = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = Math.round(Math.min(Math.max(0, x), maxX)) + "px";
      panel.style.top = Math.round(Math.min(Math.max(0, y), maxY)) + "px";
    };
    try {
      const saved = JSON.parse(localStorage.getItem(PANEL_POS_KEY) || "null");
      if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        applyPos(saved.left, saved.top);
      }
    } catch (e) { /* 忽略 */ }

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
      const r = panel.getBoundingClientRect();
      drag = { dx: clientX - r.left, dy: clientY - r.top };
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = Math.round(r.left) + "px";
      panel.style.top = Math.round(r.top) + "px";
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
        localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
      } catch (e) { /* 忽略 */ }
    };
    const startDragMouse = (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest("#cxh-close-btn, #cxh-collapse-btn")) return;
      beginDrag(e.clientX, e.clientY);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", endDrag, true);
      e.preventDefault();
    };
    const startDragTouch = (e) => {
      if (e.target && e.target.closest && e.target.closest("#cxh-close-btn, #cxh-collapse-btn")) return;
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
        localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
      } catch (e) { /* 忽略 */ }
    };
    head.style.cursor = "move";
    head.addEventListener("mousedown", startDragMouse);
    head.addEventListener("touchstart", startDragTouch, { passive: false });
    head.addEventListener("touchmove", onTouchMove, { passive: false });
    head.addEventListener("touchend", onTouchEnd);
    window.addEventListener("resize", () => {
      if (panel.style.left && panel.style.left !== "auto") {
        applyPos(panel.offsetLeft, panel.offsetTop);
      }
    });

    // ---------- 悬浮球：折叠 / 展开 ----------
    const BALL_POS_KEY = "cxhBallPos";
    const COLLAPSE_KEY = "cxhPanelCollapsed";
    let ball = null;

    const ensureBall = () => {
      if (ball) return ball;
      ball = document.createElement("div");
      ball.id = "cxh-float-ball";
      Object.assign(ball.style, {
        position: "fixed",
        right: "24px",
        bottom: "24px",
        width: "52px",
        height: "52px",
        borderRadius: "50%",
        background: "rgba(24,26,38,0.92)",
        border: "2px solid rgba(79,107,255,0.7)",
        boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: "2147483645",
        fontSize: "22px",
        userSelect: "none"
      });
      ball.textContent = "📚";
      ball.title = "展开学习通助手";
      document.documentElement.appendChild(ball);

      // 球也支持拖动（拖动不展开，点击才展开）
      let bDrag = null;
      let bMoved = false;
      let bOverlay = null;
      const applyBallPos = (x, y) => {
        const maxX = Math.max(0, window.innerWidth - ball.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - ball.offsetHeight);
        ball.style.left = Math.round(Math.min(Math.max(0, x), maxX)) + "px";
        ball.style.top = Math.round(Math.min(Math.max(0, y), maxY)) + "px";
      };
      try {
        const saved = JSON.parse(localStorage.getItem(BALL_POS_KEY) || "null");
        if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
          ball.style.right = "auto";
          ball.style.bottom = "auto";
          applyBallPos(saved.left, saved.top);
        }
      } catch (e) { /* 忽略 */ }
      const ensureBallOverlay = () => {
        if (bOverlay) return;
        bOverlay = document.createElement("div");
        Object.assign(bOverlay.style, {
          position: "fixed",
          inset: "0",
          zIndex: "2147483646",
          cursor: "move",
          background: "transparent"
        });
        document.documentElement.appendChild(bOverlay);
      };
      const removeBallOverlay = () => {
        if (bOverlay) {
          bOverlay.remove();
          bOverlay = null;
        }
      };
      const onBallMove = (e) => {
        if (!bDrag) return;
        if (Math.abs(e.clientX - bDrag.sx) + Math.abs(e.clientY - bDrag.sy) > 5) bMoved = true;
        applyBallPos(e.clientX - bDrag.dx, e.clientY - bDrag.dy);
      };
      const onBallUp = () => {
        if (!bDrag) return;
        bDrag = null;
        removeBallOverlay();
        document.removeEventListener("mousemove", onBallMove, true);
        document.removeEventListener("mouseup", onBallUp, true);
        try {
          localStorage.setItem(BALL_POS_KEY, JSON.stringify({ left: ball.offsetLeft, top: ball.offsetTop }));
        } catch (e) { /* 忽略 */ }
        if (!bMoved) expandPanel();
      };
      ball.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const r = ball.getBoundingClientRect();
        bDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY };
        bMoved = false;
        ball.style.right = "auto";
        ball.style.bottom = "auto";
        ball.style.left = Math.round(r.left) + "px";
        ball.style.top = Math.round(r.top) + "px";
        ensureBallOverlay();
        document.addEventListener("mousemove", onBallMove, true);
        document.addEventListener("mouseup", onBallUp, true);
        e.preventDefault();
      });
      return ball;
    };

    const collapsePanel = () => {
      panel.style.display = "none";
      ensureBall().style.display = "flex";
      try { localStorage.setItem(COLLAPSE_KEY, "1"); } catch (e) { /* 忽略 */ }
    };
    const expandPanel = () => {
      if (ball) ball.style.display = "none";
      panel.style.display = "block";
      try { localStorage.setItem(COLLAPSE_KEY, "0"); } catch (e) { /* 忽略 */ }
    };
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      collapsePanel();
    });
    // 记住折叠状态
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") collapsePanel();
    } catch (e) { /* 忽略 */ }

    return panel;
  }

  function render() {
    buildPanel();
    const tasks = listTasks();
    const pendingAll = tasks.filter((t) => !t.done);
    const pendingVideos = pendingAll.filter((t) => t.type === "video").length;
    const pendingDocs = pendingAll.filter((t) => t.type === "doc").length;
    const pendingOthers = pendingAll.length - pendingVideos - pendingDocs;
    const status = document.getElementById("cxh-tasks-status");
    status.textContent =
      "共 " + tasks.length + " 个任务点 · 待完成 " + pendingAll.length +
      "（视频 " + pendingVideos + " · 图文 " + pendingDocs + (pendingOthers > 0 ? " · 其他 " + pendingOthers : "") + "）";

    const list = document.getElementById("cxh-tasks-list");
    list.innerHTML = "";
    tasks.forEach((t, idx) => {
      if (t.type === "other") return;
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 6px",
        marginBottom: "3px",
        borderRadius: "6px",
        background: t.done ? "rgba(46,158,107,0.15)" : "rgba(255,255,255,0.06)",
        cursor: t.done ? "default" : "pointer"
      });
      const left = document.createElement("span");
      left.textContent = (t.done ? "✅ " : t.type === "video" ? "▶ " : "📄 ") +
        (idx + 1) + ". " + typeLabel(t);
      const right = document.createElement("span");
      right.textContent = t.done ? "已完成" : "打开";
      Object.assign(right.style, { color: t.done ? "#3ecf8e" : "#7b9bff", fontWeight: "600" });
      row.appendChild(left);
      row.appendChild(right);
      if (!t.done) {
        row.addEventListener("click", () => {
          if (running) return;
          openTask(t);
          if (t.type === "video") {
            videoTask = t;
            bindVideoEvents(t);
            playTaskVideo(t);
          } else {
            autoScrollDoc(t);
          }
        });
      }
      list.appendChild(row);
    });
  }

  // ---------- 选择动作 ----------

  function setAction(text) {
    const el = document.getElementById("cxh-tasks-action");
    if (el) el.textContent = text || "";
    if (text) console.info(TAG, text);
  }

  function openNextOfType(type) {
    if (running) {
      setAction("正在自动完成中，请稍候…");
      return;
    }
    if (!getCardsDoc()) {
      setAction("未找到任务点容器，请刷新页面后重试");
      return;
    }
    const pending = listTasks().filter((t) => !t.done && t.type === type);
    if (pending.length === 0) {
      setAction(type === "video" ? "没有待完成的视频任务点（全部已完成）" : "没有待完成的图文任务点（全部已完成）");
      return;
    }
    const task = pending[0];
    openTask(task);
    if (type === "video") {
      videoTask = task; // 面板锁定该视频
      bindVideoEvents(task);
      playTaskVideo(task).then((ok) => {
        setAction(ok ? "▶ 正在播放第 " + (task.i + 1) + " 个任务点（视频）" : "视频尚未就绪，请再点一次试试");
      });
      setAction("▶ 正在打开第 " + (task.i + 1) + " 个任务点（视频）…");
    } else {
      autoScrollDoc(task);
      setAction("📄 正在打开第 " + (task.i + 1) + " 个任务点（图文），自动滚动阅读中…");
    }
    render();
  }

  // ---------- 章节跳转 ----------

  /** 目录中当前节的下一个章节名（学习页左侧目录，最可靠的跳转入口） */
  function findNextCatalogName() {
    const names = [...document.querySelectorAll(".posCatalog_name")];
    if (names.length === 0) return null;
    const active = names.find((n) => n.closest(".posCatalog_select.posCatalog_active"));
    if (!active) return null;
    const idx = names.indexOf(active);
    if (idx >= 0 && idx + 1 < names.length) return names[idx + 1];
    return null;
  }

  /** 兜底：找学习页头部的「下一节」按钮 */
  function findSectionNav() {
    const panel = document.getElementById("cxh-tasks-panel");
    const nodes = [...document.querySelectorAll("a, button, div[role=button], span, div")];
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t !== "下一节" && t !== "下一章") continue;
      if (panel && panel.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // 可见性用 rect 判断（fixed 元素 offsetParent 为 null）
      return el.closest("a, button, [onclick], [role=button]") || el;
    }
    return null;
  }

  /** 目录中当前节的上一个章节名 */
  function findPrevCatalogName() {
    const names = [...document.querySelectorAll(".posCatalog_name")];
    if (names.length === 0) return null;
    const active = names.find((n) => n.closest(".posCatalog_select.posCatalog_active"));
    if (!active) return null;
    const idx = names.indexOf(active);
    if (idx > 0) return names[idx - 1];
    return null;
  }

  /** 回退到上一节（选择权在用户） */
  function goPrevSection() {
    const prevName = findPrevCatalogName();
    if (prevName) {
      lastAutoJumpAt = Date.now(); // 手动导航后暂停自动跳转 30 秒，避免刚回退又被自动带回去
      try { sessionStorage.setItem("cxhNoAutoJumpUntil", String(Date.now() + 60000)); } catch (e) { /* 忽略 */ }
      setAction("⏮ 正在返回上一节…");
      try {
        prevName.click();
        prevName.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (e) { /* 忽略 */ }
      return true;
    }
    setAction("已经是第一节，没有上一节了");
    return false;
  }

  /** 跳转到下一节（手动按钮与自动跳转共用） */
  function goNextSection() {
    lastAutoJumpAt = Date.now();
    // 优先：目录中当前节的下一个章节名
    const nextName = findNextCatalogName();
    if (nextName) {
      setAction("⏭ 正在跳转到下一节…");
      try {
        nextName.click();
        nextName.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (e) { /* 忽略 */ }
      return true;
    }
    // 兜底：头部「下一节」按钮
    const el = findSectionNav();
    if (el) {
      setAction("⏭ 正在跳转到下一节…");
      try { el.click(); } catch (e) { /* 忽略 */ }
      return true;
    }
    setAction("未找到下一节入口，请手动切换");
    return false;
  }

  async function autoCompleteAll() {
    if (running) return;
    running = true;
    setAction("⚡ 自动完成开始…");
    try {
      let guard = 0;
      while (guard++ < 50) {
        const pending = pendingTasks();
        if (pending.length === 0) {
          setAction("✅ 本节任务点已全部完成");
          break;
        }
        const task = pending[0];
        setAction("⚡ 正在处理第 " + (task.i + 1) + " 个任务点（" + typeLabel(task) + "）");
        render();
        openTask(task);
        if (task.type === "video") {
          videoTask = task;
          bindVideoEvents(task);
          await playTaskVideo(task);
          await waitVideoDone(task);
        } else {
          await autoScrollDoc(task);
          await waitIconDone(task, 15000);
        }
        render();
      }
    } finally {
      running = false;
      render();
    }
  }

  async function waitVideoDone(task) {
    const start = Date.now();
    const hardLimit = 30 * 60 * 1000;
    let lastCur = -1;
    let stalls = 0;
    while (Date.now() - start < hardLimit) {
      if (!running) return;
      const gone = !task.ct.isConnected;
      if (gone) return;
      const done = taskDone(task.ct);
      const v = getVideoOf(task);
      let progress = 0;
      if (v && v.duration > 5) progress = v.currentTime / v.duration;
      if (done || progress >= 0.92) return;
      // 约 60 秒无任何进度（视频未加载/始终暂停）则跳过，避免队列卡死
      const cur = v ? v.currentTime : -1;
      if (cur === lastCur) {
        stalls++;
      } else {
        stalls = 0;
        lastCur = cur;
      }
      if (stalls >= 20) return;
      await sleep(3000);
    }
  }

  async function waitIconDone(task, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!running) return;
      if (taskDone(task.ct)) return;
      await sleep(1500);
    }
  }

  // ---------- 启动 ----------

  // 等待 cards iframe 出现后渲染面板；随后定时刷新（任务点为异步渲染）
  let tries = 0;
  const waitTimer = setInterval(() => {
    tries++;
    if (getCardsDoc()) {
      clearInterval(waitTimer);
      buildPanel();
      render();
      setInterval(render, 3000);
      console.info(TAG, "任务点面板已加载");
    } else if (tries > 60) {
      clearInterval(waitTimer);
    }
  }, 1000);

  // 视频状态中继：来自 video-player.js 在各视频帧里的 postMessage
  window.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "CXH_VIDEO_STATUS" && ev.data.status) {
      if (videoTask) return; // 已锁定任务点视频时，显示以直接轮询为准，避免被其他视频帧覆盖
      updateVideoSection(ev.data.status);
    }
  });
  setInterval(() => {
    const state = document.getElementById("cxh-video-state");
    if (!state) return;
    updateSpeedButtons();
    // 锁定任务点的视频状态（事件驱动为主，这里兜底并处理换帧）
    if (videoTask) {
      bindVideoEvents(videoTask);
      const v = getTaskVideo(videoTask);
      if (!v) {
        videoTask = null;
      } else {
        const s = taskVideoStatus(videoTask);
        if (s) {
          updateVideoSection(s);
          return;
        }
      }
    }
    // 未锁定时自动检测一个可见视频（不依赖面板操作也能同步播放状态）
    if (!videoTask) {
      const auto = findActiveVideoTask();
      if (auto) {
        videoTask = auto;
        bindVideoEvents(auto);
        const s = taskVideoStatus(auto);
        if (s) updateVideoSection(s);
        return;
      }
    }
    if (Date.now() - lastVideoTs > 10000) {
      state.textContent = "视频：未检测到";
      const btn = document.getElementById("cxh-video-toggle");
      if (btn) btn.textContent = "▶ 播放";
    }
  }, 1000);

  // 读取已保存的倍速
  try {
    chrome.storage.local.get({ rate: 1 }, (cfg) => {
      currentSpeed = Number(cfg.rate) || 1;
      updateSpeedButtons();
    });
  } catch (e) { /* 忽略 */ }

  // 读取自动跳转开关
  try {
    chrome.storage.local.get({ autoNextSection: true }, (cfg) => {
      autoNextSection = !!cfg.autoNextSection;
      const cb = document.getElementById("cxh-auto-next-section");
      if (cb) cb.checked = autoNextSection;
    });
  } catch (e) { /* 忽略 */ }

  // 完成本节任务点后自动跳转下一节
  setInterval(() => {
    if (!autoNextSection) return;
    if (running) return;
    if (Date.now() - lastAutoJumpAt < 30000) return;
    // 用户手动回退后 60 秒内不自动跳转（sessionStorage 可跨页面刷新保持）
    let noJumpUntil = 0;
    try { noJumpUntil = Number(sessionStorage.getItem("cxhNoAutoJumpUntil") || 0); } catch (e) { /* 忽略 */ }
    if (Date.now() < noJumpUntil) return;
    const tasks = listTasks();
    if (tasks.length === 0) return;
    const pendingAll = tasks.filter((t) => !t.done);
    if (pendingAll.length === 0) {
      lastAutoJumpAt = Date.now();
      setAction("✅ 本节任务点已完成，自动跳转下一节…");
      goNextSection();
    }
  }, 5000);

  // 章节切换检测：进入章节（含上一/下一章节）后自动按顺序完成未完成任务点
  let lastSectionKey = "";
  let autoRunStarted = false;
  setInterval(() => {
    const doc = getCardsDoc();
    if (!doc) return;
    // 用任务点 jobid 作为章节指纹（SPA 切换时 iframe src 可能不变）
    const jobids = [...doc.querySelectorAll(".ans-attach-ct iframe")]
      .map((f) => f.getAttribute("jobid") || "")
      .join(",");
    const key = jobids || "";
    if (!key || key === lastSectionKey) return;
    lastSectionKey = key;
    videoTask = null;
    autoRunStarted = false;
    lastAutoJumpAt = 0;
    setAction("📍 已进入新章节，检测任务点…");
    let attempts = 0;
    const tryAutoRun = () => {
      attempts++;
      if (autoRunStarted || running) return;
      const tasks = listTasks();
      if (tasks.length === 0 && attempts < 6) {
        setTimeout(tryAutoRun, 2000);
        return;
      }
      if (tasks.length > 0 && tasks.some((t) => !t.done)) {
        autoRunStarted = true;
        setAction("⚡ 检测到未完成任务点，按顺序自动完成…");
        autoCompleteAll();
      }
    };
    setTimeout(tryAutoRun, 3500);
  }, 2000);
})();
