import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFiles } from "./generator.js";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.resolve(process.argv[2] || path.join(projectDir, "survey.json"));
const outputDir = path.resolve(process.argv[3] || path.join(projectDir, "template"));

try {
  const survey = JSON.parse(await readFile(inputPath, "utf8"));
  const result = await generateFiles(survey, outputDir);
  console.log(`تم إنشاء ${result.pageCount} صفحة و${result.questionCount} سؤال.`);
  console.log(`المخرجات: ${result.outputDir}`);
  for (const file of result.files) console.log(`  - ${file}`);
} catch (error) {
  console.error(`فشل التوليد: ${error.message}`);
  process.exitCode = 1;
}
