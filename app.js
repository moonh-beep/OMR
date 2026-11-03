const editor = document.getElementById("survey-json");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("preview-empty");
const outputs = document.getElementById("outputs");
const previewButton = document.getElementById("preview-button");
const generateButton = document.getElementById("generate-button");
const fileInput = document.getElementById("file-input");

const fontRange = document.getElementById("question-font-range");
const fontNumber = document.getElementById("question-font-value");
const marginRange = document.getElementById("page-margin-range");
const marginNumber = document.getElementById("page-margin-value");

const DEFAULT_LAYOUT = Object.freeze({ questionFontPt: 13, pageMarginMm: 20 });

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function setLayoutControls(settings = {}) {
  const font = clamp(settings.questionFontPt, 9, 18, DEFAULT_LAYOUT.questionFontPt);
  const margin = clamp(settings.pageMarginMm, 12, 30, DEFAULT_LAYOUT.pageMarginMm);
  fontRange.value = String(font);
  fontNumber.value = String(font);
  marginRange.value = String(margin);
  marginNumber.value = String(margin);
}

function bindSettingPair(range, number, min, max, fallback) {
  range.addEventListener("input", () => {
    number.value = range.value;
  });

  number.addEventListener("input", () => {
    if (number.value.trim() === "") return;
    const value = Number(number.value);
    if (Number.isFinite(value)) {
      range.value = String(clamp(value, min, max, fallback));
    }
  });

  number.addEventListener("change", () => {
    const value = clamp(number.value, min, max, fallback);
    number.value = String(value);
    range.value = String(value);
  });
}

bindSettingPair(fontRange, fontNumber, 9, 18, DEFAULT_LAYOUT.questionFontPt);
bindSettingPair(marginRange, marginNumber, 12, 30, DEFAULT_LAYOUT.pageMarginMm);

async function loadSample() {
  const response = await fetch("/api/survey", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("تعذر تحميل ملف المثال.");
  }

  const survey = await response.json();
  editor.value = JSON.stringify(survey, null, 2);
  setLayoutControls(survey.layout_settings || DEFAULT_LAYOUT);
}

function readSurvey() {
  let survey;
  try {
    survey = JSON.parse(editor.value);
  } catch (error) {
    throw new Error(`JSON غير صالح: ${error.message}`);
  }
  survey.layout_settings = {
    questionFontPt: clamp(fontNumber.value, 9, 18, DEFAULT_LAYOUT.questionFontPt),
    pageMarginMm: clamp(marginNumber.value, 12, 30, DEFAULT_LAYOUT.pageMarginMm),
  };
  return survey;
}

function setStatus(message, kind = "") {
  status.textContent = message;
  status.className = `status ${kind}`.trim();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error("استجابة غير صالحة من الخادم.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "حدث خطأ أثناء تنفيذ الطلب.");
  }

  return payload;
}

// ==========================================
// تحديث المعاينة
// ==========================================

previewButton.addEventListener("click", async () => {
  try {
    previewButton.disabled = true;
    setStatus("جارٍ قياس عناصر الصفحة وتجهيز المعاينة...");
    const survey = readSurvey();
    const result = await postJson("/api/preview", survey);
    preview.srcdoc = result.html;
    previewEmpty.hidden = true;
    setStatus("تم تحديث المعاينة بنجاح.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    previewButton.disabled = false;
  }
});

// ==========================================
// توليد القالب وتصدير الملفات
// ==========================================

generateButton.addEventListener("click", async () => {
  try {
    generateButton.disabled = true;
    setStatus("جارٍ إنشاء صفحات A4 وقياس الإحداثيات وتصدير الملفات...");
    outputs.hidden = true;
    const survey = readSurvey();
    const result = await postJson("/api/generate", survey);

    const names = [
      ["PDF", "survey.pdf"],
      ["layout.json", "layout.json"],
      ["HTML", "preview.html"],
      ...result.files
        .filter((name) => name.endsWith(".png"))
        .map((name) => [`PNG ${name}`, name]),
    ];

    outputs.replaceChildren(
      ...names.map(([label, file]) => {
        const link = document.createElement("a");
        link.href = `/template/${encodeURIComponent(file)}`;
        link.textContent = label;
        link.target = "_blank";
        link.rel = "noopener";
        return link;
      }),
    );

    outputs.hidden = false;
    setStatus(
      `اكتمل التوليد: ${result.pageCount} صفحة، ${result.questionCount} سؤال.`,
      "success",
    );

    const previewResult = await postJson("/api/preview", survey);
    preview.srcdoc = previewResult.html;
    previewEmpty.hidden = true;
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    generateButton.disabled = false;
  }
});

// ==========================================
// تحميل الاستبيان التجريبي
// ==========================================

document.getElementById("load-sample").addEventListener("click", async () => {
  try {
    await loadSample();
    setStatus("تم تحميل الاستبيان التجريبي.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

// ==========================================
// استيراد ملف JSON خارجي
// ==========================================

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const survey = JSON.parse(text);
    editor.value = JSON.stringify(survey, null, 2);
    setLayoutControls(survey.layout_settings || DEFAULT_LAYOUT);
    setStatus(`تم تحميل الملف ${file.name}.`, "success");
  } catch (error) {
    setStatus(`تعذرت قراءة الملف: ${error.message}`, "error");
  } finally {
    fileInput.value = "";
  }
});

// ==========================================
// تشغيل أولي
// ==========================================

async function initialize() {
  try {
    setLayoutControls(DEFAULT_LAYOUT);
    await loadSample();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    previewButton.click();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

initialize();
