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
    showSurveyTitle: true,
    surveyTitleBold: false,
    surveyTitleAlignment: "right",
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
  assert.match(html, /--survey-title-font-weight:400/);
  assert.match(html, /--survey-title-text-align:right/);
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


test("survey title can be removed completely without leaving an empty header", async () => {
  const hiddenSurvey = {
    ...survey,
    layout_settings: { ...survey.layout_settings, showSurveyTitle: false },
  };
  const html = await buildDocument(hiddenSurvey);
  assert.doesNotMatch(html, /<header class="hd/);
  assert.match(html, /class="survey-document[^"]*"/);
});

test("a single-language title expands across the full title width", async () => {
  const englishOnly = {
    ...survey,
    title_ar: "",
    layout_settings: { ...survey.layout_settings, showSurveyTitle: true },
  };
  const html = await buildDocument(englishOnly);
  assert.match(html, /<header class="hd hd-single-title">/);
  assert.match(html, /<div class="hd-en en" dir="ltr">Survey &lt;One&gt;<\/div>/);
  assert.doesNotMatch(html, /class="hd-ar/);
});

test("buildDocument preserves manual question page coordinates for pagination and export", async () => {
  const positionedSurvey = {
    ...survey,
    sections: [{
      ...survey.sections[0],
      questions: [{
        ...survey.sections[0].questions[0],
        print_position: { page: 1, x_mm: 4.5, y_mm: 9.25, width_mm: 165 },
      }],
    }],
  };
  const html = await buildDocument(positionedSurvey);
  assert.match(
    html,
    /class="q manual-position" data-id="age" data-type="choice" data-position-page="1" data-position-x-mm="4\.5" data-position-y-mm="9\.25" data-position-width-mm="165"/,
  );
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.q\.manual-position\s*\{\s*position:\s*absolute/);
});

test("title remains visible by default for existing survey JSON files", async () => {
  const legacySurvey = { ...survey, layout_settings: {} };
  const html = await buildDocument(legacySurvey);
  assert.match(html, /<header class="hd">/);
});
