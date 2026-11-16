// Dragtionary 페이지: 단어장 / 용어집 / 시험 / 설정

const $ = (id) => document.getElementById(id);
const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

let vocab = [];
let currentKind = "word"; // 지금 보고 있는 목록: "word"(단어장) 또는 "term"(용어집)
let lang = "ko"; // 화면 언어. 설정의 "언어"를 따릅니다.

const T = (key, ...args) => DTI18N.t(lang, key, ...args);
const kindOf = (v) => v.kind || "word"; // 예전 버전에서 저장한 항목은 단어장으로 취급

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- 탭 ---------- */
document.querySelectorAll("button.tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("button.tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
    if (btn.dataset.kind) {
      currentKind = btn.dataset.kind;
      renderList();
    }
    if (btn.dataset.tab === "quiz") resetQuiz();
  });
});

/* ---------- 단어장 / 용어집 목록 ---------- */
function renderList() {
  const isTerm = currentKind === "term";
  const mine = vocab.filter((v) => kindOf(v) === currentKind);
  const q = $("search").value.trim().toLowerCase();
  const items = mine.filter(
    (v) =>
      !q ||
      v.text.toLowerCase().includes(q) ||
      (v.translation || "").toLowerCase().includes(q) ||
      (v.explanation || "").toLowerCase().includes(q)
  );

  $("col-word").textContent = T(isTerm ? "col_term" : "col_word");
  $("col-meaning").textContent = T(isTerm ? "col_desc" : "col_meaning");
  $("count").textContent = T("count", mine.length);
  $("empty").textContent = T(isTerm ? "empty_terms" : "empty_words");
  $("empty").hidden = mine.length > 0;
  $("table").hidden = mine.length === 0;

  const rows = $("rows");
  rows.textContent = "";
  for (const v of items) {
    const tr = el("tr");
    tr.appendChild(el("td", "word", v.text));

    const meaning = el("td");
    meaning.appendChild(el("div", null, v.translation));
    if (v.explanation) meaning.appendChild(el("div", "explain", v.explanation));
    if (v.basic && v.basic !== v.translation) meaning.appendChild(el("div", "sub", T("b_basic") + ": " + v.basic));
    if (!isTerm) {
      for (const d of v.dict || []) {
        meaning.appendChild(el("div", "sub", (d.pos ? d.pos + " · " : "") + d.terms.join(", ")));
      }
    }
    tr.appendChild(meaning);

    const ctx = el("td", "ctx");
    if (v.context) ctx.appendChild(el("div", null, v.context));
    if (v.url && /^https?:/.test(v.url)) {
      const a = el("a", null, T("open_source"));
      a.href = v.url;
      a.target = "_blank";
      a.rel = "noopener";
      ctx.appendChild(a);
    }
    tr.appendChild(ctx);

    tr.appendChild(el("td", "small", (v.correct || 0) + " / " + (v.wrong || 0)));
    tr.appendChild(el("td", "small", new Date(v.addedAt).toLocaleDateString(lang)));

    const actions = el("td", "small");
    const move = el("button", "link move", T(isTerm ? "to_words" : "to_terms"));
    move.addEventListener("click", async () => {
      v.kind = isTerm ? "word" : "term";
      await set({ vocab });
      renderList();
    });
    actions.appendChild(move);
    const del = el("button", "link", T("delete"));
    del.addEventListener("click", async () => {
      vocab = vocab.filter((x) => x !== v);
      await set({ vocab });
      renderList();
    });
    actions.appendChild(del);
    tr.appendChild(actions);

    rows.appendChild(tr);
  }
}

$("search").addEventListener("input", renderList);

