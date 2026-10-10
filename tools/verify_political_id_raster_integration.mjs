import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { openRasterApp, waitRasterView } from "./political_id_raster_app_session.mjs";

async function settled(page, precise = false) {
  await page.waitForFunction(needPrecise => {
    const { renderer, state: s } = window.__rasterTask;
    const d = renderer.getPoliticalIdRasterDiagnostics(), c = s.runtimeChunkLoadState || {};
    return (!needPrecise || d.displayState === "precise") && !d.pending && !d.refinementPending
      && !s.scenarioApplyInFlight && !s.isInteracting && s.renderPhase === "idle"
      && !s.deferExactAfterSettle && !s.exactAfterSettleHandle && !s.activePostReadyTaskKey
      && !c.pendingReason && !c.refreshScheduled && !c.promotionScheduled
      && !c.pendingPromotion && !c.pendingInfraPromotion && !c.promotionCommitInFlight;
  }, precise, { timeout: 30000 });
}

async function toggle(page, enabled) {
  const wasCollapsed = await page.evaluate(() => document.body.classList.contains("left-sidebar-collapsed"));
  if (wasCollapsed) await page.locator("#leftSidebarCollapseBtn").click();
  if (!(await page.locator("#politicalRasterTrial").isVisible())) {
    await page.locator("#editorTaskLayersBtn").click();
    await page.locator("#appearanceTabBorders").click();
  }
  const control = page.locator("#politicalRasterTrial");
  await control.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
  });
  await control.setChecked(enabled);
  assert.equal(await control.isChecked(), enabled);
  if (wasCollapsed) await page.locator("#leftSidebarCollapseBtn").click();
}

async function compareSettledPixels(page) {
  await settled(page, true);
  await page.evaluate(() => {
    const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true }); context.drawImage(canvas, 0, 0);
    window.__rasterReference = context.getImageData(0, 0, copy.width, copy.height);
    window.__rasterReferenceTransform = { ...window.__rasterTask.state.zoomTransform };
  });
  await toggle(page, false);
  await settled(page);
  return page.evaluate(() => {
    const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
    const expected = window.__rasterReference;
    if (canvas.width !== expected.width || canvas.height !== expected.height) throw new Error("View dimensions changed during comparison");
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true }); context.drawImage(canvas, 0, 0);
    const actual = context.getImageData(0, 0, copy.width, copy.height).data;
    let total = 0, above32 = 0, maximum = 0, changed = 0;
    for (let i = 0; i < actual.length; i += 4) {
      let difference = 0;
      for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(actual[i + channel] - expected.data[i + channel]));
      total += difference; if (difference) changed++; if (difference > 32) above32++; maximum = Math.max(maximum, difference);
    }
    return { referenceTransform: window.__rasterReferenceTransform, currentTransform: { ...window.__rasterTask.state.zoomTransform }, pixels: actual.length / 4, changed, maximum, meanMax: total / (actual.length / 4), above32Ratio: above32 / (actual.length / 4) };
  });
}

