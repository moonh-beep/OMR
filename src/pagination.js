/**
 * Runs inside Chromium after all fonts have loaded. Pagination uses measured
 * DOM rectangles (including margins), not text-length estimates.
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
  const addPage = () => {
    if (current.length) pages.push(current);
    current = [];
    used = 0;
  };

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    let group = [element];
    if (element.classList.contains("section-title") && elements[index + 1]?.classList.contains("q")) {
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
