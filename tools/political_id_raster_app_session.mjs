import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const STARTUP_MAX_ATTEMPTS = 2;
const STARTUP_RETRY_DELAY_MS = 1000;
const DIAGNOSTIC_HEADERS = ["content-type", "content-length", "etag", "last-modified", "cache-control",
  "date", "age", "server", "via", "x-cache", "x-served-by", "x-github-request-id", "x-fastly-request-id", "retry-after"];

// An import TypeError alone does not establish propagation or a transient HTTP
// failure. Never retry missing files, invalid modules, data/asset errors or later
// raster assertions. A new context resets the failed browser module map without
// query-string imports that could create a second state/renderer singleton.
export function isTransientRasterModuleFailure(error, { published, phase, url, network = [] }) {
  if (!published || phase !== "module-import") return false;
  const match = String(error?.message || error).match(/Failed to fetch dynamically imported module:\s*(https?:\/\/[^\s"'`]+)/i);
  if (!match) return false;
  const base = new URL(url), moduleRoot = new URL("js/", base);
  const isAppModule = value => {
    try {
      const candidate = new URL(value);
      return candidate.origin === base.origin && candidate.pathname.startsWith(moduleRoot.pathname) && candidate.pathname.endsWith(".js");
    } catch { return false; }
  };
  if (!isAppModule(match[1])) return false;
  const failedModules = network.filter(entry => entry.resourceType === "script" && isAppModule(entry.url)
    && (entry.status === "failed" || entry.status >= 400 || /text\/html/i.test(entry.headers?.["content-type"] || "")));
  return failedModules.length > 0 && failedModules.every(entry => [502, 503, 504].includes(entry.status === "failed" ? entry.httpStatus : entry.status)
    && (!entry.headers?.["retry-after"] || Number(entry.headers["retry-after"]) <= STARTUP_RETRY_DELAY_MS / 1000));
}

// Fault injection follows completed owner operations, not the arrival order
// of browser requests. Late callbacks from an aborted request must not spend
// the deliberately failed first recovery probe.
export function shouldHoldRasterAssetRequest() {
  const faults = window.__rasterAssetFaults;
  if (faults.active) { faults.intercepted++; return true; }
  if (faults.recoveryTimeouts <= 0) return false;
  const current = window.__rasterTask?.renderer.getPoliticalIdRasterDiagnostics();
  const protectedState = faults.protectedState;
  if (protectedState && current?.assetProbes > protectedState.assetProbes
    && current.assetTimeouts >= protectedState.assetTimeouts + 1) {
    faults.recoveryTimeouts = 0;
    return false;
  }
  faults.intercepted++;
  return true;
}

export async function openRasterApp(baseUrl, { dpr = 1, viewport = { width: 1280, height: 900 }, build = false, scenarioId = "", enabled = true, savedPreference = null, language = null, published = false, holdRasterAssets = false, startupOutput = null } = {}) {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const publishedTarget = url.origin === "https://raederhans.github.io" && url.pathname === "/scenario-forge/app/";
  if (!local && !(published && !build && publishedTarget)) throw new Error("Use localhost, or explicitly opt into verifying the published Scenario Forge app.");
  if (enabled === null) url.searchParams.delete("political_id_raster");
  else url.searchParams.set("political_id_raster", enabled ? "1" : "0");
  if (scenarioId) url.searchParams.set("default_scenario", scenarioId);
  if (build) url.searchParams.set("political_id_assets", "0");
  const failures = [];
  for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt++) {
    try {
      const session = await openRasterAppAttempt(url, { dpr, viewport, scenarioId, savedPreference, language, published, holdRasterAssets, startupOutput, attempt });
      return { ...session, startupAttempts: failures };
    } catch (error) {
      const diagnostic = error.rasterStartupFailure;
      if (diagnostic) failures.push(diagnostic);
      error.rasterStartupDiagnostics = failures;
      if (!diagnostic?.willRetry) throw error;
      await new Promise(resolve => setTimeout(resolve, STARTUP_RETRY_DELAY_MS));
    }
  }
}

async function openRasterAppAttempt(url, { dpr, viewport, scenarioId, savedPreference, language, published, holdRasterAssets, startupOutput, attempt }) {
  const browser = await chromium.launch({ headless: true });
  const startedAt = new Date().toISOString();
  const errors = [], network = [], warnings = [], startupNetwork = [];
  const responseStatuses = new WeakMap();
  let context, page, phase = "context", tracing = "";
  try {
    context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    if (startupOutput) {
      await mkdir(startupOutput, { recursive: true });
      try {
        // Playwright Test can already own tracing on this explicitly created
        // context. Use a chunk and leave the runner's recorder active.
        await context.tracing.startChunk({ title: `Raster startup attempt ${attempt}` });
        tracing = "chunk";
      } catch (traceError) {
        if (!String(traceError).includes("Must start tracing before starting a new chunk")) throw traceError;
        await context.tracing.start({ screenshots: false, snapshots: true, sources: false });
        tracing = "owned";
      }
    }
    page = await context.newPage();
    await page.addInitScript(({ savedPreference, language, holdRasterAssets }) => {
      if (savedPreference !== null) localStorage.setItem("scenario-forge-political-id-raster", savedPreference ? "1" : "0");
      if (language) localStorage.setItem("map_lang", language);
      // Faults exist only in this isolated test context; production deadlines
      // and recovery policy remain untouched.
      window.__rasterAssetFaults = { active: holdRasterAssets && sessionStorage.getItem('raster-release-faults-complete') !== '1', recoveryTimeouts: 0, intercepted: 0, aborted: 0 };
    }, { savedPreference, language, holdRasterAssets });
    if (holdRasterAssets) {
      const held = new Set();
      // Intercept at the context boundary so the same deadline/cancellation
      // assertion covers both page and dedicated-worker asset reads.
      await context.route("**/political_id_raster/*.pidr.gz", async route => {
        const hold = await page.evaluate(shouldHoldRasterAssetRequest);
        if (hold) held.add(route.request());
        else await route.continue();
      });
      context.on("requestfailed", request => {
        if (held.delete(request)) void page.evaluate(() => { window.__rasterAssetFaults.aborted++; }).catch(() => {});
      });
    }
    context.on("response", response => {
      responseStatuses.set(response.request(), response.status());
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
      const resourceType = response.request().resourceType();
      if (resourceType === "script" || resourceType === "document" || response.status() >= 400) {
        const headers = response.headers();
        startupNetwork.push({ url: response.url(), status: response.status(), resourceType,
          headers: Object.fromEntries(DIAGNOSTIC_HEADERS.filter(name => headers[name] !== undefined).map(name => [name, headers[name]])) });
      }
      if (response.url().includes("/political_id_raster/")) network.push({ url: response.url(), status: response.status(),
        contentEncoding: response.headers()["content-encoding"] || "", contentLength: response.headers()["content-length"] || "" });
    });
    context.on("requestfailed", request => {
      // Chromium also emits ERR_ABORTED after an HTTP module error. Keep both
      // events and correlate that failure to its actual response, not its URL.
      startupNetwork.push({ url: request.url(), status: "failed", httpStatus: responseStatuses.get(request),
        resourceType: request.resourceType(), errorText: request.failure()?.errorText || "" });
    });
    page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
    await page.addInitScript(() => {
      window.__rasterStates = [];
      addEventListener("political-id-raster-status", event => {
        if (window.__rasterStates.length < 100) window.__rasterStates.push({ at: performance.now(),
          displayState: event.detail.displayState, reason: event.detail.reason });
      });
    });
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    phase = "navigation";
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    phase = "module-import";
    await page.evaluate(async () => {
      const renderer = await import(new URL("js/core/map_renderer.js", document.baseURI));
      const { state } = await import(new URL("js/core/state.js", document.baseURI));
      const scenarios = await import(new URL("js/core/scenario_manager.js", document.baseURI));
      window.__rasterTask = { renderer, state, scenarios };
    });
    phase = "startup-ready";
    await waitRasterStartup(page);
    if (tracing === "owned") await context.tracing.stop();
    return { browser, context, page, errors, network, warnings };
  } catch (error) {
    const diagnostic = { attempt, phase, url: url.href, scenarioId, expectedSourceSha: process.env.GITHUB_SHA || null,
      startedAt, failedAt: new Date().toISOString(),
      error: String(error.stack || error), errors: [...errors], warnings: [...warnings], network: [...startupNetwork] };
    diagnostic.willRetry = attempt < STARTUP_MAX_ATTEMPTS && isTransientRasterModuleFailure(error, { ...diagnostic, published });
    if (startupOutput) {
      const prefix = path.join(startupOutput, `startup-attempt-${attempt}`);
      if (tracing) {
        try {
          if (tracing === "owned") await context.tracing.stop({ path: `${prefix}.zip` });
          else {
            await context.tracing.stopChunk({ path: `${prefix}.zip` });
            await context.tracing.startChunk();
          }
          diagnostic.tracePath = `${prefix}.zip`;
        }
        catch (traceError) { diagnostic.traceError = String(traceError); }
      }
      try {
        diagnostic.diagnosticPath = `${prefix}.json`;
        await writeFile(diagnostic.diagnosticPath, JSON.stringify(diagnostic, null, 2) + "\n");
      } catch (writeError) { diagnostic.writeError = String(writeError); diagnostic.willRetry = false; }
    }
    error.rasterStartupFailure = diagnostic;
    console.warn(JSON.stringify({ rasterStartupFailure: { attempt, phase, url: url.href, error: String(error), willRetry: diagnostic.willRetry,
      diagnosticPath: diagnostic.diagnosticPath, networkFailures: startupNetwork.filter(entry => entry.status === "failed" || entry.status >= 400) } }));
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  }
}

// Initial navigation and cache reload share the same startup boundary.
export async function waitRasterStartup(page) {
  await page.waitForFunction(() => {
    const s = window.__rasterTask.state;
    return s.bootPhase === "ready" && !s.startupReadonly && !s.startupReadonlyUnlockInFlight && !s.scenarioApplyInFlight;
  }, null, { timeout: 60000 });
}

export async function selectRasterScenario(page, scenarioId) {
  await page.evaluate(async id => {
    const { state, scenarios, renderer } = window.__rasterTask;
    if (state.activeScenarioId !== id) await scenarios.applyScenarioById(id, { renderNow: true });
    renderer.resetZoomToFit();
  }, scenarioId);
  await waitRasterView(page, scenarioId);
}

export async function waitRasterView(page, scenarioId) {
  await page.waitForFunction(id => {
    const { renderer, state } = window.__rasterTask;
    const d = renderer.getPoliticalIdRasterDiagnostics();
    return state.activeScenarioId === id && !state.scenarioApplyInFlight && !state.startupReadonly
      && d.selected && !d.pending && d.commits > 0 && !d.failed && d.view
      && ["x", "y", "k"].every(key => Math.abs(d.view[key] - state.zoomTransform[key]) < 1e-7);
  }, scenarioId, { timeout: 60000 });
}

export async function captureRasterView(page, scenarioId, zoom) {
  await page.evaluate(value => window.__rasterTask.renderer.setZoomPercent(value), zoom);
  await page.waitForFunction(value => Math.abs(window.__rasterTask.state.zoomTransform.k - value / 100) < 1e-7, zoom);
  await waitRasterView(page, scenarioId);
  return page.evaluate(async () => {
    const { renderer, state } = window.__rasterTask;
    const assets = await renderer.capturePoliticalIdRasterAssets();
    return { diagnostics: renderer.getPoliticalIdRasterDiagnostics(), featureCount: state.landData?.features?.length,
      assets: assets.map(({ identity, buffer }) => {
        const bytes = new Uint8Array(buffer); let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        return { identity, base64: btoa(binary) };
      }) };
  });
}
