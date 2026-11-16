// 시작하기 페이지: 세 화면을 하나씩 넘겨 봅니다.
//   1) 언어 선택과 API 키 연결  2) 예시와 연습 문장  3) 사용 팁
// (연습 문장의 드래그 번역은 함께 불러온 content.js가 처리합니다.)

const $ = (id) => document.getElementById(id);
const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));

const TOTAL = 3;
const PROVIDER_NAME = { gemini: "Gemini", openai: "OpenAI", claude: "Claude" };

let lang = "ko";
let screen = 1;
let connected = false; // AI 키가 연결돼 있는지
let okProvider = ""; // 방금 연결에 성공한 서비스 (성공 문구를 언어가 바뀌어도 다시 그리기 위해 기억)
let okSample = "";

const T = (key, ...args) => DTI18N.t(lang, key, ...args);

function showResult(kind, text) {
  const box = $("result");
  box.className = "result " + kind;
  box.textContent = text;
  box.hidden = !text;
}

// 현재 언어와 상태에 맞게 화면 전체를 다시 그립니다.
function render() {
  DTI18N.apply(lang);
  document.title = T("w_title");

  for (let i = 1; i <= TOTAL; i++) $("screen-" + i).hidden = i !== screen;
  $("prev").style.visibility = screen === 1 ? "hidden" : "visible";
  $("progress").textContent = screen + " / " + TOTAL;

  // 첫 화면의 오른쪽 버튼: 연결 전에는 "나중에 하기", 연결 후에는 "다음"
  const next = $("next");
  const skipping = screen === 1 && !connected;
  next.textContent = skipping ? T("w1_skip") : screen === TOTAL ? T("w3_start") : T("w_next");
  next.classList.toggle("primary", !skipping);

  const note = $("ai-note");
  note.textContent = connected ? T("w2_on") : T("w2_off");
  note.classList.toggle("on", connected);

  if (okProvider) showResult("ok", T("w_connected", PROVIDER_NAME[okProvider]) + (okSample ? "\n\n" + okSample : ""));
}

function go(to) {
  // 화면을 넘길 때 떠 있는 말풍선과 선택 영역을 정리
  try { getSelection().removeAllRanges(); } catch (e) {}
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

  if (to > TOTAL) {
    location.href = "vocab.html";
    return;
  }
  screen = Math.max(1, to);
  render();
  window.scrollTo(0, 0);
}

// 키의 앞머리로 어느 서비스의 키인지 알아봅니다.
function detectProvider(key) {
  if (key.startsWith("sk-ant-")) return "claude";
  if (key.startsWith("sk-")) return "openai";
  return "gemini";
}

async function check() {
  const key = $("key").value.trim();
  okProvider = "";
  if (!key) {
    showResult("fail", T("w_paste_first"));
    return;
  }
  $("check").disabled = true;
  showResult("", T("w_checking"));

  // 다른 설정은 그대로 두고 키와 서비스만 저장
  const provider = detectProvider(key);
  const { settings = {} } = await get(["settings"]);
  await set({ settings: { ...settings, provider, apiKey: key, model: "" } });
  await new Promise((r) => chrome.storage.local.remove(["geminiAuto", "openaiAuto"], r));

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
  $("check").disabled = false;

  if (res && res.ok && !res.skipped) {
    connected = true;
    okProvider = provider;
    okSample = "stratification → " + res.translation + (res.explanation ? "\n" + res.explanation : "");
    render();
  } else {
    await set({ settings }); // 확인에 실패한 키는 저장하지 않고 이전 설정으로 되돌림
    connected = !!settings.apiKey;
    render();
    showResult("fail", "[" + PROVIDER_NAME[provider] + "] " + ((res && res.error) || T("w_no_response")));
  }
}

$("check").addEventListener("click", check);
$("key").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") check();
});
$("prev").addEventListener("click", () => go(screen - 1));
$("next").addEventListener("click", () => go(screen + 1));

// 언어를 바꾸면 저장하고 곧바로 화면에 반영합니다. 같은 언어가 AI 해석에도 쓰입니다.
$("lang").addEventListener("change", async () => {
  lang = $("lang").value;
  const { settings = {} } = await get(["settings"]);
  await set({ settings: { ...settings, target: lang } });
  render();
});

get(["settings"]).then(({ settings = {} }) => {
  lang = DTI18N.MESSAGES[settings.target] ? settings.target : "ko"; // 처음에는 한국어
  DTI18N.fillSelect($("lang"), lang);
  if (settings.apiKey) $("key").value = settings.apiKey;
  connected = !!settings.apiKey;
  render();
});
