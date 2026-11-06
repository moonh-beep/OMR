import test from "node:test";
import assert from "node:assert/strict";
import { paginateInBrowser } from "../src/pagination.js";

function fakeElement(classes = [], height = 10, dataset = {}) {
  const children = [];
  return {
    className: "",
    classList: { contains: (name) => classes.includes(name) },
    dataset,
    children,
    style: {},
    dir: "",
    innerHTML: "",
    getBoundingClientRect: () => ({ height }),
    setAttribute() {},
    appendChild(child) { children.push(child); return child; },
  };
}

function runPagination(elements, marginMm = 20) {
  const pages = [];
  const measure = {
    children: elements,
    remove() { this.removed = true; },
  };
  globalThis.document = {
    body: {},
    getElementById(id) {
      if (id === "measure") return measure;
      if (id === "pages") return { appendChild(page) { pages.push(page); } };
      return null;
    },
    createElement(tag) {
      const element = fakeElement();
      element.tagName = tag;
      return element;
    },
  };
  globalThis.getComputedStyle = () => ({
    getPropertyValue: (name) => name === "--page-margin" ? String(marginMm) : "",
    marginTop: "0px",
    marginBottom: "0px",
  });

  try {
    const result = paginateInBrowser();
    return { result, pages, measure };
  } finally {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  }
}

test("keeps a question as one indivisible page block", () => {
  const question = fakeElement(["q"], 120, { id: "q1" });
  const { result, pages } = runPagination([question]);
  assert.equal(result.pageCount, 1);
  const body = pages[0].children.find((child) => child.className === "body");
  assert.deepEqual(body.children, [question]);
});

test("keeps a section heading with the first question in that section", () => {
  const previousQuestion = fakeElement(["q"], 900, { id: "q0" });
  const heading = fakeElement(["section-title"], 30);
  const question = fakeElement(["q"], 40, { id: "q1" });
  const { result, pages } = runPagination([previousQuestion, heading, question]);
  assert.equal(result.pageCount, 2);
  const secondBody = pages[1].children.find((child) => child.className === "body");
  assert.deepEqual(secondBody.children, [heading, question]);
});

test("keeps manually positioned questions on their selected page and outside text margins", () => {
  const flowQuestion = fakeElement(["q"], 30, { id: "flow-question" });
  const positionedQuestion = fakeElement(
    ["q", "manual-position"],
    40,
    {
      id: "positioned-question",
      positionPage: "1",
      positionXMm: "4",
      positionYMm: "8",
      positionWidthMm: "80",
    },
  );
  const { result, pages } = runPagination([flowQuestion, positionedQuestion]);
  assert.equal(result.pageCount, 2);
  assert.ok(pages[1].children.includes(positionedQuestion));
  assert.equal(positionedQuestion.style.position, "absolute");
  assert.equal(positionedQuestion.style.left, "4mm");
  assert.equal(positionedQuestion.style.top, "8mm");
  assert.equal(positionedQuestion.style.width, "80mm");
});

test("clamps manually positioned questions to the physical A4 page, not the text margins", () => {
  const positionedQuestion = fakeElement(
    ["q", "manual-position"],
    80,
    {
      id: "edge-question",
      positionPage: "0",
      positionXMm: "200",
      positionYMm: "296",
      positionWidthMm: "80",
    },
  );
  const { pages } = runPagination([positionedQuestion]);
  assert.equal(positionedQuestion.style.left, "130mm");
  assert.ok(Number.parseFloat(positionedQuestion.style.top) < 297);
});

test("rejects a question that cannot fit on one page instead of splitting it", () => {
  const question = fakeElement(["q"], 1200, { id: "long-question" });
  assert.throws(
    () => runPagination([question]),
    /لا يتم تقسيم السؤال بين الصفحات/,
  );
});
