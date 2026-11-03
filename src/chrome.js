import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function findExecutable() {
  const configured = process.env.PLAYWRIGHT_EXECUTABLE_PATH || process.env.BROWSER_PATH;
  if (configured && existsSync(configured)) return configured;
  const names = process.platform === "win32"
    ? ["msedge.exe", "chrome.exe", "chromium.exe"]
    : ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge"];
  const suffixes = process.platform === "win32" ? (process.env.PATH || "").split(path.delimiter) : (process.env.PATH || "").split(path.delimiter);
  for (const name of names) {
    for (const directory of suffixes) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge"];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

class DevToolsClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Chrome DevTools command failed"));
      else pending.resolve(message.result || {});
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools connection closed."));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId = this.sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
      includeCommandLineAPI: false,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "JavaScript evaluation failed";
      throw new Error(detail);
    }
    return result.result?.value;
  }

  async closeSocket() {
    try { this.socket?.close(); } catch { /* ignore */ }
  }
}

export class ChromeSession {
  constructor(child, profile, client, sessionId, deviceScaleFactor) {
    this.child = child;
    this.profile = profile;
    this.client = client;
    this.sessionId = sessionId;
    this.deviceScaleFactor = deviceScaleFactor;
  }

  async evaluate(expressionOrFunction) {
    const expression = typeof expressionOrFunction === "function"
      ? `(${expressionOrFunction.toString()})()`
      : expressionOrFunction;
    return this.client.evaluate(expression);
  }

  async setContent(html) {
    const expression = `(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`;
    await this.evaluate(expression);
    await this.evaluate("(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true; })()");
  }

  async setViewport(width, height, deviceScaleFactor = 1) {
    this.deviceScaleFactor = deviceScaleFactor;
    await this.client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await this.client.send("Emulation.setScrollbarsHidden", { hidden: true });
  }

  async screenshotClip(clip) {
    const result = await this.client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      // Slightly expand the fractional CSS clip to preserve edge pixels like the prior element-screenshot export.
      clip: { ...clip, scale: 1.001 },
    });
    return Buffer.from(result.data, "base64");
  }

  async printPdf() {
    const result = await this.client.send("Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      transferMode: "ReturnAsBase64",
    });
    return Buffer.from(result.data, "base64");
  }

  async content() {
    return await this.evaluate("'<!doctype html>\\n' + document.documentElement.outerHTML");
  }

  async close() {
    // Terminate the browser process directly. Browser.close can close the
    // DevTools socket before replying, leaving a pending CDP command forever.
    await this.client.closeSocket();
    if (this.child && this.child.exitCode === null) {
      const exited = new Promise((resolve) => this.child.once("exit", resolve));
      this.child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }
    await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

export async function launchChrome({ width = 794, height = 1123, deviceScaleFactor = 1 } = {}) {
  const executable = findExecutable();
  if (!executable) {
    throw new Error("لم يتم العثور على Chromium أو Chrome أو Edge. ثبّت أحدها أو حدّد PLAYWRIGHT_EXECUTABLE_PATH.");
  }
  const profile = await mkdtemp(path.join(os.tmpdir(), "questionnaire-chrome-"));
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  try {
    const activePortPath = path.join(profile, "DevToolsActivePort");
    let activePort;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`تعذر تشغيل المتصفح (exit code ${child.exitCode}).`);
      try {
        activePort = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!activePort?.[0] || !activePort?.[1]) throw new Error("انتهت مهلة انتظار منفذ Chromium DevTools.");
    const versionResponse = await fetch(`http://127.0.0.1:${activePort[0]}/json/version`);
    if (!versionResponse.ok) throw new Error("تعذر الاتصال بواجهة Chromium DevTools.");
    const versionInfo = await versionResponse.json();
    const client = new DevToolsClient(versionInfo.webSocketDebuggerUrl);
    await client.connect();
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" }, null);
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true }, null);
    client.sessionId = sessionId;
    const session = new ChromeSession(child, profile, client, sessionId, deviceScaleFactor);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await session.setViewport(width, height, deviceScaleFactor);
    return session;
  } catch (error) {
    child.kill("SIGTERM");
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
