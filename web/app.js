const editor = document.getElementById("survey-json");
const status = document.getElementById("status");
const preview = document.getElementById("preview");
const previewEmpty = document.getElementById("preview-empty");
const outputs = document.getElementById("outputs");
const previewButton = document.getElementById("preview-button");
const generateButton = document.getElementById("generate-button");
const fileInput = document.getElementById("file-input");
let surveyDownloadUrl = null;

const fontRange = document.getElementById("question-font-range");
const fontNumber = document.getElementById("question-font-value");
const marginRange = document.getElementById("page-margin-range");
const marginNumber = document.getElementById("page-margin-value");
const surveyTitleFontRange = document.getElementById("survey-title-font-range");
const surveyTitleFontNumber = document.getElementById("survey-title-font-value");
const sectionTitleFontRange = document.getElementById("section-title-font-range");
const sectionTitleFontNumber = document.getElementById("section-title-font-value");
const surveyTitleEnInput = document.getElementById("survey-title-en");
const surveyTitleArInput = document.getElementById("survey-title-ar");
const surveyTitleVisibleToggle = document.getElementById("survey-title-visible-toggle");
const surveyTitleBoldToggle = document.getElementById("survey-title-bold-toggle");
const surveyTitleAlignmentSelect = document.getElementById("survey-title-alignment");

const bodyBoldToggle = document.getElementById("body-bold-toggle");
const surveyTitleUnderlineToggle = document.getElementById("survey-title-underline-toggle");
const sectionTitleUnderlineToggle = document.getElementById("section-title-underline-toggle");
const surveyTitleDividerToggle = document.getElementById("survey-title-divider-toggle");
const sectionTitleDividerToggle = document.getElementById("section-title-divider-toggle");

const DEFAULT_LAYOUT = Object.freeze({
  questionFontPt: 13,
  pageMarginMm: 20,
  surveyTitleFontPt: 12,
  sectionTitleFontPt: 12,
  showSurveyTitle: true,
  surveyTitleBold: true,
  surveyTitleAlignment: "center",
  bodyBold: false,
  surveyTitleUnderline: false,
  sectionTitleUnderline: true,
  surveyTitleDivider: true,
  sectionTitleDivider: true,
});

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function setLayoutControls(settings = {}) {
  const font = clamp(settings.questionFontPt, 9, 18, DEFAULT_LAYOUT.questionFontPt);
  const margin = clamp(settings.pageMarginMm, 18, 30, DEFAULT_LAYOUT.pageMarginMm);
  const surveyTitleFont = clamp(settings.surveyTitleFontPt, 9, 22, DEFAULT_LAYOUT.surveyTitleFontPt);
  const sectionTitleFont = clamp(settings.sectionTitleFontPt, 9, 22, DEFAULT_LAYOUT.sectionTitleFontPt);

  fontRange.value = String(font);
  fontNumber.value = String(font);
  marginRange.value = String(margin);
  marginNumber.value = String(margin);
  surveyTitleFontRange.value = String(surveyTitleFont);
  surveyTitleFontNumber.value = String(surveyTitleFont);
  sectionTitleFontRange.value = String(sectionTitleFont);
  sectionTitleFontNumber.value = String(sectionTitleFont);

  surveyTitleVisibleToggle.checked = settings.showSurveyTitle !== false;
  surveyTitleBoldToggle.checked = settings.surveyTitleBold !== false;
  surveyTitleAlignmentSelect.value = ["left", "center", "right"].includes(settings.surveyTitleAlignment)
    ? settings.surveyTitleAlignment
    : DEFAULT_LAYOUT.surveyTitleAlignment;

  bodyBoldToggle.checked = settings.bodyBold === true;
  surveyTitleUnderlineToggle.checked = settings.surveyTitleUnderline === true;
  sectionTitleUnderlineToggle.checked = settings.sectionTitleUnderline !== false;
  surveyTitleDividerToggle.checked = settings.surveyTitleDivider !== false;
  sectionTitleDividerToggle.checked = settings.sectionTitleDivider !== false;
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
bindSettingPair(marginRange, marginNumber, 18, 30, DEFAULT_LAYOUT.pageMarginMm);
bindSettingPair(surveyTitleFontRange, surveyTitleFontNumber, 9, 22, DEFAULT_LAYOUT.surveyTitleFontPt);
bindSettingPair(sectionTitleFontRange, sectionTitleFontNumber, 9, 22, DEFAULT_LAYOUT.sectionTitleFontPt);

function resolveSurveyTitleFields(survey = {}) {
  let en = String(survey.title_en ?? "");
  let ar = String(survey.title_ar ?? "");
  const legacy = survey.title;

  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    en ||= String(legacy.en || legacy.text_en || legacy.label_en || "");
    ar ||= String(legacy.ar || legacy.text_ar || legacy.label_ar || "");
    if (!en && !ar) {
      const fallback = String(legacy.text || legacy.label || legacy.value || "");
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(fallback)) ar = fallback;
      else en = fallback;
    }
  } else if (legacy != null && !en && !ar) {
    const fallback = String(legacy);
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(fallback)) ar = fallback;
    else en = fallback;
  }

  return { en, ar };
}

