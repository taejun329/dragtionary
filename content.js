// 콘텐츠 스크립트: 드래그 감지 → 번역 말풍선 → 단어장 체크

(() => {
  const MAX_LEN = 300;
  let host = null;
  let root = null;
  let currentText = "";
  let requestId = 0;

  // 화면 언어: 설정의 "언어"를 따르고, 설정이 바뀌면 바로 반영합니다.
  let lang = "ko";
  const T = (key, ...args) => self.DTI18N.t(lang, key, ...args);
  try {
    chrome.storage.local.get(["settings"], ({ settings = {} }) => {
      lang = settings.target || "ko";
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) lang = (changes.settings.newValue || {}).target || "ko";
    });
  } catch (e) {}

  const IN_VIEWER = location.protocol === "chrome-extension:";

  // 단어장에 남길 출처 주소: 뷰어 안에서는 ?file= 로 받은 원본 PDF 주소
  function sourceUrl() {
    if (!IN_VIEWER) return location.href;
    return new URLSearchParams(location.search).get("file") || "";
  }

  // 크롬 내장 PDF 뷰어에서는 글자를 읽을 수 없으므로, 확장의 PDF 뷰어로 넘어가는 길만 제공합니다.
  function setupPdfPage() {
    const pdfUrl = location.href.split("#")[0];
    const open = () => {
      try { chrome.runtime.sendMessage({ type: "openPdf", url: pdfUrl }); } catch (e) {}
    };
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "isPdf") sendResponse({ pdf: true, url: pdfUrl });
    });

    const btn = document.createElement("button");
    btn.textContent = T("pdf_open_btn");
    chrome.storage.local.get(["settings"], ({ settings = {} }) => {
      btn.textContent = self.DTI18N.t(settings.target || "ko", "pdf_open_btn");
    });
    btn.style.cssText =
      "position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:10px 16px;border:0;border-radius:20px;" +
      "background:#0969da;color:#fff;font:600 14px -apple-system,'Segoe UI','Malgun Gothic',sans-serif;" +
      "cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35);";
    btn.addEventListener("click", open);
    (document.body || document.documentElement).appendChild(btn);

    // 설정에서 켠 경우 자동으로 전환 (원본 보기로 돌아온 경우와 뒤로 가기는 제외)
    if (location.hash.includes("dt-original")) return;
    chrome.storage.local.get(["settings"], ({ settings = {} }) => {
      if (!settings.pdfAuto) return;
      const key = "dtRedirected:" + pdfUrl;
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch (e) {}
      open();
    });
  }

  if (!IN_VIEWER && document.contentType === "application/pdf") {
    setupPdfPage();
    return;
  }

  // 요소의 글자를 한 줄로 정리. PDF 뷰어에서는 한 줄씩 쪼개져 있으므로 페이지 전체 글자를 씁니다.
  function blockText(node) {
    const e = node && (node.nodeType === 1 ? node : node.parentElement);
    const layer = e && e.closest && e.closest(".textLayer");
    const raw = layer ? layer.innerText : (e && e.textContent) || "";
    return raw.replace(/\s+/g, " ").trim();
  }

  const STYLE = `
    :host { all: initial; }
    .bubble {
      position: absolute; max-width: 400px; min-width: 290px; box-sizing: border-box;
      background: #fff; color: #1f2328; border: 1px solid #d0d7de;
      border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.18);
      padding: 12px 14px; font: 14px/1.5 -apple-system, "Segoe UI", "Malgun Gothic", sans-serif;
    }
    .top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    .src { color: #57606a; font-size: 12px; word-break: break-word; }
    .close { cursor: pointer; border: 0; background: none; color: #57606a; font-size: 16px; line-height: 1; padding: 0; }
    .tr { font-size: 17px; font-weight: 600; margin: 4px 0 6px; word-break: break-word; }
    .dict { font-size: 13px; color: #424a53; margin: 2px 0; }
    .pos { color: #0969da; margin-right: 6px; }
    .ai { font-size: 13px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d0d7de; white-space: pre-wrap; word-break: break-word; }
    .ai:empty { display: none; }
    .basic { font-size: 12px; color: #57606a; margin: -2px 0 6px; word-break: break-word; }
    .basic:empty { display: none; }
    .err { color: #cf222e; }
    .bottom { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; padding-top: 8px; border-top: 1px solid #eaeef2; font-size: 13px; }
    .opts { display: flex; flex-direction: column; gap: 4px; }
    label { cursor: pointer; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    a { color: #0969da; cursor: pointer; text-decoration: none; white-space: nowrap; margin-left: 12px; }
    @media (prefers-color-scheme: dark) {
      .bubble { background: #22272e; color: #e6edf3; border-color: #444c56; }
      .src, .close, .basic { color: #9aa4af; }
      .dict { color: #c5ced8; }
      .pos, a { color: #6cb6ff; }
      .bottom { border-top-color: #373e47; }
    }
  `;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.style.cssText = "position:absolute;top:0;left:0;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function hide() {
    currentText = "";
    requestId++;
    if (root) {
      const b = root.querySelector(".bubble");
      if (b) b.remove();
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 선택한 단어가 들어 있는 문장을 문맥으로 저장
  function getContext(sel, text) {
    try {
      const full = blockText(sel.anchorNode);
      if (!full) return "";
      const sentences = full.split(/(?<=[.!?。？！])\s+/);
      const hit = sentences.find((s) => s.includes(text));
      if (!hit) return full.length <= 300 ? full : "";
      return hit.length > 300 ? hit.slice(0, 300) + "…" : hit;
    } catch (e) {
      return "";
    }
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  async function setSaved(entry, saved) {
    const { vocab = [] } = await storageGet(["vocab"]);
    const key = entry.text.toLowerCase();
    const rest = vocab.filter((v) => v.text.toLowerCase() !== key);
    if (saved) rest.unshift(entry);
    await new Promise((resolve) => chrome.storage.local.set({ vocab: rest }, resolve));
  }

  // AI에 넘길 넓은 문맥: 선택 영역 앞뒤 약 500자
  function getWideContext(sel, text) {
    try {
      let node = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType !== 1) node = node.parentElement;
      let full = blockText(node);
      // 선택한 부분만 들어 있으면 한 단계 위 요소까지 넓힘
      if (full.length < text.length + 80 && node && node.parentElement) {
        full = (node.parentElement.textContent || "").replace(/\s+/g, " ").trim();
      }
      const i = full.indexOf(text);
      if (i < 0) return full.slice(0, 1000);
      return full.slice(Math.max(0, i - 500), i + text.length + 500);
    } catch (e) {
      return "";
    }
  }

  async function show(text, rect, context, wide) {
    ensureHost();
    const old = root.querySelector(".bubble");
    if (old) old.remove();

    const bubble = el("div", "bubble");
    const top = el("div", "top");
    top.appendChild(el("div", "src", text));
    const close = el("button", "close", "×");
    close.addEventListener("click", hide);
    top.appendChild(close);
    bubble.appendChild(top);

    const body = el("div");
    body.appendChild(el("div", "dict", T("b_translating")));
    bubble.appendChild(body);
    root.appendChild(bubble);

    // 위치: 선택 영역 바로 아래, 화면 밖으로 나가지 않게
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 420)) + window.scrollX;
    bubble.style.left = left + "px";
    bubble.style.top = rect.bottom + window.scrollY + 8 + "px";

    const myId = ++requestId;
    currentText = text;

    let settings, vocab, res;
    try {
      const stored = await storageGet(["settings", "vocab"]);
      settings = stored.settings || {};
      lang = settings.target || "ko";
      vocab = stored.vocab || [];
      res = await chrome.runtime.sendMessage({
        type: "translate",
        text,
        target: settings.target || "ko",
      });
    } catch (e) {
      res = { ok: false, error: T("b_reload") };
    }
    if (myId !== requestId) return; // 그 사이 다른 단어를 선택함

    body.textContent = "";
    if (!res || !res.ok) {
      // 기본 번역이 막혀도 AI 해석을 쓸 수 있으면 그쪽으로 계속 진행
      if (!settings || !settings.apiKey) {
        body.appendChild(el("div", "dict err", (res && res.error) || T("b_fail")));
        return;
      }
      res = { ok: false, translation: "", dict: [], source: "" };
    }

    const state = { translation: res.translation, explanation: "" };
    let touched = false; // 이 말풍선에서 사용자가 체크박스를 건드렸는지

    const trEl = el("div", "tr", res.translation);
    body.appendChild(trEl);
    const basicEl = el("div", "basic"); // AI 해석이 위 자리를 차지하면 기본 번역을 여기에 남김
    body.appendChild(basicEl);
    for (const d of res.dict || []) {
      const line = el("div", "dict");
      if (d.pos) line.appendChild(el("span", "pos", d.pos));
      line.appendChild(document.createTextNode(d.terms.join(", ")));
      body.appendChild(line);
    }
    const aiEl = el("div", "ai");
    body.appendChild(aiEl);

    const existing = vocab.find((v) => v.text.toLowerCase() === text.toLowerCase());

    // 저장 옵션 두 가지: 단어장(일반 단어) / 용어집(전문용어·약어). 한 항목은 한 곳에만 들어갑니다.
    const bottom = el("div", "bottom");
    const opts = el("div", "opts");
    const makeOpt = (kind, labelText) => {
      const label = el("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !!existing && (existing.kind || "word") === kind;
      label.appendChild(box);
      const span = el("span", null, labelText);
      label.appendChild(span);
      opts.appendChild(label);
      return { box, span, labelText };
    };
    const wordOpt = makeOpt("word", T("b_add_word"));
    const termOpt = makeOpt("term", T("b_add_term"));
    bottom.appendChild(opts);

    const link = el("a", null, T("b_open_vocab"));
    link.addEventListener("click", () => {
      try { chrome.runtime.sendMessage({ type: "openVocab" }); } catch (e) {}
    });
    bottom.appendChild(link);
    bubble.appendChild(bottom);

    const currentKind = () => (termOpt.box.checked ? "term" : wordOpt.box.checked ? "word" : "");
    const save = () =>
      setSaved(
        {
          text,
          kind: currentKind() || "word",
          translation: state.translation,
          basic: res.translation || "",
          explanation: state.explanation,
          dict: res.dict || [],
          source: res.source || "",
          target: settings.target || "ko",
          context,
          url: sourceUrl(),
          title: document.title,
          addedAt: existing ? existing.addedAt : Date.now(),
          correct: existing ? existing.correct || 0 : 0,
          wrong: existing ? existing.wrong || 0 : 0,
        },
        !!currentKind()
      ).catch(() => {});

    const onToggle = (mine, other) => () => {
      if (mine.box.checked) other.box.checked = false;
      touched = true;
      save();
    };
    wordOpt.box.addEventListener("change", onToggle(wordOpt, termOpt));
    termOpt.box.addEventListener("change", onToggle(termOpt, wordOpt));

    // 문맥 해석 (API 키가 설정된 경우에만)
    if (!settings.apiKey) return;
    aiEl.textContent = T("b_ai_loading");
    let ai;
    try {
      ai = await chrome.runtime.sendMessage({ type: "explain", text, context: wide, title: document.title });
    } catch (e) {
      ai = { ok: false, error: T("b_ai_fail") };
    }
    if (myId !== requestId) return;

    if (ai && ai.ok) {
      if (ai.translation) {
        state.translation = ai.translation;
        trEl.textContent = ai.translation;
        if (res.translation && res.translation !== ai.translation) basicEl.textContent = T("b_basic") + ": " + res.translation;
      }
      state.explanation = ai.explanation || "";
      aiEl.textContent = state.explanation;
      // AI가 전문용어·약어로 판단하면 용어집을, 일반 단어면 단어장을 추천 표시
      const rec = ai.kind === "term" ? termOpt : ai.kind === "word" ? wordOpt : null;
      if (rec) rec.span.textContent = rec.labelText + " (" + T("b_recommended") + ")";
      if (touched && currentKind()) save(); // 먼저 체크했다면 해석 결과로 갱신
    } else {
      aiEl.textContent = (ai && ai.error) || T("b_ai_fail");
      aiEl.classList.add("err");
    }
  }

  document.addEventListener("mouseup", (ev) => {
    if (host && ev.composedPath().includes(host)) return; // 말풍선 안 클릭
    setTimeout(async () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().replace(/\s+/g, " ").trim() : "";
      if (!text || text.length > MAX_LEN || sel.rangeCount === 0) {
        hide();
        return;
      }
      if (text === currentText) return;

      const t = ev.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      try {
        const { settings = {} } = await storageGet(["settings"]);
        if (settings.enabled === false) return;
      } catch (e) {
        return;
      }

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      show(text, rect, getContext(sel, text), getWideContext(sel, text));
    }, 10);
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
})();
