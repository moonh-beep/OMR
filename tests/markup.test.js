import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDocument } from "../src/markup.js";

const survey = {
  title_en: "Survey <One>",
  title_ar: "استبيان & اختبار",
  layout_settings: {
    surveyTitleUnderline: true,
    sectionTitleUnderline: false,
    surveyTitleDivider: false,
    sectionTitleDivider: false,
    bodyBold: true,
    surveyTitleFontPt: 12,
    sectionTitleFontPt: 11,
  },
  sections: [{
    id: "profile",
    title_en: "Profile",
    title_ar: "البيانات",
    questions: [{
      id: "age",
      type: "choice",
      text_en: "Age <18?",
      text_ar: "العمر؟",
      options: [{ en: "Yes & No", ar: "نعم أو لا" }],
    }],
  }],
};

test("buildDocument escapes user-provided text", async () => {
  const html = await buildDocument(survey);
  assert.match(html, /Survey &lt;One&gt;/);
  assert.match(html, /استبيان &amp; اختبار/);
  assert.match(html, /Age &lt;18\?/);
  assert.doesNotMatch(html, /<One>/);
});

test("buildDocument sets independent typography and divider switches", async () => {
  const html = await buildDocument(survey);
  assert.match(
    html,
    /class="survey-document hd-title-underline section-title-no-underline hd-no-divider section-title-no-divider body-bold"/,
  );
  assert.match(html, /--survey-title-font-size:12pt/);
  assert.match(html, /--section-title-font-size:11pt/);
});

test("CSS divider switches target the title elements that draw the borders", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.survey-document\.hd-no-divider\s+\.hd\s*\{\s*border-bottom:\s*0/);
  assert.match(css, /\.survey-document\.section-title-no-divider\s+\.section-title\s*\{\s*border-bottom:\s*0/);
});

test("each question and its options are generated in one article", async () => {
  const html = await buildDocument(survey);
  assert.match(html, /<article class="q" data-id="age"[^>]*>[\s\S]*?<div class="opts">[\s\S]*?<\/article>/);
  assert.equal((html.match(/data-omr-option="true"/g) || []).length, 1);
});
