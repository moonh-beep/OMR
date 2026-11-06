import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { launchChrome } from "../src/chrome.js";
import { generateFiles } from "../src/export.js";

const project = path.resolve(new URL("..", import.meta.url).pathname);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "questionnaire-engine-test-"));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const near = (actual, expected, tolerance = 1.1) => Math.abs(actual - expected) <= tolerance;

function createLongSurvey() {
  const questions = [];
  for (let index = 1; index <= 58; index++) {
    const question = {
      id: `long_${String(index).padStart(2, "0")}`,
      type: index === 58 ? "text" : "choice",
      text_en: `Question ${index}: Select the answer that best describes your experience with this academic service and its accessibility.`,
      text_ar: `السؤال ${index}: اختر الإجابة التي تصف تجربتك مع هذه الخدمة التعليمية ومدى سهولة الوصول إليها.`,
    };
    if (index === 7) {
      question.text_en = "A longer question used to test line wrapping in the English column while the Arabic column remains fixed on the right. Please select the most suitable answer.";
      question.text_ar = "سؤال أطول لاختبار التفاف النص داخل العمود العربي دون انتقاله إلى العمود الأيسر أو تداخله مع النص الإنجليزي.";
    }
    if (index % 11 === 0) {
      delete question.text_ar;
    } else if (index % 13 === 0) {
      delete question.text_en;
    }
    if (index === 58) {
      question.height_mm = 28;
    } else {
      question.options = [
        { en: "Strongly agree", ar: "أوافق بشدة" },
        { en: "Agree", ar: "أوافق" },
        { en: "Neutral", ar: "محايد" },
        { en: "Disagree", ar: "لا أوافق" },
      ];
    }
    questions.push(question);
  }
  return {
    title_en: "Extended questionnaire layout test",
    title_ar: "اختبار تخطيط استبيان متعدد الصفحات",
    sections: [
      { id: "part_a", title_en: "Part A: General information", title_ar: "القسم أ: معلومات عامة", questions: questions.slice(0, 29) },
      { id: "part_b", title_en: "Part B: Service evaluation", title_ar: "القسم ب: تقييم الخدمة", questions: questions.slice(29) },
    ],
  };
}

async function imageHasBlackAt(imagePath, points) {
  const buffer = await readFile(imagePath);
  const dataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  const browser = await launchChrome({ width: 1200, height: 1200, deviceScaleFactor: 1 });
  try {
    const args = JSON.stringify({ dataUrl, points });
    return await browser.evaluate(`(async ({ dataUrl, points }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      return points.map(([x, y]) => {
        const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return pixel[0] < 25 && pixel[1] < 25 && pixel[2] < 25;
      });
    })(${args})`);
  } finally {
    await browser.close();
  }
}

