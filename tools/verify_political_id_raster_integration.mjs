import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { openRasterApp, waitRasterView } from "./political_id_raster_app_session.mjs";

async function settled(page, precise = false) {
  await page.waitForFunction(needPrecise => {
    const { renderer, state: s } = window.__rasterTask;
    const d = renderer.getPoliticalIdRasterDiagnostics(), c = s.runtimeChunkLoadState || {};
    const background = s.renderPerfMetrics?.drawPoliticalBackgroundFillsPass;
    return (!needPrecise || d.displayState === "precise") && !d.pending && !d.refinementPending
      && !s.renderPassCache?.dirty?.political
      && !!background && (!background.progressive || background.deferredFullCacheReady)
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

async function compareSettledPixels(page, zoom, { captureReference = false } = {}) {
  await settled(page, !captureReference);
  return page.evaluate(({ zoom, captureReference }) => {
    const { state, renderer } = window.__rasterTask;
    const canvas = state.renderPassCache.canvases.political;
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true }); context.drawImage(canvas, 0, 0);
    const pixels = context.getImageData(0, 0, copy.width, copy.height);
    const frame = { transform: { ...state.zoomTransform }, signature: state.renderPassCache.signatures.political,
      background: state.renderPerfMetrics.drawPoliticalBackgroundFillsPass };
    if (captureReference) {
      if (renderer.getPoliticalIdRasterDiagnostics().requested) throw new Error("Reference must use native rendering");
      (window.__rasterReferences ||= new Map()).set(zoom, { pixels, frame });
      return frame;
    }
    const expected = window.__rasterReferences.get(zoom);
    if (!expected || canvas.width !== expected.pixels.width || canvas.height !== expected.pixels.height) throw new Error("View dimensions changed during comparison");
    if (["x", "y", "k"].some(key => Math.abs(frame.transform[key] - expected.frame.transform[key]) > 1e-7)) {
      throw new Error(`Native and raster references must describe the same view: ${JSON.stringify({ expected: expected.frame.transform, actual: frame.transform })}`);
    }
    const actual = pixels.data;
    let total = 0, above32 = 0, maximum = 0, changed = 0;
    for (let i = 0; i < actual.length; i += 4) {
      let difference = 0;
      for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(actual[i + channel] - expected.pixels.data[i + channel]));
      total += difference; if (difference) changed++; if (difference > 32) above32++; maximum = Math.max(maximum, difference);
    }
    return { referenceTransform: expected.frame.transform, currentTransform: frame.transform,
      referenceBackground: expected.frame.background, currentBackground: frame.background,
      referenceSignature: expected.frame.signature, currentSignature: frame.signature,
      pixels: actual.length / 4, changed, maximum, meanMax: total / (actual.length / 4), above32Ratio: above32 / (actual.length / 4) };
  }, { zoom, captureReference });
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
  await page.mouse.move(point.x, point.y);
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
    const probe = window.__rasterInputProbe = { startedAt: null, correctPixelMs: null };
    document.addEventListener("pointerdown", event => { probe.startedAt = event.timeStamp; }, { capture: true, once: true });
    const poll = () => {
      if (probe.startedAt !== null) {
        const current = read();
        for (let i = 0; i < current.length; i += 4) {
          if (current[i + 3] === 255 && [227, 26, 196].every((value, channel) => Math.abs(current[i + channel] - value) <= 3)) {
            probe.correctPixelMs = performance.now() - probe.startedAt; return;
          }
        }
      }
      probe.frame = requestAnimationFrame(poll);
    };
    probe.frame = requestAnimationFrame(poll);
  }, point);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => Object.values(window.__rasterTask.state.visualOverrides).includes("#e31ac4"));
  await page.waitForFunction(() => window.__rasterInputProbe.correctPixelMs !== null, null, { timeout: 10000 });
  const input = await page.evaluate(() => ({ correctPixelMs: window.__rasterInputProbe.correctPixelMs,
    measurement: "pointer event to expected paint color in canvas pixels at requestAnimationFrame; not display presentation" }));
  await settled(page, true);
  const painted = await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides }));
  await page.locator("#undoBtn").click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), before);
  await page.locator("#redoBtn").click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), painted);
  return { paintedIds: Object.keys(painted).filter(id => painted[id] !== before[id]), undo: true, redo: true, ...input };
}