function setSurveyTitleFields(survey) {
  const title = resolveSurveyTitleFields(survey);
  surveyTitleEnInput.value = title.en;
  surveyTitleArInput.value = title.ar;
}

const questionList = document.getElementById("question-list");
const questionCount = document.getElementById("question-count");
const addQuestionButton = document.getElementById("add-question");
let builderQuestions = [];

function pairText(value, en = "", ar = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    en = en || value.en || value.text_en || value.label_en || "";
    ar = ar || value.ar || value.text_ar || value.label_ar || "";
    if (!en && !ar) {
      const fallback = value.text || value.label || value.value || "";
      if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(fallback))) ar = fallback;
      else en = fallback;
    }
  } else if (value != null && !en && !ar) {
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(value))) ar = value;
    else en = value;
  }
  return { en: String(en || ""), ar: String(ar || "") };
}

function questionSection(question, sectionMap, nestedSection = null) {
  let section = nestedSection;
  if (!section) {
    const reference = question.section ?? question.section_id ?? question.section_title;
    if (reference && typeof reference === "object") section = reference;
    else if (reference != null) section = sectionMap.get(String(reference)) ?? reference;
  }
  if (!section && (question.section_en || question.section_ar)) {
    section = { title_en: question.section_en || "", title_ar: question.section_ar || "" };
  }
  return section;
}

function setQuestionBuilderFromSurvey(survey = {}) {
  const sectionMap = new Map();
  for (const section of survey.sections || []) {
    if (section && typeof section === "object" && section.id != null) {
      sectionMap.set(String(section.id), section);
    }
  }
  let entries = [];
  if (Array.isArray(survey.questions) && survey.questions.length) {
    entries = survey.questions.map(question => [question, questionSection(question, sectionMap)]);
  } else {
    entries = (survey.sections || []).flatMap(section =>
      (section?.questions || []).map(question => [question, section])
    );
  }

  builderQuestions = entries.filter(([question]) => question && typeof question === "object").map(([question, section], index) => {
    const prompt = pairText(question.text, question.text_en, question.text_ar);
    const sectionTitle = pairText(
      section && typeof section === "object" ? (section.title ?? section.name) : section,
      section?.title_en ?? section?.name_en ?? question.section_en ?? "",
      section?.title_ar ?? section?.name_ar ?? question.section_ar ?? ""
    );
    return {
      id: String(question.id ?? ("question_" + (index + 1))),
      type: question.type === "text" ? "text" : "choice",
      text_en: prompt.en,
      text_ar: prompt.ar,
      section_en: sectionTitle.en,
      section_ar: sectionTitle.ar,
      height_mm: clamp(question.height_mm, 5, 150, 20),
      source: { ...question },
      options: (Array.isArray(question.options) ? question.options : []).map(option => {
        const pair = pairText(option);
        return {
          en: pair.en,
          ar: pair.ar,
          source: option && typeof option === "object" ? { ...option } : {}
        };
      })
    };
  });
  renderQuestionBuilder();
}

function nextQuestionId() {
  let index = 1;
  while (builderQuestions.some(question => question.id === "question_" + index)) index++;
  return "question_" + index;
}

