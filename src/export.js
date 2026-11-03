import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PAGE } from "./config.js";
import { buildDocument } from "./markup.js";
import { paginateInBrowser } from "./pagination.js";
import { collectLayoutInBrowser, scaleLayoutToPng } from "./coordinates.js";
import { launchChrome } from "./chrome.js";

async function setAndPaginate(browserPage, html) {
  await browserPage.setContent(html);
  const pagination = await browserPage.evaluate(paginateInBrowser);
  await browserPage.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  return pagination;
}

function pngDimensions(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("ملف PNG الناتج غير صالح.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function clearOldPageImages(outputDir) {
  await mkdir(outputDir, { recursive: true });
  for (const name of await readdir(outputDir)) {
    if (/^p\d+\.png$/i.test(name)) await rm(path.join(outputDir, name), { force: true });
  }
}

export async function renderPreview(survey) {
  const html = await buildDocument(survey);
  const browserPage = await launchChrome({ width: 1000, height: 1200, deviceScaleFactor: 1 });
  try {
    await setAndPaginate(browserPage, html);
    return await browserPage.content();
  } finally {
    await browserPage.close();
  }
}

export async function generateFiles(survey, outputDir = path.resolve("template")) {
  const absoluteOutput = path.resolve(outputDir);
  await clearOldPageImages(absoluteOutput);
  const html = await buildDocument(survey);
  const browserPage = await launchChrome({
    width: 794,
    height: 1123,
    deviceScaleFactor: PAGE.dpi / 96,
  });
  try {
    const { pageCount } = await setAndPaginate(browserPage, html);
    const layout = await browserPage.evaluate(collectLayoutInBrowser);
    if (layout.pages.length !== pageCount) throw new Error("عدد الصفحات في القياس لا يطابق عدد الصفحات الناتجة.");
    const clips = await browserPage.evaluate(() => [...document.querySelectorAll(".page")].map((page) => {
      const rect = page.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }));

    const dimensions = [];
    for (let index = 0; index < pageCount; index++) {
      const imagePath = path.join(absoluteOutput, `p${index + 1}.png`);
      const png = await browserPage.screenshotClip(clips[index]);
      await writeFile(imagePath, png);
      dimensions.push(pngDimensions(png));
    }
    scaleLayoutToPng(layout, dimensions);

    await writeFile(path.join(absoluteOutput, "preview.html"), await browserPage.content(), "utf8");
    const pdf = await browserPage.printPdf();
    await writeFile(path.join(absoluteOutput, "survey.pdf"), pdf);
    await writeFile(path.join(absoluteOutput, "layout.json"), JSON.stringify(layout, null, 2), "utf8");
    return {
      outputDir: absoluteOutput,
      pageCount,
      questionCount: layout.questions.length,
      files: ["survey.pdf", "layout.json", "preview.html", ...dimensions.map((_, index) => `p${index + 1}.png`)],
      layout,
    };
  } finally {
    await browserPage.close();
  }
}
