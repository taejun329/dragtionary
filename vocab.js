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
let quizHistory = []; // 지난 시험 기록 (최신이 앞). 브라우저에만 저장합니다.
const HISTORY_MAX = 50;
const sel = { mode: "choice", scope: "word", size: 10, dir: "word" }; // 시험 설정에서 고른 값

function poolOf(scope) {
  return scope === "all" ? vocab : vocab.filter((v) => kindOf(v) === scope);
}

// 버튼 묶음 하나를 그립니다. options: [{ value, label }]
function drawSeg(id, options, current, onPick) {
  const box = $(id);
  box.textContent = "";
  for (const o of options) {
    const b = el("button", o.value === current ? "on" : null, o.label);
    b.type = "button";
    b.addEventListener("click", () => {
      onPick(o.value);
      resetQuiz();
    });
    box.appendChild(b);
  }
}

// 시험 설정 화면을 현재 선택과 저장된 항목 수에 맞게 다시 그립니다.
function resetQuiz() {
  $("quiz-start").hidden = false;
  $("quiz-run").hidden = true;
  $("quiz-result").hidden = true;

  const pool = poolOf(sel.scope);
  const n = pool.length;
  const ai = sel.mode === "ai";

  // 문제 수: 가진 항목 수를 넘지 않는 선택지만 보여 줍니다.
  const sizes = [5, 10, 20].filter((x) => x < n);
  if (n) sizes.push(n);
  if (!sizes.includes(sel.size)) sel.size = n > 10 ? 10 : n;

  drawSeg("seg-mode", [{ value: "ai", label: T("q_mode_ai") }, { value: "choice", label: T("q_mode_choice") }], sel.mode, (v) => (sel.mode = v));
  drawSeg(
    "seg-scope",
    [["word", "tab_words"], ["term", "tab_terms"], ["all", "q_all"]].map(([value, key]) => ({ value, label: T(key) + " " + poolOf(value).length })),
    sel.scope,
    (v) => {
      sel.scope = v;
      sel.size = 0; // 범위를 바꾸면 문제 수를 다시 정함
    }
  );
  drawSeg("seg-size", sizes.map((x) => ({ value: x, label: x === n ? T("q_all_n", x) : String(x) })), sel.size, (v) => (sel.size = v));
  drawSeg("seg-dir", [{ value: "word", label: T("q_dir_w2m") }, { value: "meaning", label: T("q_dir_m2w") }], sel.dir, (v) => (sel.dir = v));
  $("quiz-dir-row").hidden = ai;
  $("seg-size").parentElement.hidden = n === 0;

  let ready, note;
  if (ai) {
    const hasKey = !!$("apiKey").value.trim();
    ready = hasKey && n >= 1;
    note = !hasKey ? T("q_need_key") : n ? T("q_note_ai", sel.size) : T("q_none");
  } else {
    const distinct = new Set(pool.map((v) => v.translation)).size;
    ready = n >= 4 && distinct >= 4;
    note = ready ? T("q_note_choice") : n ? T("q_need4", n) : T("q_none");
  }
  $("quiz-go").disabled = !ready;
  $("quiz-go").textContent = ready ? T("q_start_n", sel.size) : T("q_start");
  $("quiz-note").textContent = note;
  renderHistory();
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

// items를 주면 그 항목들로만 시험을 봅니다(틀린 것만 다시).
function startQuiz(items) {
  const pool = poolOf(sel.scope);
  const picked = items || pickQuestions(pool, Math.min(sel.size, pool.length));
  if (!picked.length) return resetQuiz();
  quiz = {
    mode: sel.mode,
    scope: sel.scope,
    pool,
    items: shuffle(picked),
    idx: 0,
    right: 0,
    partial: 0,
    missed: [],
    log: [], // 문제별 내역: 결과 화면과 기록에 씁니다
    dir: sel.dir,
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

// 판정 결과를 통계와 내역에 반영. 부분 정답은 다시 나오도록 오답 쪽으로 셉니다.
async function record(v, verdict, answer, feedback) {
  if (verdict === "correct") {
    quiz.right++;
    v.correct = (v.correct || 0) + 1;
  } else {
    if (verdict === "partial") quiz.partial++;
    quiz.missed.push(v);
    v.wrong = (v.wrong || 0) + 1;
  }
  quiz.log.push({
    text: v.text,
    translation: v.translation,
    answer: answer || "",
    verdict,
    feedback: quiz.mode === "ai" ? feedback || "" : "",
  });
  await set({ vocab });
}

/* --- 4지선다 --- */
async function answerChoice(v, chosen, correct) {
  document.querySelectorAll(".choice").forEach((b) => {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add("correct");
    else if (b.textContent === chosen) b.classList.add("wrong");
  });
  await record(v, chosen === correct ? "correct" : "wrong", chosen);

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

// aiFeedback: AI가 실제로 채점했을 때의 설명. 직접 판정한 경우에는 내역에 남기지 않습니다.
async function finishWritten(v, verdict, feedback, aiFeedback) {
  await record(v, verdict, quiz.answer, aiFeedback ? feedback : "");
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
  quiz.answer = answer;
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
  if (!quiz || quiz.items[quiz.idx] !== v) return; // 그 사이 시험이 바뀜

  if (res && res.ok && res.verdict) return finishWritten(v, res.verdict, res.feedback, true);

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
$("quiz-self-right").addEventListener("click", () => finishWritten(quiz.items[quiz.idx], "correct", ""));
$("quiz-self-wrong").addEventListener("click", () => finishWritten(quiz.items[quiz.idx], "wrong", ""));

/* --- 결과와 기록 --- */
function scoreText(total, right, partial) {
  return T("q_score", total, right) + (partial ? " · " + T("q_score_partial", partial) : "");
}

// 문제별 내역(판정, 내 답, 저장된 뜻, AI 설명)을 box에 그립니다.
function renderDetail(box, items) {
  box.textContent = "";
  for (const it of items) {
    const row = el("div", "qitem");
    row.appendChild(el("div", "verdict " + it.verdict, T("verdict_" + it.verdict)));
    const body = el("div");
    body.appendChild(el("div", "w", it.text));
    body.appendChild(el("div", "sub", T("q_your_answer") + ": " + (it.answer || T("q_skipped"))));
    body.appendChild(el("div", "sub", T("q_saved_meaning") + ": " + it.translation));
    if (it.feedback) body.appendChild(el("div", "fb", it.feedback));
    row.appendChild(body);
    box.appendChild(row);
  }
}

function historyLabel(h) {
  const scope = T(h.scope === "term" ? "tab_terms" : h.scope === "all" ? "q_all" : "tab_words");
  const date = new Date(h.at).toLocaleDateString(lang, { month: "short", day: "numeric" });
  return [date, T(h.mode === "ai" ? "q_mode_ai" : "q_mode_choice"), scope].join(" · ");
}

function renderHistory() {
  const box = $("quiz-history");
  box.textContent = "";
  $("quiz-history-clear").hidden = quizHistory.length === 0;
  if (!quizHistory.length) {
    box.appendChild(el("div", "muted", T("q_history_empty")));
    return;
  }
  for (const h of quizHistory) {
    const row = el("button", "hrow");
    row.type = "button";
    row.appendChild(el("span", null, historyLabel(h)));
    row.appendChild(el("span", "score" + (h.right === h.total ? " full" : ""), h.right + " / " + h.total));
    const body = el("div", "hbody");
    body.hidden = true;
    row.addEventListener("click", () => {
      if (body.hidden && !body.childNodes.length) renderDetail(body, h.items || []);
      body.hidden = !body.hidden;
    });
    box.appendChild(row);
    box.appendChild(body);
  }
}

async function finishQuiz() {
  quizHistory = [
    { at: Date.now(), mode: quiz.mode, scope: quiz.scope, total: quiz.items.length, right: quiz.right, partial: quiz.partial, items: quiz.log },
    ...quizHistory,
  ].slice(0, HISTORY_MAX);
  await set({ quizHistory });

  $("quiz-run").hidden = true;
  $("quiz-result").hidden = false;
  $("quiz-score").textContent = scoreText(quiz.items.length, quiz.right, quiz.partial);
  $("quiz-result-note").textContent = quiz.missed.length ? T("q_review") : "";
  renderDetail($("quiz-detail"), quiz.log);
  $("quiz-retry").hidden = quiz.missed.length === 0;
  renderList();
}

$("quiz-next").addEventListener("click", () => {
  quiz.idx++;
  if (quiz.idx < quiz.items.length) return showQuestion();
  finishQuiz();
});

$("quiz-go").addEventListener("click", () => startQuiz());
$("quiz-again").addEventListener("click", resetQuiz);
// 틀린 것만 다시: 그 사이 목록에서 지운 항목은 뺍니다.
$("quiz-retry").addEventListener("click", () => startQuiz([...new Set(quiz.missed)].filter((v) => vocab.includes(v))));
$("quiz-history-clear").addEventListener("click", async () => {
  quizHistory = [];
  await set({ quizHistory });
  renderHistory();
});

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
  const data = await get(["vocab", "settings", "quizHistory"]);
  vocab = data.vocab || [];
  quizHistory = data.quizHistory || [];
  const s = data.settings || {};
  loadSettings(s);
  sel.mode = s.apiKey ? "ai" : "choice"; // 키가 있으면 AI 채점을 기본으로
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