function syncBuilderToEditor() {
  let survey;
  try {
    survey = JSON.parse(editor.value || "{}");
  } catch {
    survey = {};
  }
  survey.questions = builderQuestions.map(question => {
    const item = { ...question.source, id: question.id, type: question.type };
    delete item.text;
    delete item.section;
    delete item.section_id;
    delete item.section_title;
    item.text_en = question.text_en;
    item.text_ar = question.text_ar;
    if (question.section_en || question.section_ar) {
      item.section_en = question.section_en;
      item.section_ar = question.section_ar;
    } else {
      delete item.section_en;
      delete item.section_ar;
    }
    if (question.type === "choice") {
      item.options = question.options.map(option => {
        const output = { ...option.source, en: option.en, ar: option.ar };
        delete output.text;
        delete output.text_en;
        delete output.text_ar;
        delete output.label;
        delete output.label_en;
        delete output.label_ar;
        delete output.value;
        return output;
      });
      delete item.height_mm;
    } else {
      delete item.options;
      item.height_mm = question.height_mm;
    }
    return item;
  });
  delete survey.sections;
  editor.value = JSON.stringify(survey, null, 2);
}

function createQuestionField(labelText, value, direction, onInput, options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "question-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const control = options.multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  if (!options.multiline) control.type = options.type || "text";
  if (options.min != null) control.min = String(options.min);
  if (options.max != null) control.max = String(options.max);
  if (options.step != null) control.step = String(options.step);
  control.value = String(value ?? "");
  control.dir = direction || "auto";
  control.placeholder = options.placeholder || "";
  if (options.multiline) control.rows = options.rows || 2;
  control.addEventListener("input", () => onInput(control.value));
  wrapper.append(label, control);
  return wrapper;
}

function createQuestionTool(label, symbol, handler, danger = false, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "question-tool" + (danger ? " danger" : "");
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.addEventListener("click", handler);
  return button;
}

