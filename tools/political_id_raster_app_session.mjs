import { chromium } from "playwright";

export async function openRasterApp(baseUrl, { dpr = 1, build = false, scenarioId = "", enabled = true, savedPreference = null, language = null, published = false, holdRasterAssets = false } = {}) {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const publishedTarget = url.origin === "https://raederhans.github.io" && url.pathname === "/scenario-forge/app/";
  if (!local && !(published && !build && publishedTarget)) throw new Error("Use localhost, or explicitly opt into verifying the published Scenario Forge app.");
  if (enabled === null) url.searchParams.delete("political_id_raster");
  else url.searchParams.set("political_id_raster", enabled ? "1" : "0");
  if (scenarioId) url.searchParams.set("default_scenario", scenarioId);
  if (build) url.searchParams.set("political_id_assets", "0");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.addInitScript(({ savedPreference, language, holdRasterAssets }) => {
      if (savedPreference !== null) localStorage.setItem("scenario-forge-political-id-raster", savedPreference ? "1" : "0");
      if (language) localStorage.setItem("map_lang", language);
      // Faults exist only in this isolated test context; production deadlines
      // and recovery policy remain untouched.
      const faults = window.__rasterAssetFaults = { active: holdRasterAssets, intercepted: 0, aborted: 0 };
      const fetchActual = globalThis.fetch.bind(globalThis);
      if (holdRasterAssets) globalThis.fetch = (input, options = {}) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        if (faults.active && url.pathname.includes("/political_id_raster/")
          && url.pathname.endsWith(".pidr.gz")) {
          faults.intercepted++;
          return new Promise((_resolve, reject) => {
            const signal = options.signal || (input instanceof Request ? input.signal : null);
            if (!signal) { reject(new Error("Fault injection requires an abortable asset request")); return; }
            const abort = () => { faults.aborted++; reject(signal.reason); };
            if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
          });
        }
        return fetchActual(input, options);
      };
    }, { savedPreference, language, holdRasterAssets });
    const errors = [], network = [], warnings = [];
    page.on("response", response => {
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
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(async () => {
      const renderer = await import(new URL("js/core/map_renderer.js", document.baseURI));
      const { state } = await import(new URL("js/core/state.js", document.baseURI));
      const scenarios = await import(new URL("js/core/scenario_manager.js", document.baseURI));
      window.__rasterTask = { renderer, state, scenarios };
    });
    await page.waitForFunction(() => {
      const s = window.__rasterTask.state;
      return s.bootPhase === "ready" && !s.startupReadonly && !s.startupReadonlyUnlockInFlight && !s.scenarioApplyInFlight;
    }, null, { timeout: 60000 });
    return { browser, context, page, errors, network, warnings };
  } catch (error) { await browser.close(); throw error; }
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