async function editHistory(page) {
  if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
  await page.locator("#paintModeVisualBtn").click();
  await page.locator("#toolFillBtn").click();
  await page.locator("#customColor").fill("#e31ac4");
  const point = await page.evaluate(() => {
    const xy = window.__rasterTask.renderer.projectGeoToScreen(-110, 56);
    const rect = document.querySelector("#mapContainer").getBoundingClientRect();
    return { x: rect.left + xy[0], y: rect.top + xy[1] };
  });
  const before = await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides }));
  await page.evaluate(({ x, y }) => {
    const scratch = document.createElement("canvas"); scratch.width = 9; scratch.height = 9;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    const read = () => {
      context.clearRect(0, 0, 9, 9);
      for (const id of ["map-canvas", "map-political-patch-canvas", "map-interaction-overlay-canvas"]) {
        const canvas = document.getElementById(id);
        if (!canvas || getComputedStyle(canvas).display === "none") continue;
        const rect = canvas.getBoundingClientRect();
        context.drawImage(canvas, Math.floor((x - rect.left) * canvas.width / rect.width) - 4,
          Math.floor((y - rect.top) * canvas.height / rect.height) - 4, 9, 9, 0, 0, 9, 9);
      }
      return context.getImageData(0, 0, 9, 9).data;
    };
    const baseline = read();
    const probe = window.__rasterInputProbe = { startedAt: null, firstChangedPixelMs: null };
    document.addEventListener("pointerdown", event => { probe.startedAt = event.timeStamp; }, { capture: true, once: true });
    const poll = () => {
      if (probe.startedAt !== null) {
        const current = read();
        if (current.some((value, index) => Math.abs(value - baseline[index]) > 16)) {
          probe.firstChangedPixelMs = performance.now() - probe.startedAt; return;
        }
      }
      probe.frame = requestAnimationFrame(poll);
    };
    probe.frame = requestAnimationFrame(poll);
  }, point);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => Object.values(window.__rasterTask.state.visualOverrides).includes("#e31ac4"));
  await page.waitForFunction(() => window.__rasterInputProbe.firstChangedPixelMs !== null, null, { timeout: 10000 });
  const input = await page.evaluate(() => ({ firstChangedPixelMs: window.__rasterInputProbe.firstChangedPixelMs,
    measurement: "pointer event to first changed canvas pixels observed at requestAnimationFrame; not display presentation" }));
  await settled(page, true);
  const painted = await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides }));
  await page.locator("#undoBtn").click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), before);
  await page.locator("#redoBtn").click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), painted);
  return { paintedIds: Object.keys(painted).filter(id => painted[id] !== before[id]), undo: true, redo: true, ...input };
}

async function verifyRecovery(page, scenarioId) {
  await page.waitForFunction(() => {
    const d = window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics();
    return window.__rasterAssetFaults.aborted >= 3 && d.assetRecovery?.consecutiveTimeouts >= 3;
  }, null, { timeout: 30000 });
  const protectedState = await page.evaluate(() => {
    // Startup promotion can cancel obsolete requests. Release the fault only
    // when the current owner has actually reached its timeout protection.
    window.__rasterAssetFaults.active = false;
    return window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics();
  });
  assert.equal(protectedState.failed, "");
  assert.equal(protectedState.assetFailureKind, "timeout");
  await waitRasterView(page, scenarioId); await settled(page, true);
  await page.waitForFunction(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().assetRecovery.retryInMs === 0);
  if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
  await page.locator("#zoomPercentInput").fill("130%");
  await page.locator("#zoomPercentInput").press("Enter");
  await page.waitForFunction(() => Math.abs(window.__rasterTask.state.zoomTransform.k - 1.3) < 1e-7);
  await waitRasterView(page, scenarioId); await settled(page, true);
  const recovered = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
  assert.ok(recovered.assetProbes >= 1, "the same owner must probe after cooldown");
  assert.ok(recovered.assetRecoveries >= 1, "a probe must admit a validated asset");
  assert.ok(recovered.assetHits > 0);
  assert.equal(recovered.assetErrors, 0, "real asset failures must not be hidden by later recovery");
  assert.equal(recovered.assets.failures, 0);
  assert.equal(recovered.assetError, ""); assert.equal(recovered.failed, "");
  assert.equal(recovered.assetRecovery.state, "ready");
  return { injected: await page.evaluate(() => window.__rasterAssetFaults), protectedState, recovered };
}