$("export").addEventListener("click", () => {
  const isTerm = currentKind === "term";
  const esc = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const head = [isTerm ? "col_term" : "col_word", "col_meaning", "b_basic", "col_desc", "col_context", "col_source", "col_added"];
  const lines = [head.map((k) => esc(T(k))).join(",")];
  for (const v of vocab.filter((x) => kindOf(x) === currentKind)) {
    lines.push(
      [v.text, v.translation, v.basic, v.explanation, v.context, v.url, new Date(v.addedAt).toISOString().slice(0, 10)]
        .map(esc)
        .join(",")
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = isTerm ? "dragtionary-terms.csv" : "dragtionary-words.csv";
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---------- 시험 ---------- */
// 방식 두 가지: "ai"(뜻을 직접 쓰면 AI가 채점하고 보충 설명) / "choice"(4지선다, API 키 없이 가능)
let quiz = null;

function quizPool() {
  const scope = $("quiz-scope").value;
  return scope === "all" ? vocab : vocab.filter((v) => kindOf(v) === scope);
}

function resetQuiz() {
  $("quiz-start").hidden = false;
  $("quiz-run").hidden = true;
  $("quiz-result").hidden = true;
  const pool = quizPool();
  const ai = $("quiz-mode").value === "ai";
  $("quiz-dir-label").hidden = ai;

  let ready, note;
  if (ai) {
    const hasKey = !!$("apiKey").value.trim();
    ready = hasKey && pool.length >= 1;
    note = !hasKey ? T("q_need_key") : pool.length ? T("q_ai_count", pool.length) : T("q_none");
  } else {
    const distinct = new Set(pool.map((v) => v.translation)).size;
    ready = pool.length >= 4 && distinct >= 4;
    note = ready ? T("q_count", pool.length) : T("q_need4", pool.length);
  }
  $("quiz-go").disabled = !ready;
  $("quiz-note").textContent = note;
}

// 처음 보는 항목과 자주 틀린 항목에 높은 우선순위
function pickQuestions(pool, n) {
  return pool
    .map((v) => {
      const seen = (v.correct || 0) + (v.wrong || 0);
      const score = (v.wrong || 0) * 2 - (v.correct || 0) + (seen === 0 ? 3 : 0) + Math.random() * 2;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.v);
}

function startQuiz() {
  const pool = quizPool();
  const n = Math.min(parseInt($("quiz-size").value, 10), pool.length);
  quiz = {
    mode: $("quiz-mode").value,
    pool,
    items: shuffle(pickQuestions(pool, n)),
    idx: 0,
    right: 0,
    partial: 0,
    missed: [],
    dir: $("quiz-dir").value,
    busy: false,
  };
  $("quiz-start").hidden = true;
  $("quiz-result").hidden = true;
  $("quiz-run").hidden = false;
  showQuestion();
}

function showQuestion() {
  const v = quiz.items[quiz.idx];
  const ai = quiz.mode === "ai";
  quiz.busy = false;

  $("quiz-progress").textContent = quiz.idx + 1 + " / " + quiz.items.length;
  $("quiz-context").textContent = "";
  $("quiz-next").hidden = true;
  $("quiz-feedback").hidden = true;
  $("quiz-self").hidden = true;
  $("quiz-choices").hidden = ai;
  $("quiz-answer-box").hidden = !ai;
  $("quiz-hint").hidden = !(ai && v.context);

  if (ai) {
    $("quiz-question").textContent = v.text;
    const input = $("quiz-answer");
    input.value = "";
    input.disabled = false;
    $("quiz-submit").disabled = false;
    $("quiz-skip").disabled = false;
    input.focus();
    return;
  }

  const ask = quiz.dir === "word" ? (x) => x.text : (x) => x.translation;
  const ans = quiz.dir === "word" ? (x) => x.translation : (x) => x.text;
  $("quiz-question").textContent = ask(v);

  // 오답 보기: 같은 범위의 다른 항목 답 중 정답과 겹치지 않는 3개
  const pool = [...new Set(quiz.pool.filter((x) => x !== v).map(ans))].filter((a) => a !== ans(v));
  const options = shuffle([ans(v), ...shuffle(pool).slice(0, 3)]);

  const box = $("quiz-choices");
  box.textContent = "";
  for (const opt of options) {
    const btn = el("button", "choice", opt);
    btn.addEventListener("click", () => answerChoice(v, opt, ans(v)));
    box.appendChild(btn);
  }
}

function showNext() {
  const next = $("quiz-next");
  next.textContent = T(quiz.idx + 1 < quiz.items.length ? "q_next" : "q_result");
  next.hidden = false;
  next.focus();
}

// 판정 결과를 통계에 반영. 부분 정답은 다시 나오도록 오답 쪽으로 셉니다.
async function record(v, verdict) {
  if (verdict === "correct") {
    quiz.right++;
    v.correct = (v.correct || 0) + 1;
  } else {
    if (verdict === "partial") quiz.partial++;
    quiz.missed.push(v);
    v.wrong = (v.wrong || 0) + 1;
  }
  await set({ vocab });
}

/* --- 4지선다 --- */
async function answerChoice(v, chosen, correct) {
  document.querySelectorAll(".choice").forEach((b) => {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add("correct");
    else if (b.textContent === chosen) b.classList.add("wrong");
  });
  await record(v, chosen === correct ? "correct" : "wrong");

  const notes = [];
  if (v.explanation) notes.push(v.explanation);
  if (v.context) notes.push(T("col_context") + ": " + v.context);
  $("quiz-context").textContent = notes.join("\n");
  showNext();
}

/* --- 직접 쓰기 (AI 채점) --- */
function showReference(v) {
  const ref = $("quiz-reference");
  ref.textContent = "";
  ref.appendChild(el("div", "ref-title", T("q_saved_meaning")));
  ref.appendChild(el("div", null, v.translation));
  if (v.explanation) ref.appendChild(el("div", "sub", v.explanation));
  if (v.context) ref.appendChild(el("div", "sub", T("col_context") + ": " + v.context));
}

async function finishWritten(v, verdict, feedback) {
  await record(v, verdict);
  const badge = $("quiz-verdict");
  badge.textContent = T("verdict_" + verdict);
  badge.className = "verdict " + verdict;
  $("quiz-feedback-text").textContent = feedback || "";
  $("quiz-self").hidden = true;
  showReference(v);
  $("quiz-feedback").hidden = false;
  showNext();
}

async function submitWritten(skip) {
  if (!quiz || quiz.mode !== "ai" || quiz.busy) return;
  const v = quiz.items[quiz.idx];
  const answer = skip ? "" : $("quiz-answer").value.trim();
  if (!skip && !answer) return;

  quiz.busy = true;
  $("quiz-answer").disabled = true;
  $("quiz-submit").disabled = true;
  $("quiz-skip").disabled = true;
  $("quiz-hint").hidden = true;

  if (skip) return finishWritten(v, "wrong", "");

  const badge = $("quiz-verdict");
  badge.textContent = T("q_grading");
  badge.className = "verdict";
  $("quiz-feedback-text").textContent = "";
  $("quiz-reference").textContent = "";
  $("quiz-feedback").hidden = false;

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "grade",
      item: { text: v.text, kind: kindOf(v), translation: v.translation, explanation: v.explanation, context: v.context },
      answer,
    });
  } catch (e) {
    res = { ok: false, error: String(e.message || e) };
  }
  if (quiz.items[quiz.idx] !== v) return; // 그 사이 시험이 바뀜

  if (res && res.ok && res.verdict) return finishWritten(v, res.verdict, res.feedback);

  // 채점 실패(한도 초과 등): 저장된 뜻을 보여 주고 직접 판정하게 함
  badge.textContent = T("q_grade_fail");
  $("quiz-feedback-text").textContent = (res && (res.error || res.feedback)) || T("q_no_response");
  showReference(v);
  $("quiz-self").hidden = false;
}

$("quiz-submit").addEventListener("click", () => submitWritten(false));
$("quiz-skip").addEventListener("click", () => submitWritten(true));
$("quiz-answer").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    submitWritten(false);
  }
});
$("quiz-hint").addEventListener("click", () => {
  const v = quiz.items[quiz.idx];
  $("quiz-context").textContent = v.context || "";
  $("quiz-hint").hidden = true;
});
$("quiz-self-right").addEventListener("click", () => finishWritten(quiz.items[quiz.idx], "correct", $("quiz-feedback-text").textContent));
$("quiz-self-wrong").addEventListener("click", () => finishWritten(quiz.items[quiz.idx], "wrong", $("quiz-feedback-text").textContent));

