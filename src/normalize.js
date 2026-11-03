const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hasArabic(value) {
  return ARABIC_RE.test(String(value ?? ""));
}

/** Preserve legacy string fields and the bilingual object forms used by the Python generator. */
export function textPair(value = undefined, en = undefined, ar = undefined) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    en = en || value.en || value.text_en || value.label_en;
    ar = ar || value.ar || value.text_ar || value.label_ar;
    if (!en && !ar) {
      const fallback = value.text || value.label || value.value || "";
      if (hasArabic(fallback)) ar = fallback;
      else en = fallback;
    }
  } else if (value !== undefined && value !== null && !en && !ar) {
    if (hasArabic(value)) ar = value;
    else en = value;
  }
  return [String(en || ""), String(ar || "")];
}

export function resolveTitle(survey) {
  return textPair(survey.title, survey.title_en, survey.title_ar);
}

export function resolveSection(section) {
  if (section && typeof section === "object" && !Array.isArray(section)) {
    return textPair(
      section.title ?? section.name,
      section.title_en ?? section.name_en,
      section.title_ar ?? section.name_ar,
    );
  }
  return textPair(section);
}

export function normalizeQuestions(survey) {
  const questions = [];
  const sectionById = new Map();
  for (const section of survey.sections || []) {
    if (section && typeof section === "object" && section.id !== undefined && section.id !== null) {
      sectionById.set(String(section.id), section);
    }
  }

  if ((survey.sections || []).length && !(survey.questions || []).length) {
    for (const section of survey.sections || []) {
      if (!section || typeof section !== "object") continue;
      for (const question of section.questions || []) questions.push([question, section]);
    }
    return questions;
  }

  let lastSectionKey = Symbol("initial-section");
  let activeSection = null;
  for (const question of survey.questions || []) {
    const sectionValue = question.section ?? question.section_id ?? question.section_title;
    let section = null;
    if (sectionValue && typeof sectionValue === "object") {
      section = sectionValue;
    } else if (sectionValue !== undefined && sectionValue !== null) {
      section = sectionById.get(String(sectionValue)) ?? sectionValue;
    } else if (question.section_en || question.section_ar) {
      section = {
        title_en: question.section_en || "",
        title_ar: question.section_ar || "",
      };
    }

    const key = section && typeof section === "object"
      ? stableStringify(section)
      : String(section);
    if (key !== lastSectionKey) {
      activeSection = section;
      lastSectionKey = key;
    }
    questions.push([question, activeSection]);
  }
  return questions;
}

export function validateSurvey(survey) {
  if (!survey || typeof survey !== "object" || Array.isArray(survey)) {
    throw new TypeError("يجب أن يكون محتوى الاستبيان كائناً JSON.");
  }
  const entries = normalizeQuestions(survey);
  if (!entries.length) throw new Error("لا توجد أسئلة في ملف الاستبيان.");
  const ids = entries.map(([q]) => {
    if (!q || typeof q !== "object" || q.id === undefined || q.id === null || String(q.id).trim() === "") {
      throw new Error("كل سؤال يجب أن يحتوي على id غير فارغ.");
    }
    return String(q.id);
  });
  if (new Set(ids).size !== ids.length) throw new Error("معرّفات الأسئلة (id) يجب أن تكون فريدة.");
  for (const [q] of entries) {
    const type = String(q.type || "choice");
    if (type === "choice" && q.options !== undefined && !Array.isArray(q.options)) {
      throw new TypeError(`خيارات السؤال ${q.id} يجب أن تكون مصفوفة.`);
    }
    if (type !== "choice") {
      const h = Number(q.height_mm ?? 20);
      if (!Number.isFinite(h)) throw new TypeError(`height_mm غير صالح في السؤال ${q.id}.`);
    }
  }
  return entries;
}