async function verifyDomCoordinates(previewHtml, layout, imageDimensions) {
  const browser = await launchChrome({ width: 1200, height: 1200, deviceScaleFactor: 1 });
  try {
    await browser.setContent(previewHtml);
    const actual = await browser.evaluate(() => [...document.querySelectorAll(".page")].map((page) => {
      const pageRect = page.getBoundingClientRect();
      const getRect = (element) => {
        const r = element.getBoundingClientRect();
        return [r.left - pageRect.left, r.top - pageRect.top, r.width, r.height];
      };
      return {
        width: pageRect.width,
        height: pageRect.height,
        markers: [...page.querySelectorAll(".mk")].length,
        questions: [...page.querySelectorAll(".q")].map((q) => ({
          id: q.dataset.id,
          rect: getRect(q),
          options: [...q.querySelectorAll(".opt")].map((opt) => ({
            rect: getRect(opt),
            en: (() => { const r = opt.querySelector(".opt-en").getBoundingClientRect(); return [r.left, r.right]; })(),
            ar: (() => { const r = opt.querySelector(".opt-ar").getBoundingClientRect(); return [r.left, r.right]; })(),
          })),
          hasField: !!q.querySelector(".tb"),
        })),
      };
    }));

    check(actual.length === layout.pages.length, "Preview page count equals layout.json page count");
    const bodyTop = 24 * 96 / 25.4;
    const bodyBottom = 274 * 96 / 25.4;
    for (let i = 0; i < actual.length; i++) {
      const scaleX = imageDimensions[i].width / actual[i].width;
      const scaleY = imageDimensions[i].height / actual[i].height;
      check(actual[i].markers === 4, `Page ${i + 1} has exactly four marker elements`);
      check(layout.pages[i].markers.length === 4, `Page ${i + 1} layout stores four marker centers`);
      for (const q of actual[i].questions) {
        const recorded = layout.questions.find((entry) => entry.id === q.id);
        check(!!recorded, `Question ${q.id} exists in layout`);
        const cssRect = q.rect.map((value, k) => Math.round(value * (k % 2 === 0 ? scaleX : scaleY)));
        check(cssRect.every((value, k) => near(value, recorded.rect[k], 1)), `Question ${q.id} coordinates match the PNG-scaled DOM rectangle`);
        check(q.rect[1] >= bodyTop - 1 && q.rect[1] + q.rect[3] <= bodyBottom + 2, `Question ${q.id} remains inside printable body height`);

        for (let j = 0; j < q.options.length; j++) {
          const opt = q.options[j];
          const optionRecorded = recorded.options[j];
          check(!!optionRecorded, `Question ${q.id} option ${j + 1} appears in layout`);
          const scaled = opt.rect.map((value, k) => Math.round(value * (k % 2 === 0 ? scaleX : scaleY)));
          check(scaled.every((value, k) => near(value, optionRecorded.rect[k], 1)), `Option ${j + 1} coordinates for ${q.id} match DOM-to-PNG conversion`);
          check(opt.en[0] < opt.ar[0], `Question ${q.id} option ${j + 1}: English remains left of Arabic`);
          if (j > 0) {
            const prev = q.options[j - 1].rect;
            const intersects = Math.min(prev[1] + prev[3], opt.rect[1] + opt.rect[3]) > Math.max(prev[1], opt.rect[1]) &&
              Math.min(prev[0] + prev[2], opt.rect[0] + opt.rect[2]) > Math.max(prev[0], opt.rect[0]);
            check(!intersects, `Question ${q.id} option rows do not overlap`);
          }
        }
        if (recorded.type !== "choice") check(q.hasField && Array.isArray(recorded.field), `Text question ${q.id} exports field rect`);
      }
    }
  } finally {
    await browser.close();
  }
}