$("quiz-next").addEventListener("click", () => {
  quiz.idx++;
  if (quiz.idx < quiz.items.length) return showQuestion();

  $("quiz-run").hidden = true;
  $("quiz-result").hidden = false;
  $("quiz-score").textContent =
    T("q_score", quiz.items.length, quiz.right) + (quiz.partial ? " · " + T("q_score_partial", quiz.partial) : "");
  const box = $("quiz-wrong");
  box.textContent = "";
  if (quiz.missed.length) {
    box.appendChild(el("p", "muted", T("q_review")));
    for (const m of quiz.missed) box.appendChild(el("div", null, m.text + " — " + m.translation));
  }
  renderList();
});

$("quiz-go").addEventListener("click", startQuiz);
$("quiz-again").addEventListener("click", resetQuiz);
$("quiz-scope").addEventListener("change", resetQuiz);
$("quiz-mode").addEventListener("change", resetQuiz);

/* ---------- 설정 ---------- */
async function saveSettings() {
  await set({
    settings: {
      enabled: $("enabled").checked,
      target: $("target").value,
      pdfAuto: $("pdfAuto").checked,
      provider: $("provider").value,
      apiKey: $("apiKey").value.trim(),
      model: $("model").value.trim(),
    },
  });
  $("saved-msg").textContent = T("s_saved");
}

