import { chromium } from "playwright";

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

export async function openRasterApp(baseUrl, { dpr = 1, viewport = { width: 1280, height: 900 }, build = false, scenarioId = "", enabled = true, savedPreference = null, language = null, published = false, holdRasterAssets = false, launchOptions = {}, initScripts = [] } = {}) {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const publishedTarget = url.origin === "https://raederhans.github.io" && url.pathname === "/scenario-forge/app/";
  if (!local && !(published && !build && publishedTarget)) throw new Error("Use localhost, or explicitly opt into verifying the published Scenario Forge app.");
  if (enabled === null) url.searchParams.delete("political_id_raster");
  else url.searchParams.set("political_id_raster", enabled ? "1" : "0");
  if (scenarioId) url.searchParams.set("default_scenario", scenarioId);
  if (build) url.searchParams.set("political_id_assets", "0");
  const browser = await chromium.launch({ headless: true, ...launchOptions });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    const page = await context.newPage();
    // Reproduce a slow CI runner locally: SCENARIO_FORGE_RASTER_CPU_THROTTLE=3 slows the page's CPU 3x.
    const cpuThrottleRate = Number(process.env.SCENARIO_FORGE_RASTER_CPU_THROTTLE || 0);
    if (cpuThrottleRate > 1) {
      const cdpSession = await context.newCDPSession(page);
      await cdpSession.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottleRate });
    }
    await page.addInitScript(({ savedPreference, language, holdRasterAssets }) => {
      if (savedPreference !== null) localStorage.setItem("scenario-forge-political-id-raster", savedPreference ? "1" : "0");
      if (language) localStorage.setItem("map_lang", language);
      // Faults exist only in this isolated test context; production deadlines
      // and recovery policy remain untouched.
      window.__rasterAssetFaults = { active: holdRasterAssets && sessionStorage.getItem('raster-release-faults-complete') !== '1', recoveryTimeouts: 0, intercepted: 0, aborted: 0 };
      if (!window.__rasterAssetFaults.active) return;
      // Covered Worker output is persisted on idle. If that save lands before
      // the first recovery probe, the probe reads it back and never reaches the
      // held network request. The raster Worker owns the asset database, so a
      // prelude there opens it only after the page reports that probe timed out.
      const faultsPending = () => {
        const faults = window.__rasterAssetFaults;
        if (faults.active) return true;
        if (faults.recoveryTimeouts <= 0 || !faults.protectedState) return false;
        const current = window.__rasterTask?.renderer.getPoliticalIdRasterDiagnostics();
        return !(current?.assetTimeouts >= faults.protectedState.assetTimeouts + 1);
      };
      const gate = "__rasterAssetDatabaseGate";
      const prelude = () => {
        const factory = self.indexedDB, open = factory.open.bind(factory);
        const handlers = ["upgradeneeded", "success", "error", "blocked"];
        let released = false; const waiting = [];
        // Registered before the runtime's onmessage, so the gate never reaches it.
        self.addEventListener("message", event => {
          if (event.data?.[gate] !== "open") return;
          event.stopImmediatePropagation();
          released = true; waiting.splice(0).forEach(resume => resume());
        });
        factory.open = (name, version) => {
          if (name !== "political-id-raster-assets-v1" || released) return open(name, version);
          let request = null;
          const deferred = Object.fromEntries(handlers.map(type => [`on${type}`, null]));
          Object.defineProperty(deferred, "result", { get: () => request?.result });
          Object.defineProperty(deferred, "error", { get: () => request?.error ?? null });
          waiting.push(() => {
            request = open(name, version);
            for (const type of handlers) request[`on${type}`] = event => deferred[`on${type}`]?.(event);
          });
          return deferred;
        };
      };
      const preludeUrl = URL.createObjectURL(new Blob([`const gate = ${JSON.stringify(gate)}; (${prelude})();`], { type: "text/javascript" }));
      const NativeWorker = window.Worker, gated = [];
      window.Worker = function Worker(url, options) {
        const href = new URL(String(url), location.href).href;
        if (options?.type !== "module" || !href.endsWith("/political_id_raster.worker.js") || !faultsPending()) {
          return new NativeWorker(url, options);
        }
        // Static imports evaluate in order: the prelude runs before the runtime module.
        const entry = URL.createObjectURL(new Blob([`import ${JSON.stringify(preludeUrl)}; import ${JSON.stringify(href)};`], { type: "text/javascript" }));
        const worker = new NativeWorker(entry, options);
        gated.push(worker);
        return worker;
      };
      window.Worker.prototype = NativeWorker.prototype;
      const poll = setInterval(() => {
        if (faultsPending()) return;
        clearInterval(poll);
        for (const worker of gated.splice(0)) worker.postMessage({ [gate]: "open" });
      }, 20);
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
    const errors = [], network = [], warnings = [];
    context.on("response", response => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
      if (response.url().includes("/political_id_raster/")) network.push({ url: response.url(), status: response.status(),
        contentEncoding: response.headers()["content-encoding"] || "", contentLength: response.headers()["content-length"] || "" });
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
    for (const script of initScripts) await page.addInitScript(script);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    // The published editor is bundled; take its live modules from the app test API
    // instead of importing js/core/*.js by URL (that would load separate copies).
    await page.waitForFunction(() => !!globalThis.__scenarioForgeTestApi, null, { timeout: 60000 });
    await page.evaluate(async () => {
      const { renderer, state, scenarioManager } = await globalThis.__scenarioForgeTestApi.internals();
      window.__rasterTask = { renderer, state, scenarios: scenarioManager };
    });
    await waitRasterStartup(page);
    return { browser, context, page, errors, network, warnings };
  } catch (error) { await browser.close(); throw error; }
}

// Initial navigation and cache reload share the same startup boundary.
export async function waitRasterStartup(page, { timeout = 60000 } = {}) {
  await page.waitForFunction(() => {
    const s = window.__rasterTask.state;
    return s.bootPhase === "ready" && !s.startupReadonly && !s.startupReadonlyUnlockInFlight && !s.scenarioApplyInFlight;
  }, null, { timeout });
}

export async function selectRasterScenario(page, scenarioId) {
  await page.evaluate(async id => {
    const { state, scenarios, renderer } = window.__rasterTask;
    if (state.activeScenarioId !== id) await scenarios.applyScenarioById(id, { renderNow: true });
    renderer.resetZoomToFit();
  }, scenarioId);
  await waitRasterView(page, scenarioId);
}

export async function waitRasterView(page, scenarioId, { timeout = 60000 } = {}) {
  await page.waitForFunction(id => {
    const { renderer, state } = window.__rasterTask;
    const d = renderer.getPoliticalIdRasterDiagnostics();
    return state.activeScenarioId === id && !state.scenarioApplyInFlight && !state.startupReadonly
      && d.selected && !d.pending && d.commits > 0 && !d.failed && d.view
      && ["x", "y", "k"].every(key => Math.abs(d.view[key] - state.zoomTransform[key]) < 1e-7);
  }, scenarioId, { timeout });
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
