import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../web/app.css", import.meta.url), "utf8");

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
  assert.match(html, /<details class="json-editor">[\\s\\S]*?<textarea id="survey-json"/);
});

test("preview remains available and the page is declared right-to-left", () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<section class="preview-panel"/);
  assert.match(html, /<iframe id="preview"/);
  assert.match(html, /aria-live="polite"/);
});

test("responsive layouts cover tablet and mobile widths", () => {
  assert.match(css, /@media\\s*\\(max-width:\\s*940px\\)/);
  assert.match(css, /@media\\s*\\(max-width:\\s*620px\\)/);
  assert.match(css, /grid-template-columns:\\s*1fr/);
});