async function brushHistory(page) {
  await page.locator('#customColor').fill('#f0a322');
  await page.locator('#brushModeBtn').click();
  const before = await page.evaluate(() => {
    const { renderer, state } = window.__rasterTask;
    const rect = document.querySelector('#mapContainer').getBoundingClientRect();
    return { colors: { ...state.visualOverrides }, history: state.historyPast.length,
      points: Array.from({ length: 41 }, (_, i) => {
        const xy = renderer.projectGeoToScreen(-124 + i * 0.85, 54 - i * 0.1);
        return { x: xy[0] + rect.left, y: xy[1] + rect.top };
      }) };
  });
  await page.mouse.move(before.points[0].x, before.points[0].y); await page.mouse.down();
  for (const point of before.points.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up(); await settled(page, true);
  const after = await page.evaluate(() => ({ colors: { ...window.__rasterTask.state.visualOverrides },
    history: window.__rasterTask.state.historyPast.length, kind: window.__rasterTask.state.historyPast.at(-1)?.kind }));
  assert.equal(after.history, before.history + 1, 'one continuous stroke must create one history entry');
  assert.equal(after.kind, 'brush-fill');
  const paintedIds = Object.keys(after.colors).filter(id => after.colors[id] !== before.colors[id]);
  assert.ok(paintedIds.length > 1, 'continuous stroke must paint multiple regions');
  assert.ok(paintedIds.every(id => after.colors[id] === '#f0a322'));
  await page.locator('#undoBtn').click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), before.colors);
  await page.locator('#redoBtn').click(); await settled(page, true);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__rasterTask.state.visualOverrides })), after.colors);
  await page.locator('#brushModeBtn').click();
  return { paintedIds, pointerSteps: before.points.length, historyEntries: 1, undo: true, redo: true };
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
    window.__rasterAssetFaults.recoveryTimeouts = 1;
    return window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics();
  });
  assert.equal(protectedState.failed, "");
  assert.equal(protectedState.assetFailureKind, "timeout");
  // Even the first probe can time out. Covered Worker output must recover
  // without toggling the trial, reloading, or manufacturing more tile demand.
  await page.waitForFunction(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().assetRecoveries >= 1,
    null, { timeout: 30000 });
  await waitRasterView(page, scenarioId); await settled(page, true);
  if (await page.locator("#scenarioGuidePopover").isVisible()) await page.locator("#scenarioGuideCloseBtn").click();
  const recovered = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
  assert.ok(recovered.assetProbes >= 2, "the same owner must recover after a failed probe");
  assert.ok(recovered.assetRecoveries >= 1, "a probe must admit a validated asset");
  assert.ok(recovered.assetHits > 0);
  assert.equal(recovered.assetErrors, 0, "real asset failures must not be hidden by later recovery");
  assert.equal(recovered.assets.failures, 0);
  assert.equal(recovered.assetError, ""); assert.equal(recovered.failed, "");
  assert.equal(recovered.assetRecovery.state, "ready");
  return { injected: await page.evaluate(() => window.__rasterAssetFaults), protectedState, recovered };
}

