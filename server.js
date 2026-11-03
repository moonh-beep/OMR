import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFiles, renderPreview } from "./src/export.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT = path.join(ROOT, "template");
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error("حجم بيانات الاستبيان يتجاوز الحد المسموح.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function staticFile(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return send(res, 404, "text/plain; charset=utf-8", "Not found");
    const data = await readFile(filePath);
    send(res, 200, MIME[path.extname(filePath)] || "application/octet-stream", data);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "POST" && url.pathname === "/api/preview") {
      const survey = await readJson(req);
      const html = await renderPreview(survey);
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ html }));
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const survey = await readJson(req);
      const result = await generateFiles(survey, OUTPUT);
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
        pageCount: result.pageCount,
        questionCount: result.questionCount,
        files: result.files,
        outputUrl: "/template/",
      }));
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
    }
    if (url.pathname.startsWith("/template/")) {
      const relative = decodeURIComponent(url.pathname.slice("/template/".length));
      const target = path.resolve(OUTPUT, relative || "survey.pdf");
      if (!target.startsWith(OUTPUT + path.sep) && target !== OUTPUT) {
        return send(res, 403, "text/plain; charset=utf-8", "Forbidden");
      }
      return await staticFile(res, target);
    }
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(ROOT + path.sep)) return send(res, 403, "text/plain; charset=utf-8", "Forbidden");
    return await staticFile(res, target);
  } catch (error) {
    return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Questionnaire Web Engine: http://127.0.0.1:${PORT}`);
  console.log("استخدم Ctrl+C لإيقاف الخادم.");
});