export async function verifyRasterIntegrationCase({ baseUrl, scenarioId, dpr = 1,
  output = ".runtime/browser/raster-integration", published = false, recoverAssets = false }) {
  if (!baseUrl) throw new Error("--base-url is required");
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  const referenceUrl = new URL(baseUrl);
  // The opt-in producer already excludes these alternative bitmap producers.
  // Disable them for the paired OFF frame so the oracle is native Canvas.
  referenceUrl.searchParams.set("geometry_worker", "0");
  referenceUrl.searchParams.set("political_raster_worker_bitmap", "0");
  const session = await openRasterApp(referenceUrl.href, { scenarioId, dpr, enabled: null, published, holdRasterAssets: recoverAssets });
  const { page } = session;
  const report = { scenarioId, dpr, baseUrl, views: [] };
  const watchdog = setTimeout(() => { void session.browser.close(); }, 120000);
  try {
    assert.equal(await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().requested), false);
    assert.equal(session.network.length, 0, "default-off must not download raster assets");
    await settled(page);
    await toggle(page, true);
    if (recoverAssets) report.recovery = await verifyRecovery(page, scenarioId);
    await waitRasterView(page, scenarioId);
    for (const zoom of [100, 130]) {
      await page.evaluate(value => window.__rasterTask.renderer.setZoomPercent(value), zoom);
      await page.waitForFunction(value => Math.abs(window.__rasterTask.state.zoomTransform.k - value / 100) < 1e-7, zoom);
      await waitRasterView(page, scenarioId); await settled(page, true);
      const diagnostics = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      assert.ok(diagnostics.assetHits > 0, "must use pregenerated coverage");
      assert.equal(diagnostics.failed, ""); assert.equal(diagnostics.assetError, "");
      const pixels = await compareSettledPixels(page);
      report.views.push({ zoom, diagnostics, pixels });
      assert.equal(pixels.changed, 0, "settled political pixels must match native reference");
      await toggle(page, true); await waitRasterView(page, scenarioId); await settled(page, true);
    }
    report.edit = await editHistory(page);
    report.status = await page.locator("#politicalRasterTrialStatus").textContent();
    report.states = await page.evaluate(() => window.__rasterStates);
    assert.ok(report.states.some(value => value.displayState === "accelerated"));
    assert.ok(report.states.some(value => value.displayState === "precise"));
    report.preference = await page.evaluate(async () => {
      const { readPoliticalIdRasterPreference } = await import(new URL("js/core/renderer/political_id_raster_trial.js", document.baseURI));
      return { saved: readPoliticalIdRasterPreference({ search: "" }), forcedOff: readPoliticalIdRasterPreference({ search: "?political_id_raster=0" }) };
    });
    assert.deepEqual(report.preference, { saved: true, forcedOff: false });
    if (dpr === 1) await page.screenshot({ path: path.join(output, `${scenarioId}.png`) });
    assert.deepEqual(session.errors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false; report.error = String(error.stack || error);
    try { report.failureDiagnostics = await page.evaluate(() => ({ raster: window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics(), faults: window.__rasterAssetFaults,
      phase: window.__rasterTask.state.renderPhase, scenario: window.__rasterTask.state.activeScenarioId,
      status: document.querySelector("#politicalRasterTrialStatus")?.textContent })); } catch { /* browser watchdog */ }
    throw error;
  } finally {
    clearTimeout(watchdog);
    report.network = session.network; report.warnings = session.warnings; report.errors = session.errors;
    await fs.writeFile(path.join(output, `${scenarioId}-dpr${dpr}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ scenarioId, dpr, passed: report.passed, error: report.error,
      recovery: report.recovery ? { injected: report.recovery.injected, probes: report.recovery.recovered.assetProbes,
        recoveries: report.recovery.recovered.assetRecoveries, hits: report.recovery.recovered.assetHits } : undefined,
      views: report.views.map(view => ({ zoom: view.zoom, hits: view.diagnostics.assetHits, builds: view.diagnostics.builds, pixels: view.pixels })), edit: report.edit }));
    await session.browser.close();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flags = new Map();
  for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1]);
  const ids = flags.has("--scenario") ? [flags.get("--scenario")] : ["hoi4_1936", "hoi4_1939", "tno_1962"];
  const dprs = flags.has("--dpr") ? [Number(flags.get("--dpr"))] : [1, 2];
  for (const scenarioId of ids) for (const dpr of dprs) await verifyRasterIntegrationCase({
    baseUrl: flags.get("--base-url"), scenarioId, dpr, output: flags.get("--output"),
    published: flags.get("--published") === "true", recoverAssets: flags.get("--recover") === "true",
  });
}