export async function createRasterIntegrationCheck({ baseUrl, scenarioId, dpr = 1, viewport = { width: 1280, height: 900 },
  output = ".runtime/browser/raster-integration", published = false, recoverAssets = false,
  exerciseBrush = true, interactionOnly = false, requirePrebuiltAssets = true }) {
  if (!baseUrl) throw new Error("--base-url is required");
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  const referenceUrl = new URL(baseUrl);
  // The opt-in producer already excludes these alternative bitmap producers.
  // Disable them for the paired OFF frame so the oracle is native Canvas.
  referenceUrl.searchParams.set("geometry_worker", "0");
  referenceUrl.searchParams.set("political_raster_worker_bitmap", "0");
  const startupStarted = performance.now();
  const session = await openRasterApp(referenceUrl.href, { scenarioId, dpr, viewport, enabled: null, published, holdRasterAssets: recoverAssets });
  const { page } = session;
  const report = { scenarioId, dpr, viewport, requirePrebuiltAssets, baseUrl, views: [], completedStages: [], timings: { startupMs: performance.now() - startupStarted } };
  async function runPhase(name, action) {
    const started = performance.now();
    const watchdog = setTimeout(() => { void session.browser.close(); }, 120000);
    try {
      await action();
      report.completedStages.push(name);
    } catch (error) {
      report.passed = false; report.error = String(error.stack || error); report.failedStage = name;
      try { report.failureDiagnostics = await page.evaluate(() => {
        const { renderer, state: s } = window.__rasterTask;
        return { raster: renderer.getPoliticalIdRasterDiagnostics(), faults: window.__rasterAssetFaults,
          phase: s.renderPhase, scenario: s.activeScenarioId, isInteracting: s.isInteracting,
          dirty: s.renderPassCache?.dirty, background: s.renderPerfMetrics?.drawPoliticalBackgroundFillsPass,
          deferExactAfterSettle: s.deferExactAfterSettle, exactAfterSettleHandle: s.exactAfterSettleHandle,
          activePostReadyTaskKey: s.activePostReadyTaskKey, scenarioApplyInFlight: s.scenarioApplyInFlight,
          chunks: Object.fromEntries(["pendingReason", "refreshScheduled", "promotionScheduled", "pendingPromotion",
            "pendingInfraPromotion", "promotionCommitInFlight"].map(key => [key, s.runtimeChunkLoadState?.[key]])),
          status: document.querySelector("#politicalRasterTrialStatus")?.textContent };
      }); } catch { /* browser watchdog */ }
      throw error;
    } finally {
      clearTimeout(watchdog);
      report.timings[name] = performance.now() - started;
      console.log(JSON.stringify({ rasterPhase: name, scenarioId, dpr, durationMs: report.timings[name], failed: report.failedStage === name }));
    }
  }
  async function prepareNativeReferences() {
    assert.equal(await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics().requested), false);
    assert.equal(session.network.length, 0, "default-off must not download raster assets");
    await toggle(page, false);
    await settled(page);
    // Capture both complete native views once. Repeated OFF/ON cycles dispose
    // the owner and repeat cold loading, obscuring same-owner recovery and
    // consuming the release budget without adding coverage.
    for (const zoom of interactionOnly ? [] : [130, 100]) {
      await page.evaluate(value => window.__rasterTask.renderer.setZoomPercent(value), zoom);
      await page.waitForFunction(value => Math.abs(window.__rasterTask.state.zoomTransform.k - value / 100) < 1e-7, zoom);
      await compareSettledPixels(page, zoom, { captureReference: true });
    }
  }
  async function verifyRecoveryAndZoom() {
    await toggle(page, true);
    if (recoverAssets) report.recovery = await verifyRecovery(page, scenarioId);
    await waitRasterView(page, scenarioId);
    // Verify the already-covered 100% frame, then exercise the real zoom input.
    for (const zoom of interactionOnly ? [] : [100, 130]) {
      await page.locator("#zoomPercentInput").fill(`${zoom}%`);
      await page.locator("#zoomPercentInput").press("Enter");
      await page.waitForFunction(value => Math.abs(window.__rasterTask.state.zoomTransform.k - value / 100) < 1e-7, zoom);
      await waitRasterView(page, scenarioId); await settled(page, true);
      const diagnostics = await page.evaluate(() => window.__rasterTask.renderer.getPoliticalIdRasterDiagnostics());
      if (requirePrebuiltAssets) assert.ok(diagnostics.assetHits > 0, "must use pregenerated coverage");
      else assert.ok(diagnostics.assetHits + diagnostics.builds > 0, "the viewport must have validated asset or Worker coverage");
      assert.equal(diagnostics.failed, ""); assert.equal(diagnostics.assetError, "");
      const pixels = await compareSettledPixels(page, zoom);
      report.views.push({ zoom, diagnostics, pixels });
      assert.equal(pixels.changed, 0, "settled political pixels must match native reference");
    }
  }
  async function verifyEditing() {
    report.edit = await editHistory(page);
    if (exerciseBrush) report.brush = await brushHistory(page);
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
    await page.evaluate(() => {
      const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
      window.__editedRasterPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    });
    await toggle(page, false); await settled(page);
    report.editedPixels = await page.evaluate(() => {
      const canvas = window.__rasterTask.state.renderPassCache.canvases.political;
      const before = window.__editedRasterPixels;
      if (before.width !== canvas.width || before.height !== canvas.height) throw Error('Edited view dimensions changed');
      const after = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let changed = 0;
      for (let i = 0; i < after.data.length; i += 4) {
        if ([0, 1, 2, 3].some(channel => before.data[i + channel] !== after.data[i + channel])) changed++;
      }
      return { changed, pixels: canvas.width * canvas.height };
    });
    assert.equal(report.editedPixels.changed, 0, 'paint and brush must retain exact native pixels');
    assert.deepEqual(session.errors, []);
    report.passed = true;
  }
  async function close() {
    await session.browser.close();
    report.passed = report.passed === true;
    report.network = session.network; report.warnings = session.warnings; report.errors = session.errors;
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, `${scenarioId}-dpr${dpr}.json`), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ scenarioId, dpr, passed: report.passed, error: report.error,
      recovery: report.recovery ? { injected: report.recovery.injected, probes: report.recovery.recovered.assetProbes,
        recoveries: report.recovery.recovered.assetRecoveries, hits: report.recovery.recovered.assetHits } : undefined,
      views: report.views.map(view => ({ zoom: view.zoom, hits: view.diagnostics.assetHits, builds: view.diagnostics.builds, pixels: view.pixels })),
      edit: report.edit, brush: report.brush, editedPixels: report.editedPixels, completedStages: report.completedStages, timings: report.timings }));
  }
  return { session, report, close,
    prepare: () => runPhase("native-reference", prepareNativeReferences),
    recoverAndZoom: () => runPhase("recovery-zoom", verifyRecoveryAndZoom),
    edit: () => runPhase("editing-history", verifyEditing) };
}

export async function verifyRasterIntegrationCase(options) {
  const check = await createRasterIntegrationCheck(options);
  const watchdog = setTimeout(() => { void check.session.browser.close(); }, 120000);
  try {
    await check.prepare(); await check.recoverAndZoom(); await check.edit();
    return check.report;
  } finally {
    clearTimeout(watchdog);
    await check.close();
  }
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
