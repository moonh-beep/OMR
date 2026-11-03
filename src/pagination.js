/**
 * Runs inside Chromium after all fonts have loaded. Pagination uses measured
 * DOM rectangles (including margins), not text-length estimates.
 *
 * When a complete section/question block would leave a large unusable gap,
 * it first switches the section heading to a compact bilingual layout, then
 * slightly tightens question spacing and typography if needed. Questions are
 * still kept intact on one page, so their OMR regions never cross page bounds.
 */
export function paginateInBrowser() {
  const measure = document.getElementById("measure");
  const root = document.getElementById("pages");
  if (!measure || !root) throw new Error("مناطق القياس أو الصفحات غير موجودة.");

  const mmToCssPx = 96 / 25.4;
  const availableHeight = (297 - 24 - 23) * mmToCssPx;
  const elements = [...measure.children];
  const pages = [];
  let current = [];
  let used = 0;

  const outerHeight = (element) => {
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height +
      (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0);
  };

  const groupHeight = (group) =>
    group.reduce((sum, element) => sum + outerHeight(element), 0);

  const applyCompactLayout = (group) => {
    // First compact a long section heading; this usually saves the most space
    // without changing the question or answer typography.
    for (const element of group) {
      if (element.classList.contains("section-title")) {
        element.classList.add("section-title-compact");
      }
    }

    let height = groupHeight(group);
    if (used + height > availableHeight + 0.5) {
      // Only tighten the question itself when the compact heading is not enough.
      for (const element of group) {
        if (element.classList.contains("q")) {
          element.classList.add("q-compact");
        }
      }
      height = groupHeight(group);
    }
    return height;
  };

  const clearCompactLayout = (group) => {
    for (const element of group) {
      element.classList.remove("section-title-compact", "q-compact");
    }
  };

  const addPage = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    let group = [element];

    // Keep a section heading with its first question, even when the pair needs
    // compact styling to fit. This prevents orphaned section headings.
    if (
      element.classList.contains("section-title") &&
      elements[index + 1]?.classList.contains("q")
    ) {
      group = [element, elements[index + 1]];
      index++;
    }

    let height = groupHeight(group);

    if (used + height > availableHeight + 0.5) {
      height = applyCompactLayout(group);

      if (used + height > availableHeight + 0.5) {
        // The compact form still cannot use the current remainder. Restore the
        // original look and try a fresh page before shrinking anything further.
        clearCompactLayout(group);
        if (current.length) addPage();

        height = groupHeight(group);
        if (height > availableHeight + 0.5) {
          height = applyCompactLayout(group);
        }
      }
    }

    if (height > availableHeight + 0.5) {
      const label =
        group.find((node) => node.classList.contains("q"))?.dataset.id ||
        "غير معروف";
      throw new Error(
        `السؤال ${label} أطول من المساحة القابلة للطباعة حتى بعد تطبيق التنسيق المضغوط؛ قلّل طول السؤال أو عدد الخيارات أو مساحة الإجابة.`,
      );
    }

    current.push(...group);
    used += height;
  }
  addPage();

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