try {
  const sample = JSON.parse(await readFile(path.join(project, "survey.json"), "utf8"));
  const singleDir = path.join(temporaryRoot, "single");
  console.log("TEST: generate reference");
  const single = await generateFiles(sample, singleDir);
  console.log("TEST: reference generated");
  check(single.pageCount === 1, "Reference bilingual survey fits one A4 page");
  check(single.questionCount === 5, "Reference example contains five questions");
  check(single.layout.pages.length === 1, "Single-page layout has one page record");
  check(single.layout.pages[0].markers.length === 4, "Single-page layout contains four marker centers");
  check(single.layout.pages[0].w === 1654 && single.layout.pages[0].h === 2340, "Reference PNG dimensions match the original generator's first-page output");
  check(JSON.stringify(single.layout.pages[0].markers) === JSON.stringify([[79, 79], [1575, 79], [1575, 2261], [79, 2261]]), "Fiducial center coordinates exactly match the original generator");
  check(single.layout.questions[0].options.length === 4, "First bilingual question has four answer regions");

  const schemaPage = single.layout.pages[0];
  check(Object.keys(single.layout).sort().join(",") === "pages,questions", "Top-level layout.json keys remain pages and questions");
  check(Object.keys(schemaPage).sort().join(",") === "h,markers,w", "Page layout schema remains w, h, markers");
  const schemaQuestion = single.layout.questions[0];
  check(["id", "type", "page", "rect", "text", "options"].every((key) => Object.hasOwn(schemaQuestion, key)), "Choice question retains legacy fields");
  check(typeof schemaQuestion.page === "number" && Array.isArray(schemaQuestion.rect), "Question page index and rect types remain numeric/array");
  check(typeof schemaQuestion.options[0].label === "string" && Array.isArray(schemaQuestion.options[0].rect), "Option label and rect types remain string/array");
  const optionRects = schemaQuestion.options.map((option) => option.rect);
  for (let i = 0; i < optionRects.length; i++) for (let j = i + 1; j < optionRects.length; j++) {
    const a = optionRects[i], b = optionRects[j];
    const overlap = Math.min(a[0] + a[2], b[0] + b[2]) > Math.max(a[0], b[0]) && Math.min(a[1] + a[3], b[1] + b[3]) > Math.max(a[1], b[1]);
    check(!overlap, `Sample option regions ${i + 1} and ${j + 1} do not overlap`);
  }

  const singlePreview = await readFile(path.join(singleDir, "preview.html"), "utf8");
  const singlePngDimensions = [{ width: schemaPage.w, height: schemaPage.h }];
  console.log("TEST: verify reference DOM");
  await verifyDomCoordinates(singlePreview, single.layout, singlePngDimensions);
  console.log("TEST: reference DOM verified");
  console.log("TEST: sample marker pixels");
  const markerPixels = await imageHasBlackAt(path.join(singleDir, "p1.png"), schemaPage.markers);
  console.log("TEST: marker pixels verified");
  check(markerPixels.length === 4 && markerPixels.every(Boolean), "All four marker centers are black pixels in the exported PNG");

  const longSurvey = createLongSurvey();
  const multiDir = path.join(temporaryRoot, "multi");
  console.log("TEST: generate multi page");
  const multi = await generateFiles(longSurvey, multiDir);
  console.log("TEST: multi page generated");
  check(multi.pageCount >= 2, "Long survey paginates to multiple A4 pages");
  check(multi.questionCount === 58, "All long-survey questions are retained");
  check(multi.layout.questions.map((q) => q.id).join(",") === longSurvey.sections.flatMap((s) => s.questions).map((q) => q.id).join(","), "Question order and IDs are preserved across pages");
  check(multi.layout.questions.some((q) => Object.hasOwn(q, "field")), "Non-choice question retains legacy field rectangle");
  check(multi.layout.pages.every((p) => p.markers.length === 4), "Every generated page has four marker centers");
  check(multi.layout.questions.every((q) => q.page >= 0 && q.page < multi.pageCount), "Every question page index is within the page range");
  check(multi.files.filter((f) => f.endsWith(".png")).length === multi.pageCount, "One PNG is exported for each page");

  const pdfInfo = spawnSync("pdfinfo", [path.join(multiDir, "survey.pdf")], { encoding: "utf8" });
  if (pdfInfo.status === 0) {
    const pageMatch = pdfInfo.stdout.match(/^Pages:\s+(\d+)$/m);
    check(Number(pageMatch?.[1]) === multi.pageCount, "Exported PDF page count equals generated page count");
    check(/Page size:\s+[0-9.]+ x [0-9.]+ pts \(A4\)/.test(pdfInfo.stdout), "PDF page size is A4");
  } else {
    console.warn("pdfinfo is not installed; PDF metadata checks were skipped.");
  }

  const multiPreview = await readFile(path.join(multiDir, "preview.html"), "utf8");
  const multiDimensions = await Promise.all(multi.files.filter((f) => f.endsWith(".png")).map(async (f) => {
    const b = await readFile(path.join(multiDir, f));
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }));
  console.log("TEST: verify multi DOM");
  await verifyDomCoordinates(multiPreview, multi.layout, multiDimensions);
  console.log("TEST: multi DOM verified");
  const multiMarkerPoints = multi.layout.pages.map((p) => p.markers[0]);
  console.log("TEST: multi marker pixel");
  const firstMarkerChecks = await imageHasBlackAt(path.join(multiDir, "p1.png"), multiMarkerPoints.slice(0, 1));
  console.log("TEST: multi marker verified");
  check(firstMarkerChecks[0], "Multi-page PNG marker sample is visibly black");

  const report = [
    "# Automated test report",
    "",
    `- Reference bilingual example: ${single.pageCount} page(s), ${single.questionCount} questions.`,
    `- Multi-page stress test: ${multi.pageCount} pages, ${multi.questionCount} questions (including a text-entry field).`,
    "- Fixed English-left / Arabic-right columns verified from browser DOM geometry.",
    "- Question and option coordinates compared against actual preview DOM rectangles after PNG scale conversion.",
    "- Four marker elements and black marker pixels checked in PNG output.",
    "- Option rectangles checked for overlap.",
    "- JSON contract checked against the legacy make_template.py structure.",
    "- Reference PNG dimensions and all four marker centers exactly match the original generator.",
    "- PDF A4 dimensions and page count checked with pdfinfo when available.",
    "",
    `Total assertions completed: ${checks}.`,
    "",
    "OMR read/mark recognition is not tested: the original omr.py and its test fixtures were not supplied.",
  ].join("\n");
  await writeFile(path.join(project, "TEST_REPORT.md"), report, "utf8");
  console.log(`PASS: ${checks} assertions completed.`);
  console.log(`Single page: ${single.pageCount}; multi-page: ${multi.pageCount}; report: TEST_REPORT.md`);
} catch (error) {
  console.error("FAIL:", error);
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
