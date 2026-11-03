import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQuestions,
  resolveSection,
  resolveTitle,
  textPair,
  validateSurvey,
} from "../src/normalize.js";

test("textPair preserves bilingual English and Arabic values", () => {
  assert.deepEqual(textPair(undefined, "Age", "العمر"), ["Age", "العمر"]);
});

test("textPair places plain Arabic text in the Arabic column", () => {
  assert.deepEqual(textPair("المعلومات الديموغرافية"), ["", "المعلومات الديموغرافية"]);
});

test("title and section helpers resolve bilingual labels", () => {
  assert.deepEqual(resolveTitle({ title_en: "Survey", title_ar: "استبيان" }), ["Survey", "استبيان"]);
  assert.deepEqual(resolveSection({ name_en: "Profile", name_ar: "البيانات" }), ["Profile", "البيانات"]);
});

test("normalizeQuestions retains the parent section for nested questions", () => {
  const section = {
    id: "profile",
    title_en: "Profile",
    title_ar: "البيانات",
    questions: [{ id: "age", type: "choice", options: [{ en: "Adult", ar: "بالغ" }] }],
  };
  const entries = normalizeQuestions({ sections: [section] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0][0].id, "age");
  assert.equal(entries[0][1], section);
});

test("validateSurvey accepts valid choice and text questions", () => {
  const survey = {
    questions: [
      { id: "age", type: "choice", options: [{ en: "18+", ar: "18+" }] },
      { id: "comment", type: "text", height_mm: 30 },
    ],
  };
  assert.equal(validateSurvey(survey).length, 2);
});

test("validateSurvey rejects duplicate question IDs", () => {
  const survey = {
    questions: [
      { id: "same", type: "choice", options: [{ en: "A", ar: "أ" }] },
      { id: "same", type: "choice", options: [{ en: "B", ar: "ب" }] },
    ],
  };
  assert.throws(() => validateSurvey(survey), /فريدة/);
});

test("validateSurvey rejects malformed options", () => {
  assert.throws(
    () => validateSurvey({ questions: [{ id: "q1", type: "choice", options: "not-an-array" }] }),
    /مصفوفة/,
  );
});