// 저장된 설정을 화면의 각 칸에 채웁니다.
function loadSettings(s) {
  lang = DTI18N.MESSAGES[s.target] ? s.target : "ko";
  DTI18N.fillSelect($("target"), lang);
  $("enabled").checked = s.enabled !== false;
  $("pdfAuto").checked = !!s.pdfAuto;
  $("provider").value = s.provider || "gemini";
  $("apiKey").value = s.apiKey || "";
  $("model").value = s.model || "";
}

// 현재 언어로 화면 전체를 다시 그립니다.
function applyLang() {
  DTI18N.apply(lang);
  renderList();
  if ($("quiz-run").hidden && $("quiz-result").hidden) resetQuiz();
}

$("target").addEventListener("change", async () => {
  lang = $("target").value;
  await saveSettings();
  applyLang();
});
$("enabled").addEventListener("change", saveSettings);
$("pdfAuto").addEventListener("change", saveSettings);
$("provider").addEventListener("change", saveSettings);
$("apiKey").addEventListener("change", saveSettings);
$("model").addEventListener("change", saveSettings);

$("test").addEventListener("click", async () => {
  const out = $("test-result");
  await saveSettings();
  await new Promise((r) => chrome.storage.local.remove(["geminiAuto", "openaiAuto"], r)); // 모델 자동 선택 다시
  if (!$("apiKey").value.trim()) {
    out.textContent = T("s_need_key");
    return;
  }
  out.textContent = T("s_testing");
  let res;
  try {
    res = await chrome.runtime.sendMessage({
      type: "explain",
      text: "stratification",
      context: "Patients were randomized with stratification by age and disease stage.",
      title: "Clinical trial design",
    });
  } catch (e) {
    res = { ok: false, error: String(e.message || e) };
  }
  out.textContent = res && res.ok
    ? T("s_test_ok") + " (" + res.model + ") — " + res.translation + (res.explanation ? " : " + res.explanation : "")
    : T("s_test_fail") + " — " + ((res && res.error) || T("q_no_response"));
});

/* ---------- 초기화 ---------- */
async function init() {
  const data = await get(["vocab", "settings"]);
  vocab = data.vocab || [];
  const s = data.settings || {};
  loadSettings(s);
  $("quiz-mode").value = s.apiKey ? "ai" : "choice"; // 키가 있으면 AI 채점을 기본으로
  applyLang();
}

// 다른 탭에서 항목을 추가하거나 설정(언어 등)을 바꾸면 자동으로 반영합니다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const running = quiz && !$("quiz-run").hidden; // 시험 중에는 목록과 화면을 건드리지 않음
  if (changes.vocab && !running) {
    vocab = changes.vocab.newValue || [];
    renderList();
  }
  if (changes.settings && !running) {
    loadSettings(changes.settings.newValue || {});
    applyLang();
  }
});

init();
