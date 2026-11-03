import { PAGE } from "./config.js";
import {
  normalizeQuestions,
  resolveSection,
  resolveTitle,
  textPair,
  validateSurvey,
} from "./normalize.js";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(HERE, "../styles.css");

// ==========================================
// HTML escaping
// ==========================================

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

// ==========================================
// Language cells
// ==========================================

function languageCell(en, ar, className) {
  return (
    `<div class="${className}-en en" dir="ltr">${escapeHtml(en)}</div>` +
    `<div class="${className}-ar ar" dir="rtl">${escapeHtml(ar)}</div>`
  );
}

// ==========================================
// Optional layout switches (all default to the current look)
// ==========================================

function layoutOf(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

// question.layout = "row"  -> options laid out horizontally
function isRowLayout(question) {
  return ["row", "horizontal"].includes(layoutOf(question.layout));
}

// section.layout = "stack" -> English title above the Arabic title
function isStackLayout(section) {
  if (!section || typeof section !== "object") return false;
  return ["stack", "stacked", "column", "vertical"].includes(
    layoutOf(section.layout),
  );
}

// ==========================================
// Question generation
// ==========================================

function questionHtml(number, question) {
  const id = escapeHtml(question.id);
  const type = String(question.type || "choice");

  const [en, ar] = textPair(question.text, question.text_en, question.text_ar);

  const numberHtml = `<span class="qnum">${number}.</span>&nbsp;`;

  const heading =
    `<div class="qt">` +
    `<div class="qt-en en" dir="ltr">${numberHtml}${escapeHtml(en)}</div>` +
    `<div class="qt-ar ar" dir="rtl">${numberHtml}${escapeHtml(ar)}</div>` +
    `</div>`;

  let content = "";

  if (type === "choice") {
    const rows = (question.options || [])
      .map((option, index) => {
        const [optionEn, optionAr] = textPair(option);

        return (
          `<div class="opt" data-omr-option="true" data-option-index="${index}">` +
          // العمود الإنجليزي: مربع الاختيار والنص
          `<span class="opt-en en" dir="ltr">` +
          `<span class="opt-check" aria-hidden="true"></span>` +
          `<span class="opt-label">${escapeHtml(optionEn)}</span>` +
          `</span>` +
          // العمود العربي: مربع اختيار مستقل والنص
          `<span class="opt-ar ar" dir="rtl">` +
          `<span class="opt-check opt-check-ar" aria-hidden="true"></span>` +
          `<span class="opt-label">${escapeHtml(optionAr)}</span>` +
          `</span>` +
          `</div>`
        );
      })
      .join("");

    const optionCount = (question.options || []).length;

    if (isRowLayout(question)) {
      // Optional "columns" wraps long lists; default is one column per option.
      const requested = Math.floor(Number(question.columns));
      const columns = Math.max(
        1,
        Math.min(
          8,
          Number.isFinite(requested) && requested > 0
            ? requested
            : optionCount || 1,
        ),
      );

      // English options 1..N on the left, Arabic options 1..N on the right.
      const side = (lang, dir) =>
        (question.options || [])
          .map((option, index) => {
            const text = textPair(option)[lang === "en" ? 0 : 1];

            return (
              `<div class="opt opt-single" data-omr-option="true" ` +
              `data-option-index="${index}" data-lang="${lang}">` +
              `<span class="opt-${lang} ${lang}" dir="${dir}">` +
              `<span class="opt-check" aria-hidden="true"></span>` +
              `<span class="opt-label">${escapeHtml(text)}</span>` +
              `</span>` +
              `</div>`
            );
          })
          .join("");

      content =
        `<div class="opts opts-row" style="--cols:${columns}">` +
        `<div class="opts-side opts-side-en" dir="ltr">${side("en", "ltr")}</div>` +
        `<div class="opts-side opts-side-ar" dir="rtl">${side("ar", "rtl")}</div>` +
        `</div>`;
    } else {
      content = `<div class="opts">${rows}</div>`;
    }
  } else {
    const height = Math.max(5, Math.min(150, Number(question.height_mm ?? 20)));

    content =
      `<div class="tb" data-omr-field="true" ` +
      `style="height:${height}mm"></div>`;
  }

  return (
    `<article class="q" data-id="${id}" data-type="${escapeHtml(type)}">` +
    heading +
    content +
    `</article>`
  );
}

// ==========================================
// Section generation
// ==========================================

function sectionHtml(section) {
  const [en, ar] = resolveSection(section);

  if (!en && !ar) {
    return "";
  }

  const stackClass = isStackLayout(section) ? " section-title-stack" : "";

  return (
    `<div class="section-title${stackClass}">` +
    languageCell(en, ar, "section-title") +
    `</div>`
  );
}

// ==========================================
// Complete document generation
// ==========================================

export async function buildDocument(survey) {
  validateSurvey(survey);

  const [titleEn, titleAr] = resolveTitle(survey);

  const title =
    `<header class="hd">` +
    `<div class="hd-en en" dir="ltr">${escapeHtml(titleEn)}</div>` +
    `<div class="hd-ar ar" dir="rtl">${escapeHtml(titleAr)}</div>` +
    `</header>`;

  const entries = normalizeQuestions(survey);

  const blocks = [title];

  let previousSectionKey = Symbol("first");

  for (let i = 0; i < entries.length; i++) {
    const [question, section] = entries[i];

    if (section !== null && section !== undefined) {
      const key =
        typeof section === "object" ? JSON.stringify(section) : String(section);

      if (key !== previousSectionKey) {
        blocks.push(sectionHtml(section));
        previousSectionKey = key;
      }
    } else {
      previousSectionKey = null;
    }

    blocks.push(questionHtml(i + 1, question));
  }

  const css = await readFile(CSS_PATH, "utf8");

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">

  <title>${escapeHtml(titleEn || titleAr || "Questionnaire")}</title>

  <style>
${css}
  </style>
</head>

<body class="survey-document">

  <main id="measure" aria-label="Questionnaire measurement area">
    ${blocks.join("\n")}
  </main>

  <main id="pages" aria-label="Generated questionnaire pages"></main>

</body>
</html>`;
}

// ==========================================
// Page geometry
// ==========================================

export const pageGeometry = PAGE;
