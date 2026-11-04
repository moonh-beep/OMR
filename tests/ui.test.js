import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");
const editorJs = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

const requiredIds = [
  "survey-json",
  "status",
  "preview",
  "preview-empty",
  "outputs",
  "preview-button",
  "generate-button",
  "file-input",
  "load-sample",
  "question-font-range",
  "question-font-value",
  "page-margin-range",
  "page-margin-value",
  "survey-title-font-range",
  "survey-title-font-value",
  "section-title-font-range",
  "section-title-font-value",
  "survey-title-en",
  "survey-title-ar",
  "survey-title-visible-toggle",
  "survey-title-bold-toggle",
  "survey-title-alignment",
  "body-bold-toggle",
  "survey-title-underline-toggle",
  "section-title-underline-toggle",
  "survey-title-divider-toggle",
  "section-title-divider-toggle",
  "question-builder-title",
  "question-count",
  "question-list",
  "add-question",
];

test("redesigned interface preserves every JavaScript control ID exactly once", () => {
  for (const id of requiredIds) {
    const matches = html.match(new RegExp(`id=["']${id}["']`, "g")) ?? [];
    assert.equal(matches.length, 1, `Expected one element with id="${id}"`);
  }
});

test("visual settings appear before the optional raw JSON editor", () => {
  const controlsIndex = html.indexOf('class="layout-controls"');
  const rawEditorIndex = html.indexOf('class="json-editor"');
  assert.notEqual(controlsIndex, -1);
  assert.notEqual(rawEditorIndex, -1);
  assert.ok(controlsIndex < rawEditorIndex);
  assert.match(html, /<details class="json-editor">[\s\S]*?<textarea id="survey-json"/);
});

test("preview remains available and the page is declared right-to-left", () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<section class="preview-panel"/);
  assert.match(html, /<iframe id="preview"/);
  assert.match(html, /aria-live="polite"/);
});

test("responsive layouts cover tablet and mobile widths", () => {
  assert.match(css, /@media\s*\(max-width:\s*940px\)/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
});


const appHtml = readFileSync(new URL("../web/app.html", import.meta.url), "utf8");
const reviewHtml = readFileSync(new URL("../review.html", import.meta.url), "utf8");

test("main application provides one coherent four-stage workspace", () => {
  for (const id of [
    "sec-tpl", "sec-up", "sec-review", "sec-res",
    "generator-frame", "review-frame", "page-title", "page-description",
    "template-pages", "template-questions", "processed-sheets",
    "drop", "fin", "fl", "queue-count", "pg", "fresh", "go",
    "clear-files", "pmsg", "rt", "results-search",
    "stat-total", "stat-reviewed", "stat-pending",
    "export-csv", "export-json", "reset-dialog", "fresh-dialog"
  ]) {
    const matches = appHtml.split('id="' + id + '"').length - 1;
    assert.equal(matches, 1, 'Expected one main-app element with id="' + id + '"');
  }
  assert.equal((appHtml.match(/data-t="(tpl|up|review|res)"/g) ?? []).length, 8);
  assert.match(appHtml, /<aside class="sidebar"/);
  assert.match(appHtml, /<nav class="workflow"/);
});

test("main application implements safe batch clearing and disables empty exports", () => {
  assert.match(appHtml, /id="fresh-dialog"/);
  assert.match(appHtml, /id="reset-dialog"/);
  assert.match(appHtml, /aria-disabled/);
  assert.match(appHtml, /async function processFiles/);
  assert.match(appHtml, /remove\.disabled = isProcessing/);
});

test("review workspace keeps all existing interaction IDs and supports narrow screens", () => {
  for (const id of [
    "sheet-list", "reload", "prev", "next", "heading", "counter",
    "notice", "empty", "workbench", "page-images", "question-list",
    "save", "skip", "save-status"
  ]) assert.ok(reviewHtml.includes('id="' + id + '"'), 'Missing review control: ' + id);
  assert.match(reviewHtml, /@media\(max-width:650px\)/);
});

test("integrated generator mode hides its duplicate global header", () => {
  assert.match(html, /classList\.add\("embedded"\)/);
  assert.match(css, /html\.embedded \.topbar\s*\{\s*display:\s*none;/);
});


test("main application and review inline scripts are syntactically valid JavaScript", () => {
  const appScript = appHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const reviewScript = reviewHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(appScript, "Missing main application script");
  assert.ok(reviewScript, "Missing review application script");
  assert.doesNotThrow(() => new Script(appScript, { filename: "web/app.html" }));
  assert.doesNotThrow(() => new Script(reviewScript, { filename: "review.html" }));
});


test("visual question builder supports bilingual CRUD, options, and reordering", () => {
  assert.match(editorJs, /function setQuestionBuilderFromSurvey/);
  assert.match(editorJs, /function syncBuilderToEditor/);
  assert.match(editorJs, /function moveQuestion/);
  assert.match(editorJs, /function duplicateQuestion/);
  assert.match(editorJs, /function removeQuestion/);
  assert.match(editorJs, /إضافة خيار/);
  assert.match(editorJs, /text_en/);
  assert.match(editorJs, /text_ar/);
  assert.match(html, /id="question-builder-title"/);
  assert.match(html, /id="question-list"/);
});

test("visual question builder has keyboard-friendly controls and responsive styles", () => {
  assert.match(appHtml, /aria-live="polite"/);
  assert.match(css, /\.question-item-header/);
  assert.match(css, /\.option-editor-row/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(editorJs, /setAttribute\("aria-label", label\)/);
});

test("editor module script parses without syntax errors", () => {
  assert.doesNotThrow(() => new Script(editorJs, { filename: "web/app.js" }));
});


test("editor order follows survey identity, question content, then print formatting", () => {
  const titleIndex = html.indexOf('class="setting-card title-settings"');
  const questionIndex = html.indexOf('class="question-builder"');
  const layoutIndex = html.indexOf('class="layout-controls"');
  assert.ok(titleIndex >= 0 && titleIndex < questionIndex);
  assert.ok(questionIndex < layoutIndex);
});

test("builder preserves section layout metadata and exports editable source JSON", () => {
  assert.match(editorJs, /sectionSource:/);
  assert.match(editorJs, /item\.section =/);
  assert.match(editorJs, /__survey_json__/);
  assert.match(editorJs, /new Blob\(\[JSON\.stringify\(survey, null, 2\)\]/);
});


test("preview exposes smooth pointer-based drag sorting for whole questions", () => {
  assert.match(html, /id="preview-sort-help"/);
  assert.match(editorJs, /function installPreviewQuestionSorting/);
  assert.match(editorJs, /function updateDropMarker/);
  assert.match(editorJs, /function reorderQuestionsFromPreview/);
  assert.match(editorJs, /pointerdown/);
  assert.match(editorJs, /pointermove/);
  assert.match(editorJs, /pointerup/);
  assert.match(editorJs, /pointercancel/);
  assert.match(editorJs, /touch-action:none/);
  assert.match(editorJs, /\\.page \\.body > \\.q\\[data-id\\]/);
  assert.match(editorJs, /refreshPreviewDocument\\(\\)/);
  assert.match(editorJs, /previewReorderPending/);
});

test("preview question sorting supports keyboard movement and preserves question IDs", () => {
  assert.match(editorJs, /aria-keyshortcuts/);
  assert.match(editorJs, /ArrowUp/);
  assert.match(editorJs, /ArrowDown/);
  assert.match(editorJs, /new Map\\(builderQuestions\\.map\\(question => \\[question\\.id, question\\]\\)\\)/);
  assert.match(editorJs, /uniqueIds\\.size !== currentIds\\.length/);
});
