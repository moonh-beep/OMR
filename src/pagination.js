/**
 * Runs inside Chromium after all fonts have loaded. Pagination uses measured
 * DOM rectangles (including margins), not text-length estimates.
 */
export function paginateInBrowser() {
  const measure = document.getElementById("measure");
  const root = document.getElementById("pages");
  if (!measure || !root) throw new Error("مناطق القياس أو الصفحات غير موجودة.");

  const mmToCssPx = 96 / 25.4;
  const bodyStyle = getComputedStyle(document.body);
  const pageMarginMm = Number.parseFloat(bodyStyle.getPropertyValue("--page-margin")) || 20;
  const bodyTopMm = pageMarginMm + 4;
  const bodyBottomMm = pageMarginMm + 3;
  const availableHeight = (297 - bodyTopMm - bodyBottomMm) * mmToCssPx;
  const allElements = [...measure.children];
  const manualQuestions = allElements.filter((element) =>
    element.classList.contains("q") &&
    Number.isInteger(Number(element.dataset.positionPage)) &&
    Number(element.dataset.positionPage) >= 0
  );
  const manualQuestionSet = new Set(manualQuestions);
  const manualHeadings = new Map();
  for (const question of manualQuestions) {
    const index = allElements.indexOf(question);
    const heading = index > 0 ? allElements[index - 1] : null;
    if (heading?.classList.contains("section-title")) {
      manualHeadings.set(question, heading);
      manualQuestionSet.add(heading);
    }
  }
  const elements = allElements.filter((element) => !manualQuestionSet.has(element));
  const pages = [];
  let current = [];
  let used = 0;
  const outerHeight = (element) => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height +
      (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0);
  };
  const addPage = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    let group = [element];
    if (
      element.classList.contains("section-title") &&
      elements[index + 1]?.classList.contains("q") &&
      !manualQuestionSet.has(elements[index + 1])
    ) {
      const combined = outerHeight(element) + outerHeight(elements[index + 1]);
      if (combined <= availableHeight) {
        group = [element, elements[index + 1]];
        index++;
      }
    }

    const height = group.reduce((sum, node) => sum + outerHeight(node), 0);
    if (height > availableHeight + 0.5) {
      const label = group.find((node) => node.classList.contains("q"))?.dataset.id || "غير معروف";
      throw new Error(`السؤال ${label} أطول من المساحة القابلة للطباعة في صفحة واحدة؛ اختصره أو قلّل محتواه. لا يتم تقسيم السؤال بين الصفحات.`);
    }
    if (used + height > availableHeight + 0.5 && current.length) addPage();
    current.push(...group);
    used += height;
  }
  addPage();

  const lastManualPage = manualQuestions.reduce(
    (last, question) => Math.max(last, Number(question.dataset.positionPage)),
    -1
  );
  while (pages.length <= lastManualPage) pages.push([]);

  const mmToPx = mmToCssPx;
  pages.forEach((pageElements, pageIndex) => {
    const page = document.createElement("section");
    page.className = "page";
    page.dataset.page = String(pageIndex + 1);
    for (const corner of ["tl", "tr", "br", "bl"]) {
      const marker = document.createElement("div");
      marker.className = `mk ${corner}`;
      marker.setAttribute("aria-hidden", "true");
      page.appendChild(marker);
    }
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.setAttribute("aria-hidden", "true");
    page.appendChild(frame);

    const body = document.createElement("div");
    body.className = "body";
    for (const element of pageElements) body.appendChild(element);
    page.appendChild(body);

    for (const question of manualQuestions) {
      if (Number(question.dataset.positionPage) !== pageIndex) continue;
      const requestedWidth = Number.parseFloat(question.dataset.positionWidthMm);
      const widthMm = Number.isFinite(requestedWidth) && requestedWidth > 0
        ? Math.min(210, requestedWidth)
        : Math.max(1, 210 - pageMarginMm * 2);
      question.style.width = `${widthMm}mm`;
      const questionHeightMm = question.getBoundingClientRect().height / mmToPx;
      if (questionHeightMm > 297 + 0.5) {
        throw new Error(`السؤال ${question.dataset.id || "غير معروف"} أطول من صفحة A4 ولا يمكن تثبيت موضعه دون قص المحتوى.`);
      }
      const maxLeftMm = Math.max(0, 210 - widthMm);
      const maxTopMm = Math.max(0, 297 - questionHeightMm);
      const requestedLeft = Number.parseFloat(question.dataset.positionXMm) || 0;
      const requestedTop = Number.parseFloat(question.dataset.positionYMm) || 0;
      const leftMm = Math.min(maxLeftMm, Math.max(0, requestedLeft));
      let topMm = Math.min(maxTopMm, Math.max(0, requestedTop));

      const heading = manualHeadings.get(question);
      if (heading) {
        heading.style.width = `${widthMm}mm`;
        const headingHeightMm = heading.getBoundingClientRect().height / mmToPx;
        const headingMarginBottomMm = (parseFloat(getComputedStyle(heading).marginBottom) || 0) / mmToPx;
        const groupOffsetMm = headingHeightMm + headingMarginBottomMm;
        if (questionHeightMm + groupOffsetMm > 297 + 0.5) {
          throw new Error(`عنوان القسم مع السؤال ${question.dataset.id || "غير معروف"} لا يتسعان معاً في صفحة A4 واحدة.`);
        }
        topMm = Math.min(maxTopMm, Math.max(groupOffsetMm, topMm));
        heading.style.position = "absolute";
        heading.style.left = `${leftMm}mm`;
        heading.style.top = `${Math.max(0, topMm - groupOffsetMm)}mm`;
        heading.style.margin = "0";
        heading.style.zIndex = "2";
        page.appendChild(heading);
      }

      question.style.position = "absolute";
      question.style.left = `${leftMm}mm`;
      question.style.top = `${topMm}mm`;
      question.style.zIndex = "2";
      page.appendChild(question);
    }

    const footer = document.createElement("footer");
    footer.className = "foot";
    footer.dir = "rtl";
    footer.innerHTML = `صفحة <span dir="ltr">${pageIndex + 1}</span> من <span dir="ltr">${pages.length}</span>`;
    page.appendChild(footer);
    root.appendChild(page);
  });
  measure.remove();
  return { pageCount: pages.length };
}
