/** Returns DOM-measured geometry in CSS pixels relative to each A4 page. */
export function collectLayoutInBrowser() {
  const rect = (element, parentRect) => {
    const value = element.getBoundingClientRect();
    return [
      value.left - parentRect.left,
      value.top - parentRect.top,
      value.width,
      value.height,
    ];
  };
  const layout = { pages: [], questions: [] };
  const questionMap = new Map();

  document.querySelectorAll(".page").forEach((page, pageIndex) => {
    const pageRect = page.getBoundingClientRect();
    layout.pages.push({
      w: pageRect.width,
      h: pageRect.height,
      markers: [...page.querySelectorAll(".mk")].map((marker) => {
        const r = rect(marker, pageRect);
        return [r[0] + r[2] / 2, r[1] + r[3] / 2];
      }),
    });

    page.querySelectorAll(".q").forEach((element) => {
      const id = element.dataset.id;
      let entry = questionMap.get(id);
      if (!entry) {
        entry = {
          question: {
            id,
            type: element.dataset.type,
            page: pageIndex,
            rect: rect(element, pageRect),
            text: [
              element.querySelector(".qt-en")?.textContent.trim(),
              element.querySelector(".qt-ar")?.textContent.trim(),
            ].filter(Boolean).join(" / "),
          },
          fragments: [],
        };
        questionMap.set(id, entry);
        layout.questions.push(entry.question);
      }
      entry.fragments.push({ element, pageIndex, pageRect });
    });
  });

  for (const { question, fragments } of questionMap.values()) {
    if (question.type === "choice") {
      if (fragments.length === 1) {
        // Keep the historical layout shape for ordinary, unsplit questions.
        const { element, pageRect } = fragments[0];
        question.options = [...element.querySelectorAll(".opt")].map((option) => ({
          label: [
            option.querySelector(".opt-en")?.textContent.trim(),
            option.querySelector(".opt-ar")?.textContent.trim(),
          ].filter(Boolean).join(" / "),
          rect: rect(option, pageRect),
        }));
      } else {
        // A split question stores each answer row's page as part of its OMR map.
        question.options = fragments.flatMap(({ element, pageIndex, pageRect }) =>
          [...element.querySelectorAll(".opt")].map((option) => ({
            index: Number(option.dataset.optionIndex),
            page: pageIndex,
            label: [
              option.querySelector(".opt-en")?.textContent.trim(),
              option.querySelector(".opt-ar")?.textContent.trim(),
            ].filter(Boolean).join(" / "),
            rect: rect(option, pageRect),
          }))
        ).sort((a, b) => a.index - b.index);
        question.options.forEach((option) => { delete option.index; });
      }
    } else {
      const { element, pageRect } = fragments[0];
      const field = element.querySelector(".tb");
      if (!field) throw new Error(`حقل الإجابة غير موجود للسؤال ${question.id}.`);
      question.field = rect(field, pageRect);
    }
  }
  return layout;
}

/**
 * Convert measured CSS-pixel geometry to the exact pixel dimensions of the
 * PNG screenshots. An option is scaled against the page it belongs to; this
 * matters when a single question continues onto more than one A4 page.
 */
export function scaleLayoutToPng(layout, dimensionsByPage) {
  const scaleRect = (rect, scaleX, scaleY) => [
    Math.round(rect[0] * scaleX),
    Math.round(rect[1] * scaleY),
    Math.round(rect[2] * scaleX),
    Math.round(rect[3] * scaleY),
  ];

  const scales = layout.pages.map((page, pageIndex) => {
    const { width, height } = dimensionsByPage[pageIndex];
    const scaleX = width / page.w;
    const scaleY = height / page.h;
    page.markers = page.markers.map(([x, y]) => [
      Math.round(x * scaleX),
      Math.round(y * scaleY),
    ]);
    page.w = width;
    page.h = height;
    return { scaleX, scaleY };
  });

  for (const question of layout.questions) {
    const questionScale = scales[question.page];
    question.rect = scaleRect(question.rect, questionScale.scaleX, questionScale.scaleY);
    if (Object.hasOwn(question, "field")) {
      question.field = scaleRect(question.field, questionScale.scaleX, questionScale.scaleY);
    }
    for (const option of question.options || []) {
      const optionScale = scales[option.page ?? question.page];
      option.rect = scaleRect(option.rect, optionScale.scaleX, optionScale.scaleY);
    }
  }
  return layout;
}