function renderQuestionBuilder() {
  questionList.replaceChildren();
  questionCount.textContent = builderQuestions.length + " سؤال";
  if (!builderQuestions.length) {
    const empty = document.createElement("div");
    empty.className = "question-empty";
    empty.textContent = "لا توجد أسئلة في الاستبيان بعد. أضف سؤالك الأول للبدء.";
    questionList.append(empty);
    return;
  }

  builderQuestions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = "question-item";

    const heading = document.createElement("div");
    heading.className = "question-item-header";
    const number = document.createElement("span");
    number.className = "question-index";
    number.textContent = String(index + 1);
    const id = document.createElement("span");
    id.className = "question-id";
    id.textContent = "ID: " + question.id;
    const tools = document.createElement("div");
    tools.className = "question-tools";
    tools.append(
      createQuestionTool("نقل السؤال للأعلى", "↑", () => moveQuestion(index, -1), false, index === 0),
      createQuestionTool("نقل السؤال للأسفل", "↓", () => moveQuestion(index, 1), false, index === builderQuestions.length - 1),
      createQuestionTool("نسخ السؤال", "▢", () => duplicateQuestion(index)),
      createQuestionTool("حذف السؤال", "×", () => removeQuestion(index), true)
    );
    heading.append(number, id, tools);

    const fields = document.createElement("div");
    fields.className = "question-fields";
    fields.append(
      createQuestionField("نص السؤال بالعربية", question.text_ar, "rtl", value => { question.text_ar = value; syncBuilderToEditor(); }, { multiline: true, placeholder: "اكتب نص السؤال بالعربية" }),
      createQuestionField("Question text in English", question.text_en, "ltr", value => { question.text_en = value; syncBuilderToEditor(); }, { multiline: true, placeholder: "Write the question in English" }),
      createQuestionField("عنوان القسم بالعربية (اختياري)", question.section_ar, "rtl", value => { question.section_ar = value; syncBuilderToEditor(); }, { placeholder: "مثال: البيانات الشخصية" }),
      createQuestionField("Section title in English (optional)", question.section_en, "ltr", value => { question.section_en = value; syncBuilderToEditor(); }, { placeholder: "e.g. Personal information" })
    );

    const typeField = document.createElement("div");
    typeField.className = "question-type-field";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "نوع السؤال";
    const typeSelect = document.createElement("select");
    typeSelect.className = "question-type-select";
    [["choice", "اختيار من متعدد"], ["text", "إجابة نصية"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      typeSelect.append(option);
    });
    typeSelect.value = question.type;
    typeSelect.addEventListener("change", () => {
      question.type = typeSelect.value;
      if (question.type === "choice" && !question.options.length) {
        question.options = [
          { en: "Option 1", ar: "الخيار 1", source: {} },
          { en: "Option 2", ar: "الخيار 2", source: {} }
        ];
      }
      syncBuilderToEditor();
      renderQuestionBuilder();
    });
    typeField.append(typeLabel, typeSelect);
    fields.append(typeField);

    card.append(heading, fields);

    if (question.type === "choice") {
      const optionsSection = document.createElement("div");
      optionsSection.className = "question-subsection";
      const optionsHeading = document.createElement("div");
      optionsHeading.className = "question-subsection-heading";
      const optionsTitle = document.createElement("strong");
      optionsTitle.textContent = "خيارات الإجابة";
      const optionsHint = document.createElement("small");
      optionsHint.textContent = "اكتب المقابل العربي والإنجليزي لكل خيار";
      optionsHeading.append(optionsTitle, optionsHint);
      const optionsList = document.createElement("div");
      optionsList.className = "option-editor-list";

      question.options.forEach((option, optionIndex) => {
        const row = document.createElement("div");
        row.className = "option-editor-row";
        const optionNumber = document.createElement("span");
        optionNumber.className = "option-index";
        optionNumber.textContent = String(optionIndex + 1);
        const english = document.createElement("input");
        english.type = "text";
        english.dir = "ltr";
        english.placeholder = "English option";
        english.setAttribute("aria-label", "الخيار " + (optionIndex + 1) + " بالإنجليزية");
        english.value = option.en;
        english.addEventListener("input", () => { option.en = english.value; syncBuilderToEditor(); });
        const arabic = document.createElement("input");
        arabic.type = "text";
        arabic.dir = "rtl";
        arabic.placeholder = "الخيار بالعربية";
        arabic.setAttribute("aria-label", "الخيار " + (optionIndex + 1) + " بالعربية");
        arabic.value = option.ar;
        arabic.addEventListener("input", () => { option.ar = arabic.value; syncBuilderToEditor(); });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "option-remove";
        remove.textContent = "×";
        remove.title = "حذف الخيار";
        remove.setAttribute("aria-label", "حذف الخيار " + (optionIndex + 1));
        remove.addEventListener("click", () => {
          question.options.splice(optionIndex, 1);
          syncBuilderToEditor();
          renderQuestionBuilder();
        });
        row.append(optionNumber, english, arabic, remove);
        optionsList.append(row);
      });

      const addOption = document.createElement("button");
      addOption.type = "button";
      addOption.className = "add-option";
      addOption.textContent = "＋ إضافة خيار";
      addOption.addEventListener("click", () => {
        const next = question.options.length + 1;
        question.options.push({ en: "Option " + next, ar: "الخيار " + next, source: {} });
        syncBuilderToEditor();
        renderQuestionBuilder();
      });
      optionsSection.append(optionsHeading, optionsList, addOption);
      card.append(optionsSection);
    } else {
      const responseSection = document.createElement("div");
      responseSection.className = "question-subsection";
      const responseField = createQuestionField(
        "ارتفاع مساحة الإجابة",
        question.height_mm,
        "ltr",
        value => { question.height_mm = clamp(value, 5, 150, 20); syncBuilderToEditor(); },
        { type: "number", min: 5, max: 150 }
      );
      const note = document.createElement("p");
      note.className = "text-question-note";
      note.textContent = "لن يستخرج محرك OMR الإجابة المكتوبة تلقائياً؛ تُراجع وتُدخل يدوياً بعد مسح الورقة.";
      responseSection.append(responseField, note);
      card.append(responseSection);
    }

    questionList.append(card);
  });
}

