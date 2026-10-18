/**
 * 学习通课程助手 · DeepSeek 刷题助手（v1.5.1）
 *
 * 在作业 / 测验 / 考试页面（/work/、/exam/ 等 URL）注入浮动面板：
 *   1. 扫描页面题目卡片（单选 / 多选 / 判断 / 填空 / 简答）
 *   2. 逐题调用后台代理的 DeepSeek API 获取答案
 *   3. 自动点选选项 / 填入文本（兼容 React 受控输入与富文本编辑器）
 *   4. 可选：全部答完后自动提交（默认关闭，提交前需确认）
 *
 * 只注入答题页；其余页面不创建任何 UI。
 */

"use strict";

(() => {
  if (window.__CXH_ANSWER_INIT__) return;

  const QUIZ_RE = /(\/work\/|doHomeWorkNew|handleHomeWork|reVersionPaper|exam-ans|\/exam\/|examTask|testPaper|homework)/i;
  if (!QUIZ_RE.test(location.href)) return;

  window.__CXH_ANSWER_INIT__ = true;

  const TAG = "[学习通助手·答题]";
  const settings = { autoAnswer: false, autoSubmit: false };
  let running = false;

  // ---------- 工具 ----------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setStatus(text) {
    const el = document.getElementById("cxh-status");
    if (el) el.textContent = text;
  }

  let logCount = 0;
  function log(text) {
    const box = document.getElementById("cxh-log");
    if (!box) return;
    const line = document.createElement("div");
    line.textContent = text;
    box.appendChild(line);
    logCount++;
    while (logCount > 8) {
      box.removeChild(box.firstChild);
      logCount--;
    }
    box.scrollTop = box.scrollHeight;
    console.info(TAG, text);
  }

  // ---------- 题目解析 ----------

  function getCards() {
    const selectors = [
      ".questionLi",
      ".TiMu",
      "[class*='questionLi']",
      "[class*='question-item']",
      "[class*='questionItem']"
    ];
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    return [];
  }

  function detectType(text) {
    const t = (text || "").slice(0, 300);
    if (/多选|多项选择/.test(t)) return "multiple";
    if (/单选|单项选择/.test(t)) return "single";
    if (/判断/.test(t)) return "judgment";
    if (/填空/.test(t)) return "fill";
    if (/简答|论述|名词解释|计算|分析|案例/.test(t)) return "essay";
    return null;
  }

  function extractOptions(card) {
    const options = [];
    const lis = card.querySelectorAll("ul li");
    for (const li of lis) {
      const letterEl = li.querySelector("i, .before, .fl");
      const textEl = li.querySelector(".after, a, span") || li;
      const text = (textEl.textContent || "").trim();
      if (!text) continue;
      let letter = "";
      if (letterEl) {
        letter = (letterEl.textContent || "").trim().replace(/[^A-Ha-h]/g, "").toUpperCase().slice(0, 1);
      }
      if (!letter) {
        const m = text.match(/^([A-Ha-h])[.、．\s]/);
        if (m) letter = m[1].toUpperCase();
      }
      options.push({ li, letter: letter || "?", text });
    }
    return options;
  }

  function parseCard(card) {
    const cardText = (card.textContent || "").trim();
    const type = detectType(cardText);
    if (!type) return null;

    const titleEl = card.querySelector("h3, .mark_title, .Zy_TItle") || card;
    let titleText = (titleEl.textContent || "").trim();
    if (!titleText) titleText = cardText.slice(0, 500);
    if (titleText.length > 600) titleText = titleText.slice(0, 600) + "…";

    const options =
      type === "single" || type === "multiple" || type === "judgment"
        ? extractOptions(card)
        : [];

    const inputs =
      type === "fill" || type === "essay"
        ? Array.from(
            card.querySelectorAll(
              "input:not([type=radio]):not([type=checkbox]):not([type=submit]):not([type=hidden]), textarea"
            )
          )
        : [];

    return { card, type, titleText, options, inputs };
  }

  // ---------- 提示词 ----------

  const TYPE_LABEL = {
    single: "单选题",
    multiple: "多选题",
    judgment: "判断题",
    fill: "填空题",
    essay: "简答题"
  };

  function buildPrompt(q) {
    let p = "题型：" + TYPE_LABEL[q.type] + "\n题目：" + q.titleText + "\n";
    if (q.options.length > 0) {
      p += "选项：\n" + q.options.map((o) => o.letter + ". " + o.text).join("\n") + "\n";
    }
    switch (q.type) {
      case "single":
        p += "要求：只输出一个正确选项的字母，如：A";
        break;
      case "multiple":
        p += "要求：只输出正确选项的字母，按字母顺序排列，如：ABD";
        break;
      case "judgment":
        p += "要求：只输出“对”或“错”。";
        break;
      case "fill":
        p += "要求：按空的数量依次给出每个空的答案，用中文分号“；”分隔，不要输出其他内容。";
        break;
      case "essay":
        p += "要求：用不超过 150 字的中文直接作答，不要客套。";
        break;
    }
    return p;
  }

  function askQuestion(q) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "deepseek-ask",
          messages: [
            {
              role: "system",
              content: "你是课程作业答题助手。只输出答案本身：不要解释、不要客套、不要重复题目。"
            },
            { role: "user", content: buildPrompt(q) }
          ]
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(resp || { ok: false, error: "无响应" });
          }
        }
      );
    });
  }

  // ---------- 答案应用 ----------

  function clickOption(opt) {
    const clickable = opt.li.querySelector(".after, a") || opt.li;
    clickable.click();
  }

  function pickByLetters(q, content) {
    const letters = content.match(/[A-H]/g) || [];
    if (letters.length === 0) return [];
    const picked = [];
    for (const l of letters) {
      const opt = q.options.find((o) => o.letter === l);
      if (opt && !picked.includes(opt)) picked.push(opt);
    }
    if (q.type === "single" && picked.length > 1) picked.length = 1;
    return picked;
  }

  function pickJudgment(q, content) {
    const c = content.trim();
    let wantTrue = null;
    if (/^(对|正确|是|√|true|t)(的)?[。.!！]?$/i.test(c)) wantTrue = true;
    else if (/^(错|错误|否|×|false|f)(的)?[。.!！]?$/i.test(c)) wantTrue = false;
    else if (/对|正确|√/.test(c) && !/错/.test(c)) wantTrue = true;
    else if (/错|×/.test(c)) wantTrue = false;

    if (wantTrue === null) return [];
    if (wantTrue) {
      const opt = q.options.find((o) => /正确|对|是|√/.test(o.text) && !/不|错/.test(o.text));
      return opt ? [opt] : [];
    }
    const opt = q.options.find((o) => /错误|错|否|×/.test(o.text));
    return opt ? [opt] : [];
  }

  function pickByText(q, content) {
    const norm = (s) => s.replace(/\s+/g, "").toUpperCase().replace(/[。.!！,，]/g, "");
    const target = norm(content);
    if (!target) return [];
    for (const o of q.options) {
      const t = norm(o.text);
      if (t === target || t.includes(target) || target.includes(t)) return [o];
    }
    return [];
  }

  function setInputValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setRichText(card, content) {
    const html = escapeHtml(content).replace(/\n/g, "<br>");
    const iframe = card.querySelector("iframe");
    if (iframe) {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          doc.body.innerHTML = "<p>" + html + "</p>";
          doc.body.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch (_) { /* 跨域 iframe，跳过 */ }
    }
    const editable = card.querySelector("[contenteditable='true']");
    if (editable) {
      editable.innerHTML = html;
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    return false;
  }

  function applyAnswer(q, content) {
    if (q.type === "single" || q.type === "multiple" || q.type === "judgment") {
      let picked = [];
      if (q.type === "judgment") {
        picked = pickJudgment(q, content);
      } else {
        picked = pickByLetters(q, content);
        if (picked.length === 0) picked = pickByText(q, content);
      }
      if (picked.length === 0) return false;
      for (const opt of picked) clickOption(opt);
      return true;
    }

    if (q.type === "fill") {
      const parts = content.split(/[；;\n]/).map((s) => s.trim()).filter(Boolean);
      const inputs = q.inputs.filter(visible);
      if (inputs.length === 0) return false;
      inputs.forEach((el, i) => {
        setInputValue(el, parts[i] || parts[parts.length - 1] || "");
      });
      return true;
    }

    if (q.type === "essay") {
      const inputs = q.inputs.filter(visible);
      if (inputs.length > 0) {
        setInputValue(inputs[0], content);
        return true;
      }
      return setRichText(q.card, content);
    }

    return false;
  }

  function markCard(card, state) {
    card.style.outline = state === "done" ? "2px solid #3ecf8e" : "2px solid #f5a623";
    card.style.outlineOffset = "2px";
  }

  // ---------- 提交流程 ----------

  function findSubmitButton() {
    const texts = ["提交", "交卷", "提交作业", "保存并提交"];
    const nodes = document.querySelectorAll("a, button, div[role=button]");
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (texts.includes(t) && visible(el)) return el;
    }
    return document.querySelector("#tempsave, .submitBtn, [onclick*='submit']");
  }

  async function submitPaper() {
    if (!settings.autoSubmit) return;
    if (!window.confirm("已答完 " + answeredCount + " 题，确认提交吗？")) return;
    const btn = findSubmitButton();
    if (!btn) {
      log("未找到提交按钮，请手动提交");
      return;
    }
    btn.click();
    await sleep(1200);
    const confirmTexts = ["确定", "确认", "提交"];
    const nodes = document.querySelectorAll("button, a, div[role=button]");
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (confirmTexts.includes(t) && visible(el)) {
        el.click();
        break;
      }
    }
    log("已点击提交，请留意结果");
  }

  // ---------- 主流程 ----------

  let answeredCount = 0;
  let totalCount = 0;

  /** 开始刷题前检查 DeepSeek API Key，未配置则提示用户 */
  async function startAnswering() {
    if (running) return;
    let apiKey = "";
    try {
      apiKey = await new Promise((resolve) => {
        chrome.storage.local.get({ apiKey: "" }, (cfg) => resolve((cfg && cfg.apiKey) || ""));
      });
    } catch (e) {
      apiKey = "";
    }
    if (!apiKey) {
      setStatus("⚠️ 请先在扩展图标弹窗中配置 DeepSeek API Key");
      log("未配置 DeepSeek API Key，无法刷题");
      return;
    }
    runAll();
  }

  async function runAll() {
    if (running) return;
    const cards = getCards();
    if (cards.length === 0) {
      setStatus("未找到题目（请确认在作业/测验页面）");
      return;
    }
    running = true;
    answeredCount = 0;
    totalCount = cards.length;
    updateButtons();
    setStatus("共 " + totalCount + " 题，开始作答…");

    for (const card of cards) {
      if (!running) break;
      try {
        const q = parseCard(card);
        if (!q || !q.type) {
          log("跳过：无法识别的题型");
          continue;
        }
        const res = await askQuestion(q);
        if (!running) break;
        if (!res.ok) {
          log("❌ " + res.error);
          continue;
        }
        const ok = applyAnswer(q, res.content);
        if (ok) {
          answeredCount++;
          markCard(card, "done");
          log("✅ " + TYPE_LABEL[q.type] + " 已作答");
        } else {
          markCard(card, "warn");
          log("⚠️ 答案应用失败（" + TYPE_LABEL[q.type] + "）");
        }
      } catch (e) {
        log("异常：" + (e && e.message ? e.message : String(e)));
      }
      updateButtons();
      setStatus("正在刷题 " + answeredCount + "/" + totalCount + " …");
      await sleep(1200 + Math.random() * 1400);
    }

    running = false;
    updateButtons();
    setStatus("完成：已答 " + answeredCount + "/" + totalCount + "，请核对后手动提交");
    if (settings.autoSubmit && answeredCount === totalCount && totalCount > 0) {
      await submitPaper();
    }
  }

  function updateButtons() {
    const runBtn = document.getElementById("cxh-run");
    const stopBtn = document.getElementById("cxh-stop");
    if (runBtn) runBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
  }

  // ---------- 面板 ----------

  function buildPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #cxh-panel{position:fixed;right:20px;bottom:20px;width:300px;z-index:2147483646;
        background:#1b1e2b;color:#e8eaf2;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;
        border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);padding:12px;border:1px solid #2e3348}
      #cxh-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      #cxh-panel-head span{font-weight:600;font-size:14px}
      #cxh-close{background:none;border:none;color:#9aa0b8;font-size:18px;cursor:pointer;padding:0 4px}
      #cxh-status{color:#9aa0b8;margin-bottom:8px}
      #cxh-btns{display:flex;gap:8px;margin-bottom:8px}
      #cxh-run,#cxh-stop{flex:1;border:none;border-radius:8px;padding:7px 0;cursor:pointer;font-size:13px}
      #cxh-run{background:#4f6bff;color:#fff}
      #cxh-run:disabled{background:#333a55;color:#666f8f;cursor:default}
      #cxh-stop{background:#2e3348;color:#e8eaf2}
      #cxh-stop:disabled{color:#666f8f;cursor:default}
      #cxh-auto-label{display:flex;align-items:center;gap:6px;color:#9aa0b8;margin-bottom:8px;cursor:pointer}
      #cxh-log{max-height:120px;overflow-y:auto;background:#14161f;border-radius:8px;padding:8px;
        color:#a8d5b7;font-size:12px;margin-bottom:8px;display:none}
      #cxh-log:not(:empty){display:block}
      #cxh-foot{color:#666f8f;font-size:11px}
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "cxh-panel";
    panel.innerHTML = `
      <div id="cxh-panel-head">
        <span>📝 刷题助手 · DeepSeek</span>
        <button id="cxh-close" title="关闭">×</button>
      </div>
      <div id="cxh-status">点击「⚡ 自动刷题」扫描本页题目（DeepSeek 辅助作答）</div>
      <div id="cxh-btns">
        <button id="cxh-run">⚡ 自动刷题</button>
        <button id="cxh-stop" disabled>⏹ 停止</button>
      </div>
      <label id="cxh-auto-label"><input type="checkbox" id="cxh-auto"> 自动提交（谨慎）</label>
      <div id="cxh-log"></div>
      <div id="cxh-foot">由 DeepSeek 辅助作答 · 请自行核对</div>
    `;
    document.documentElement.appendChild(panel);

    document.getElementById("cxh-close").addEventListener("click", () => panel.remove());
    document.getElementById("cxh-run").addEventListener("click", () => startAnswering());
    document.getElementById("cxh-stop").addEventListener("click", () => {
      running = false;
      updateButtons();
      setStatus("已停止");
    });
    const autoBox = document.getElementById("cxh-auto");
    autoBox.checked = !!settings.autoSubmit;
    autoBox.addEventListener("change", () => {
      settings.autoSubmit = autoBox.checked;
      chrome.storage.local.set({ autoSubmit: autoBox.checked });
    });
  }

  // ---------- 启动 ----------

  chrome.storage.local.get({ autoAnswer: false, autoSubmit: false }, (cfg) => {
    Object.assign(settings, cfg);
    buildPanel();
    const autoBox = document.getElementById("cxh-auto");
    if (autoBox) autoBox.checked = !!settings.autoSubmit;
    if (settings.autoAnswer) {
      setTimeout(() => autoRunWithRetry(5), 1500);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes)) {
      if (key in settings) settings[key] = changes[key].newValue;
    }
    const autoBox = document.getElementById("cxh-auto");
    if (autoBox && !running) autoBox.checked = !!settings.autoSubmit;
  });

  async function autoRunWithRetry(n) {
    const cards = getCards();
    if (cards.length === 0 && n > 0) {
      setTimeout(() => autoRunWithRetry(n - 1), 2000);
      return;
    }
    startAnswering();
  }
})();
