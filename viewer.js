// PDF 번역 뷰어: PDF.js로 PDF를 직접 그려서 글자를 드래그할 수 있게 합니다.
// 드래그 번역 자체는 같은 페이지에 함께 불러온 content.js가 처리합니다.

const $ = (id) => document.getElementById(id);
const base = new URL("pdfjs/", location.href).href;

// 화면 언어: 설정의 "언어"를 따릅니다.
const { settings = {} } = await chrome.storage.local.get("settings");
const lang = settings.target || "ko";
const T = (key, ...args) => self.DTI18N.t(lang, key, ...args);
self.DTI18N.apply(lang);
document.title = T("v_title");

const pdfjsLib = await import("./pdfjs/pdf.min.mjs");
globalThis.pdfjsLib = pdfjsLib; // pdf_viewer.mjs가 전역에서 찾습니다
const { EventBus, PDFViewer, PDFLinkService } = await import("./pdfjs/pdf_viewer.mjs");

pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const pdfViewer = new PDFViewer({
  container: $("viewerContainer"),
  viewer: $("viewer"),
  eventBus,
  linkService,
});
linkService.setViewer(pdfViewer);

function showMessage(text) {
  const box = $("message");
  box.textContent = text;
  box.hidden = !text;
}

function updatePageInfo() {
  if (!pdfViewer.pagesCount) return;
  $("page-info").textContent = pdfViewer.currentPageNumber + " / " + pdfViewer.pagesCount;
}

eventBus.on("pagesinit", () => {
  pdfViewer.currentScaleValue = "page-width";
  updatePageInfo();
});
eventBus.on("pagechanging", updatePageInfo);

async function load(source, name) {
  showMessage(T("v_loading"));
  try {
    const doc = await pdfjsLib.getDocument({
      ...source,
      cMapUrl: base + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: base + "standard_fonts/",
      wasmUrl: base + "wasm/",
      iccUrl: base + "iccs/",
      isEvalSupported: false,
    }).promise;
    pdfViewer.setDocument(doc);
    linkService.setDocument(doc, null);
    showMessage("");

    let title = name;
    try {
      const meta = await doc.getMetadata();
      if (meta && meta.info && meta.info.Title && meta.info.Title.trim()) title = meta.info.Title.trim();
    } catch (e) {}
    document.title = title || T("v_title");
    $("doc-title").textContent = document.title;
  } catch (e) {
    showMessage(T("v_fail", e && e.message ? e.message : e));
  }
}

/* ---------- 도구 모음 ---------- */
$("zoom-in").addEventListener("click", () => { pdfViewer.currentScale = Math.min(pdfViewer.currentScale * 1.15, 5); });
$("zoom-out").addEventListener("click", () => { pdfViewer.currentScale = Math.max(pdfViewer.currentScale / 1.15, 0.3); });
$("zoom-fit").addEventListener("click", () => { pdfViewer.currentScaleValue = "page-width"; });
$("open-file").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  $("original").hidden = true;
  await load({ data: new Uint8Array(await file.arrayBuffer()) }, file.name);
});

/* ---------- 시작 ---------- */
const fileUrl = new URLSearchParams(location.search).get("file");
if (fileUrl) {
  const original = $("original");
  original.href = fileUrl.split("#")[0] + "#dt-original"; // 원본으로 갈 때는 자동 전환을 건너뜀
  original.hidden = false;
  let name = "";
  try { name = decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() || ""); } catch (e) {}
  load({ url: fileUrl, withCredentials: true }, name);
} else {
  showMessage(T("v_empty"));
}