function moveQuestion(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= builderQuestions.length) return;
  [builderQuestions[index], builderQuestions[target]] = [builderQuestions[target], builderQuestions[index]];
  syncBuilderToEditor();
  renderQuestionBuilder();
}
function removeQuestion(index) {
  builderQuestions.splice(index, 1);
  syncBuilderToEditor();
  renderQuestionBuilder();
}
function duplicateQuestion(index) {
  const original = builderQuestions[index];
  if (!original) return;
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = nextQuestionId();
  builderQuestions.splice(index + 1, 0, copy);
  syncBuilderToEditor();
  renderQuestionBuilder();
}
addQuestionButton.addEventListener("click", () => {
  const number = builderQuestions.length + 1;
  builderQuestions.push({
    id: nextQuestionId(),
    type: "choice",
    text_en: "",
    text_ar: "",
    section_en: "",
    section_ar: "",
    height_mm: 20,
    source: {},
    options: [
      { en: "Option 1", ar: "الخيار 1", source: {} },
      { en: "Option 2", ar: "الخيار 2", source: {} }
    ]
  });
  syncBuilderToEditor();
  renderQuestionBuilder();
});

editor.addEventListener("input", () => {
  try {
    const survey = JSON.parse(editor.value);
    setSurveyTitleFields(survey);
    setLayoutControls(survey.layout_settings || DEFAULT_LAYOUT);
  } catch {
    // Keep the last valid controls while the user is editing incomplete JSON.
  }
});
editor.addEventListener("change", () => {
  try { setQuestionBuilderFromSurvey(JSON.parse(editor.value)); } catch { /* keep the last valid question list */ }
});

async function loadSample() {
  const response = await fetch("/api/survey", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("تعذر تحميل ملف المثال.");
  }

  const survey = await response.json();
  editor.value = JSON.stringify(survey, null, 2);
  setSurveyTitleFields(survey);
  setLayoutControls(survey.layout_settings || DEFAULT_LAYOUT);
  setQuestionBuilderFromSurvey(survey);
}

function readSurvey() {
  let survey;
  try {
    survey = JSON.parse(editor.value);
  } catch (error) {
    throw new Error(`JSON غير صالح: ${error.message}`);
  }
  const layoutSettings = {
    questionFontPt: clamp(fontNumber.value, 9, 18, DEFAULT_LAYOUT.questionFontPt),
    pageMarginMm: clamp(marginNumber.value, 18, 30, DEFAULT_LAYOUT.pageMarginMm),
    surveyTitleFontPt: clamp(surveyTitleFontNumber.value, 9, 22, DEFAULT_LAYOUT.surveyTitleFontPt),
    sectionTitleFontPt: clamp(sectionTitleFontNumber.value, 9, 22, DEFAULT_LAYOUT.sectionTitleFontPt),
    showSurveyTitle: surveyTitleVisibleToggle.checked,
    surveyTitleBold: surveyTitleBoldToggle.checked,
    surveyTitleAlignment: surveyTitleAlignmentSelect.value,
    bodyBold: bodyBoldToggle.checked,
    surveyTitleUnderline: surveyTitleUnderlineToggle.checked,
    sectionTitleUnderline: sectionTitleUnderlineToggle.checked,
    surveyTitleDivider: surveyTitleDividerToggle.checked,
    sectionTitleDivider: sectionTitleDividerToggle.checked,
  };
  setLayoutControls(layoutSettings);
  survey.title_en = surveyTitleEnInput.value.trim();
  survey.title_ar = surveyTitleArInput.value.trim();
  delete survey.title;
  survey.layout_settings = layoutSettings;
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
      ["survey.json", "__survey_json__"],
      ...result.files
        .filter((name) => name.endsWith(".png"))
        .map((name) => [`PNG ${name}`, name]),
    ];

    outputs.replaceChildren(
      ...names.map(([label, file]) => {
        const link = document.createElement("a");
        if (file === "__survey_json__") {
          if (surveyDownloadUrl) URL.revokeObjectURL(surveyDownloadUrl);
          surveyDownloadUrl = URL.createObjectURL(new Blob([JSON.stringify(survey, null, 2)], { type: "application/json;charset=utf-8" }));
          link.href = surveyDownloadUrl;
          link.download = "survey.json";
        } else {
          link.href = `/template/${encodeURIComponent(file)}`;
          link.target = "_blank";
          link.rel = "noopener";
        }
        link.textContent = label;
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
    setSurveyTitleFields(survey);
    setLayoutControls(survey.layout_settings || DEFAULT_LAYOUT);
    setQuestionBuilderFromSurvey(survey);
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
