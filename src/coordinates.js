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
      const question = {
        id: element.dataset.id,
        type: element.dataset.type,
        page: pageIndex,
        rect: rect(element, pageRect),
        text: [
          element.querySelector(".qt-en")?.textContent.trim(),
          element.querySelector(".qt-ar")?.textContent.trim(),
        ].filter(Boolean).join(" / "),
      };
      if (element.dataset.type === "choice") {
        question.options = [...element.querySelectorAll(".opt")].map((option) => ({
          label: [
            option.querySelector(".opt-en")?.textContent.trim(),
            option.querySelector(".opt-ar")?.textContent.trim(),
          ].filter(Boolean).join(" / "),
          rect: rect(option, pageRect),
        }));
      } else {
        const field = element.querySelector(".tb");
        if (!field) throw new Error(`حقل الإجابة غير موجود للسؤال ${question.id}.`);
        question.field = rect(field, pageRect);
      }
      layout.questions.push(question);
    });
  });
  return layout;
}

/**
 * Convert measured CSS-pixel geometry to the exact pixel dimensions of the
 * PNG screenshots. This mirrors the old generator's x/y/w/h and center-point
 * representation while using the actual PNG dimensions rather than a DPI guess.
 */
export function scaleLayoutToPng(layout, dimensionsByPage) {
  layout.pages.forEach((page, pageIndex) => {
    const { width, height } = dimensionsByPage[pageIndex];
    const scaleX = width / page.w;
    const scaleY = height / page.h;
    const scaleRect = (rect) => [
      Math.round(rect[0] * scaleX),
      Math.round(rect[1] * scaleY),
      Math.round(rect[2] * scaleX),
      Math.round(rect[3] * scaleY),
    ];
    page.markers = page.markers.map(([x, y]) => [Math.round(x * scaleX), Math.round(y * scaleY)]);
    page.w = width;
    page.h = height;
    for (const question of layout.questions) {
      if (question.page !== pageIndex) continue;
      question.rect = scaleRect(question.rect);
      if (Object.hasOwn(question, "field")) question.field = scaleRect(question.field);
      for (const option of question.options || []) option.rect = scaleRect(option.rect);
    }
  });
  return layout;
}
