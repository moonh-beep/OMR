/**
 * Paginate the questionnaire using measured Chromium layout, not text estimates.
 * Long choice questions may continue on the next page between complete option
 * rows. Each option carries its page index so OMR can score it on the right scan.
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

  const measureTemporaryGroup = (group) => {
    group.forEach((element) => measure.appendChild(element));
    const height = groupHeight(group);
    group.forEach((element) => element.remove());
    return height;
  };

  const applyCompactLayout = (group) => {
    for (const element of group) {
      if (element.classList.contains("section-title")) {
        element.classList.add("section-title-compact");
      }
    }

    let height = groupHeight(group);
    if (used + height > availableHeight + 0.5) {
      for (const element of group) {
        if (element.classList.contains("q")) element.classList.add("q-compact");
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

  const makeQuestionFragment = (question, optionNodes, first, compact) => {
    const fragment = question.cloneNode(false);
    fragment.classList.add("q-fragment");
    if (compact) fragment.classList.add("q-compact");

    const heading = question.querySelector(".qt")?.cloneNode(true);
    if (!heading) throw new Error("عنوان السؤال غير موجود أثناء تقسيمه.");

    if (!first) {
      heading.classList.add("qt-continuation");
      const english = heading.querySelector(".qt-en");
      const arabic = heading.querySelector(".qt-ar");
      if (english) {
        const tag = document.createElement("span");
        tag.className = "continued-tag";
        tag.textContent = " (continued)";
        english.appendChild(tag);
      }
      if (arabic) {
        const tag = document.createElement("span");
        tag.className = "continued-tag";
        tag.textContent = " (تابع)";
        arabic.appendChild(tag);
      }
    }
    fragment.appendChild(heading);

    const sourceOptions = question.querySelector(".opts");
    const options = sourceOptions.cloneNode(false);
    for (const option of optionNodes) options.appendChild(option.cloneNode(true));
    fragment.appendChild(options);
    return fragment;
  };

  /**
   * Split only standard vertical choice lists, and only between whole options.
   * The heading is repeated on continuation pages so the printed sheet remains
   * understandable. Returns false when even one complete option cannot fit.
   */
  const splitQuestion = (question, sectionTitle, firstCapacity) => {
    const optionsRoot = question.querySelector(".opts");
    if (
      question.dataset.type !== "choice" ||
      !optionsRoot ||
      optionsRoot.classList.contains("opts-row")
    ) return false;

    const optionNodes = [...optionsRoot.children];
    if (optionNodes.length < 2) return false;

    let start = 0;
    let first = true;
    let capacity = firstCapacity;

    while (start < optionNodes.length) {
      let best = null;

      // Prefer normal typography. Compact typography is selected only when it
      // allows more complete options to fit in the available page space.
      for (const compact of [false, true]) {
        for (const compactSection of (first && sectionTitle ? [false, true] : [false])) {
          for (let end = start + 1; end <= optionNodes.length; end++) {
            const fragment = makeQuestionFragment(
              question,
              optionNodes.slice(start, end),
              first,
              compact,
            );
            const group = [];
            if (first && sectionTitle) {
              const heading = sectionTitle.cloneNode(true);
              if (compactSection) heading.classList.add("section-title-compact");
              group.push(heading);
            }
            group.push(fragment);
            const height = measureTemporaryGroup(group);

            if (height <= capacity + 0.5) {
              const count = end - start;
              if (
                !best ||
                count > best.count ||
                (count === best.count && best.compact && !compact) ||
                (count === best.count && best.compactSection && !compactSection)
              ) {
                best = { group, count, height, compact, compactSection, end };
              }
            } else {
              // More option rows cannot make this fragment shorter.
              break;
            }
          }
        }
      }

      if (!best) {
        if (first && current.length) return false;
        const label = question.dataset.id || "غير معروف";
        throw new Error(
          `تعذر وضع خيار كامل من السؤال ${label} في صفحة مستقلة. اختصر نص السؤال أو نص أحد الخيارات.`,
        );
      }

      // The chosen nodes were removed after measuring; append them to the page.
      current.push(...best.group);
      used += best.height;
      start = best.end;
      first = false;

      if (start < optionNodes.length) {
        addPage();
        capacity = availableHeight;
      }
    }

    // The originals are replaced by measured fragments. They must not be
    // appended a second time by the main pagination loop.
    question.remove();
    sectionTitle?.remove();
    return true;
  };

  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    let group = [element];
    let sectionTitle = null;
    let question = null;

    if (
      element.classList.contains("section-title") &&
      elements[index + 1]?.classList.contains("q")
    ) {
      sectionTitle = element;
      question = elements[index + 1];
      group = [sectionTitle, question];
      index++;
    } else if (element.classList.contains("q")) {
      question = element;
    }

    let height = groupHeight(group);

    if (used + height > availableHeight + 0.5) {
      height = applyCompactLayout(group);
    }

    if (used + height <= availableHeight + 0.5) {
      current.push(...group);
      used += height;
      continue;
    }

    // Restore the original styling before splitting or moving the question.
    clearCompactLayout(group);

    // Try to use the remainder of this page by moving complete answer rows.
    if (question && splitQuestion(question, sectionTitle, availableHeight - used)) {
      continue;
    }

    // If the remainder is too small for a meaningful fragment, start fresh.
    if (current.length) addPage();

    height = groupHeight(group);
    if (height > availableHeight + 0.5) {
      height = applyCompactLayout(group);
    }

    if (height <= availableHeight + 0.5) {
      current.push(...group);
      used += height;
      continue;
    }

    clearCompactLayout(group);
    if (question && splitQuestion(question, sectionTitle, availableHeight)) {
      continue;
    }

    const label = question?.dataset.id || "غير معروف";
    throw new Error(
      `السؤال ${label} أطول من المساحة القابلة للطباعة حتى بعد التنسيق المضغوط. قلّل نص السؤال أو مساحة الإجابة.`,
    );
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
