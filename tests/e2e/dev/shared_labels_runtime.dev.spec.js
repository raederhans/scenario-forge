const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require("../support/playwright-app");
const { DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("../support/startup-paths");

// JUSTIFY: real Modern startup and seven label/cache/export frames took 60-80s at actual DPR 1/1.25/2; retain a fixed 120s total cap and bounded fixture waits.
test.setTimeout(120_000);

const LABELS = ["FixtureCity", "FixtureAir", "FixturePort"];

async function waitForFixtureRenderIdle(page, { timeout = 10_000 } = {}) {
  await page.waitForFunction(() => {
    const probe = globalThis.__sharedLabelsRuntimeProbe;
    if (!probe) return false;
    probe.assertFixtureData();
    const { state } = probe;
    const cache = state.renderPassCache;
    const settled = state.renderPhase === "idle"
      && !state.scenarioApplyInFlight && !state.startupReadonlyUnlockInFlight
      && !state.deferExactAfterSettle && !state.exactAfterSettleHandle
      && !state.zoomRenderScheduled && !state.pendingZoomTransform && !state.renderPhaseTimerId
      && !!cache?.canvases?.labels && !!cache?.canvases?.contextMarkers
      && !cache.dirty.labels && !cache.dirty.contextMarkers;
    const signature = JSON.stringify([
      state.width, state.height, state.zoomTransform, probe.labelClears, probe.markerClears,
    ]);
    const stable = settled && signature === probe.lastIdleSignature;
    probe.lastIdleSignature = settled ? signature : null;
    return stable;
  }, undefined, { timeout, polling: "raf" });
}

function expectSharedFrame(frame, { city = true } = {}) {
  const expected = city ? LABELS : LABELS.slice(1);
  expect(frame.draws.map((row) => row.text).sort()).toEqual([...expected].sort());
  for (const row of frame.draws) {
    expect(row.family, row.text).toBe(row.text === LABELS[0] ? "city" : "facility");
    expect(row.paintedPixels, `${row.text}: actual labels-pass glyph pixels`).toBeGreaterThan(0);
    expect(row.box.w).toBeGreaterThan(0);
    expect(row.box.h).toBeGreaterThan(0);
    expect(row.box.x).toBeGreaterThanOrEqual(0);
    expect(row.box.y).toBeGreaterThanOrEqual(0);
    expect(row.box.x + row.box.w).toBeLessThan(frame.viewport.width);
    expect(row.box.y + row.box.h).toBeLessThan(frame.viewport.height);
  }
  for (let i = 0; i < frame.draws.length; i += 1) {
    for (let j = i + 1; j < frame.draws.length; j += 1) {
      const a = frame.draws[i].box;
      const b = frame.draws[j].box;
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x
        && a.y < b.y + b.h && a.y + a.h > b.y;
      expect(overlaps, `${frame.draws[i].text} overlaps ${frame.draws[j].text}`).toBe(false);
    }
  }
  expect(frame.export.changedPixels, "labels export must equal the visible crop of the labels pass").toBe(0);
  expect(frame.export.paintedPixels).toBeGreaterThan(0);
}

async function captureFrame(page, action) {
  return page.evaluate(async (operation) => {
    const probe = globalThis.__sharedLabelsRuntimeProbe;
    const { state, renderer } = probe;
    probe.assertFixtureData();
    const invalidateFixturePasses = () => {
      probe.actions.invalidateRenderPasses(["contextMarkers", "labels"], "shared-labels-fixture");
    };
    if (operation === "labels-only") {
      // Exercise the real cache consumer without rebuilding contextMarkers candidates.
      probe.actions.invalidateRenderPasses("labels", "shared-labels-fixture-labels-only");
    } else if (operation === "city-off" || operation === "city-on") {
      probe.actions.commitUiVisibilityState(state, { showCityPoints: operation === "city-on" });
      invalidateFixturePasses();
    } else {
      const projected = renderer.projectGeoToScreen(0, 0);
      const previous = state.zoomTransform;
      const worldX = (projected[0] - previous.x) / previous.k;
      const worldY = (projected[1] - previous.y) / previous.k;
      const next = globalThis.d3.zoomIdentity
        .translate(state.width * 0.5 - worldX * 4, state.height * 0.5 - worldY * 4).scale(4);
      if (Math.abs(next.x - previous.x) > 0.001 || Math.abs(next.y - previous.y) > 0.001 || next.k !== previous.k) {
        probe.actions.setZoomTransformState(state, next);
        renderer.invalidateAllRenderPasses("shared-labels-fixture-viewport");
      } else {
        invalidateFixturePasses();
      }
    }
    const markerClearsBefore = probe.markerClears;
    const labelClearsBefore = probe.labelClears;
    renderer.render();
    const exportCanvas = renderer.renderExportPassesToCanvas(["labels"]);
    if (!exportCanvas) throw new Error("labels export canvas is unavailable");
    const cache = state.renderPassCache;
    const canvas = cache.canvases.labels;
    const context = canvas.getContext("2d");
    const layout = cache.layouts.labels;
    const dpr = Number(state.dpr || 1);
    const offsetX = Math.round(Number(layout.offsetX || 0) * dpr);
    const offsetY = Math.round(Number(layout.offsetY || 0) * dpr);
    // Independent pixel crop: no reuse of the production compositor under test.
    const reference = context.getImageData(offsetX, offsetY, exportCanvas.width, exportCanvas.height);
    const exported = exportCanvas.getContext("2d").getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    let changedPixels = 0;
    let paintedPixels = 0;
    for (let i = 0; i < reference.data.length; i += 4) {
      if (reference.data[i + 3]) paintedPixels += 1;
      if ([0, 1, 2, 3].some((channel) => reference.data[i + channel] !== exported.data[i + channel])) changedPixels += 1;
    }
    const draws = probe.draws.map((row) => {
      const x = Math.max(0, Math.floor(row.deviceBox.x));
      const y = Math.max(0, Math.floor(row.deviceBox.y));
      const w = Math.min(canvas.width - x, Math.ceil(row.deviceBox.x + row.deviceBox.w) - x);
      const h = Math.min(canvas.height - y, Math.ceil(row.deviceBox.y + row.deviceBox.h) - y);
      const pixels = w > 0 && h > 0 ? context.getImageData(x, y, w, h).data : [];
      let ink = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) ink += 1;
      return { ...row, paintedPixels: ink };
    });
    return {
      action: operation, draws, viewport: { width: state.width, height: state.height },
      pixelDensity: {
        device: devicePixelRatio, effective: dpr,
        runtimeProfile: state.renderProfile, stage: state.dprStage,
        policyMax: probe.pixelRatioPolicy.getMaxDprForProfile(state.renderProfile),
      },
      anchor: renderer.projectGeoToScreen(0, 0), transform: { ...state.zoomTransform },
      markerClears: probe.markerClears - markerClearsBefore,
      labelClears: probe.labelClears - labelClearsBefore,
      export: { changedPixels, paintedPixels, width: exportCanvas.width, height: exportCanvas.height, offsetX, offsetY },
      datasetCounts: { city: state.worldCitiesData.features.length, airport: state.airportsData.features.length, port: state.portsData.features.length },
    };
  }, action);
}

async function runSharedLabelsFixture({ page }, testInfo, density) {
  const outputDir = path.resolve(".runtime/browser/visual-correctness/shared-labels", `dpr-${density}`);
  const renderProfile = density === 2 ? "full" : "balanced";
  const report = { mode: "synthetic-data-real-app-renderer", scenario: "modern_world", requestedDpr: density, renderProfile, frames: [], pageErrors: [] };
  page.on("pageerror", (error) => report.pageErrors.push(String(error.message)));
  try {
    const url = new URL(toRootPath(DEFAULT_FAST_APP_OPEN_PATH), "http://127.0.0.1");
    url.searchParams.set("default_scenario", "modern_world");
    url.searchParams.set("render_profile", renderProfile);
    await gotoApp(page, `${url.pathname}${url.search}`, { waitUntil: "domcontentloaded" });
    report.resolvedUrl = page.url();
    await waitForAppInteractive(page, { timeout: 60_000 });
    await waitForRenderIdle(page, { scenarioId: "modern_world", timeout: 25_000, requireInfra: false });

    // Startup's interactive gate precedes post-ready hydration. Finish the real
    // resource lifecycle before replacing its data; otherwise delayed city and
    // scenario commits can race the fixture and block the browser main thread.
    await page.evaluate(async () => {
      const { state } = await import("/js/core/state.js");
      const preparation = { state, startedAt: performance.now(), loaded: false, error: "" };
      globalThis.__sharedLabelPreparation = preparation;
      for (const hook of ["ensureBaseCityDataFn", "ensureContextLayerDataFn", "ensureFullLocalizationDataReadyFn"]) {
        if (typeof state[hook] !== "function") throw new Error(`Missing real application hook: ${hook}`);
      }
      const options = { reason: "shared-labels-before-fixture", renderNow: false };
      preparation.promise = Promise.all([
        state.ensureBaseCityDataFn(options),
        state.ensureContextLayerDataFn(["airports", "ports"], options),
        state.ensureFullLocalizationDataReadyFn(options),
      ]).then(() => { preparation.loaded = true; }, (error) => { preparation.error = String(error.stack || error); });
    });
    await page.waitForFunction(() => {
      const preparation = globalThis.__sharedLabelPreparation;
      if (preparation.error) throw new Error(preparation.error);
      const { state } = preparation;
      const diagnostics = state.postReadyTaskDiagnostics;
      return preparation.loaded
        && state.baseCityDataState === "loaded"
        && !!state.worldCitiesData?.features?.length
        && !!state.airportsData?.features?.length && !!state.portsData?.features?.length
        && !!diagnostics && diagnostics.pendingTaskCount === 0 && !state.activePostReadyTaskKey
        && !Object.values(state.contextLayerLoadPromiseByName || {}).some(Boolean)
        && !state.scenarioApplyInFlight && !state.startupReadonlyUnlockInFlight;
    }, undefined, { timeout: 55_000 });
    report.preFixtureLifecycle = await page.evaluate(() => {
      const { state, startedAt } = globalThis.__sharedLabelPreparation;
      return {
        durationMs: performance.now() - startedAt,
        cityCount: state.worldCitiesData.features.length,
        airportCount: state.airportsData.features.length,
        portCount: state.portsData.features.length,
        postReady: state.postReadyTaskDiagnostics,
      };
    });
    report.profileConfiguration = await page.evaluate(async (requestedProfile) => {
      const { state } = await import("/js/core/state.js");
      const before = state.renderProfile;
      const manifestDefault = state.activeScenarioManifest?.performance_hints?.render_profile_default;
      if (requestedProfile === "full") {
        // Scenario activation overrides the URL with its manifest default.
        // Configure this synthetic fixture through the production presentation
        // owner, preserving other hints and the original manifest object.
        const { createScenarioDisplayRestoreRuntime } = await import("/js/core/scenario/presentation_display_restore.js");
        createScenarioDisplayRestoreRuntime({ state }).applyScenarioPerformanceHints({
          ...state.activeScenarioManifest,
          performance_hints: { ...state.activeScenarioManifest.performance_hints, render_profile_default: "full" },
        });
        // The existing resize handler calculates DPR and resizes real surfaces.
        // Do not assign DPR or canvas dimensions from the test.
        window.dispatchEvent(new Event("resize"));
      }
      return {
        resolvedUrl: location.href, requestedProfile, manifestDefault,
        before, after: state.renderProfile, dprAfter: state.dpr, stageAfter: state.dprStage,
        source: requestedProfile === "full" ? "fixture-performance-hints-via-production-presentation-owner" : "scenario-default",
      };
    }, renderProfile);

    await page.evaluate(async (labels) => {
      const { state } = await import("/js/core/state.js");
      const renderer = await import("/js/core/map_renderer.js");
      const { normalizeCityFeatureCollection } = await import("/js/core/data_loader.js");
      const {
        commitBaseCitySupportData,
        commitContextLayerCollection,
        setCurrentLanguage,
      } = await import("/js/core/state/content_state.js");
      const { applyScenarioChunkCityExternalEffectState } = await import("/js/core/state/actions/scenario_presentation_actions.js");
      const { commitUiVisibilityState } = await import("/js/core/state/actions/ui_visibility_actions.js");
      const { setZoomTransformState } = await import("/js/core/state/actions/renderer_interaction_actions.js");
      const { patchAppearanceStyleGroupState } = await import("/js/core/state/actions/appearance_actions.js");
      const { applyTransportWorkbenchOverviewState } = await import("/js/core/state/actions/transport_actions.js");
      const { createRenderCacheOwner } = await import("/js/core/renderer/render_cache_owner.js");
      const icons = await import("/js/core/renderer/transport_facility_icons.js");
      const { createPixelRatioPolicy } = await import("/js/core/renderer/pixel_ratio_policy.js");
      await Promise.all([
        document.fonts.load('600 13px "Libre Baskerville"'),
        document.fonts.load('600 10px "IBM Plex Sans"'),
      ]);
      await document.fonts.ready;
      // Finish already-started loads before installing the controlled inputs.
      await Promise.all([
        state.baseCityDataPromise,
        ...Object.entries(state.contextLayerLoadPromiseByName || {})
          .filter(([name]) => /^(?:airports?|ports?|cities)$/i.test(name))
          .map(([, promise]) => promise),
      ].filter(Boolean));
      const feature = (id, name, coordinates, extra = {}) => ({
        type: "Feature", id, geometry: { type: "Point", coordinates },
        properties: { id, name, ...extra },
      });
      const collection = (...features) => ({ type: "FeatureCollection", features });
      // This fixture verifies the shared label pass; keep collision policy out of its acceptance surface.
      const city = feature("CITY::shared-label-fixture", labels[0], [-12, 0], {
        name_en: labels[0], name_zh: labels[0], country_code: "ZZ", population: 5_000_000,
        is_country_capital: true, is_capital: true, base_tier: "major", min_zoom: 0.5,
      });
      commitBaseCitySupportData(state, {
        worldCities: normalizeCityFeatureCollection(collection(city), { sourceLabel: "shared-label-fixture" }),
      }, { scenarioActive: true });
      applyScenarioChunkCityExternalEffectState(state, null);
      commitContextLayerCollection(state, "airports", collection(feature("shared-air", labels[1], [0, 0], { importance_rank: 3, iata: "FXA" })));
      commitContextLayerCollection(state, "ports", collection(feature("shared-port", labels[2], [12, 0], { importance_rank: 3 })));
      setCurrentLanguage(state, "en");
      commitUiVisibilityState(state, {
        showCityPoints: true, showTransport: true, showAirports: true, showPorts: true,
        showRoad: false, showRail: false,
      });
      patchAppearanceStyleGroupState(state, "cityPoints", {
        showLabels: true, labelSize: 13, labelMinZoom: 0.5, labelDensity: "dense",
      });
      applyTransportWorkbenchOverviewState(state, { visualMode: "distribution" });
      for (const familyId of ["airport", "port"]) {
        applyTransportWorkbenchOverviewState(state, {
          familyId,
          familyConfig: { labelsEnabled: true, labelMode: "name", labelDensity: "dense", labelSize: 10 },
        });
      }
      icons.getTransportFacilityIconAtlasImage();
      const fixtureRenderCacheOwner = createRenderCacheOwner({
        state,
        constants: { renderPassNames: Object.keys(state.renderPassCache.dirty || {}) },
        helpers: { ensureRenderPassCacheState: () => state.renderPassCache },
      });
      const probe = {
        state, renderer, icons, draws: [], markerClears: 0, labelClears: 0,
        actions: {
          commitUiVisibilityState,
          invalidateRenderPasses: fixtureRenderCacheOwner.invalidateRenderPasses,
          setZoomTransformState,
        },
      };
      probe.pixelRatioPolicy = createPixelRatioPolicy({ runtimeState: state, nowMs: () => performance.now(), getDevicePixelRatio: () => devicePixelRatio });
      const fixtureData = { worldCitiesData: state.worldCitiesData, airportsData: state.airportsData, portsData: state.portsData };
      probe.assertFixtureData = () => {
        if (state.activeScenarioId !== "modern_world") throw new Error("Scenario changed during shared-label fixture");
        for (const [name, reference] of Object.entries(fixtureData)) {
          if (state[name] !== reference) throw new Error(`${name} was replaced by a background load during shared-label fixture`);
        }
      };
      globalThis.__sharedLabelsRuntimeProbe = probe;
      const prototype = CanvasRenderingContext2D.prototype;
      const fillText = prototype.fillText;
      const clearRect = prototype.clearRect;
      prototype.clearRect = function (...args) {
        if (this.canvas === state.renderPassCache?.canvases?.contextMarkers) probe.markerClears += 1;
        if (this.canvas === state.renderPassCache?.canvases?.labels) {
          probe.labelClears += 1;
          probe.draws = [];
        }
        return clearRect.apply(this, args);
      };
      prototype.fillText = function (text, x, y, ...rest) {
        if (this.canvas === state.renderPassCache?.canvases?.labels && labels.includes(String(text))) {
          const metrics = this.measureText(text);
          const matrix = this.getTransform();
          const corners = [
            [x - metrics.actualBoundingBoxLeft, y - metrics.actualBoundingBoxAscent],
            [x + metrics.actualBoundingBoxRight, y - metrics.actualBoundingBoxAscent],
            [x - metrics.actualBoundingBoxLeft, y + metrics.actualBoundingBoxDescent],
            [x + metrics.actualBoundingBoxRight, y + metrics.actualBoundingBoxDescent],
          ].map(([px, py]) => ({ x: matrix.a * px + matrix.c * py + matrix.e, y: matrix.b * px + matrix.d * py + matrix.f }));
          const left = Math.min(...corners.map((point) => point.x));
          const top = Math.min(...corners.map((point) => point.y));
          const width = Math.max(...corners.map((point) => point.x)) - left;
          const height = Math.max(...corners.map((point) => point.y)) - top;
          const layout = state.renderPassCache.layouts.labels;
          const dpr = Number(state.dpr || 1);
          probe.draws.push({ text: String(text), font: this.font,
            family: this.font.includes("Libre Baskerville") ? "city" : this.font.includes("IBM Plex Sans") ? "facility" : "unknown",
            deviceBox: { x: left, y: top, w: width, h: height },
            box: { x: left / dpr - layout.offsetX, y: top / dpr - layout.offsetY, w: width / dpr, h: height / dpr },
          });
        }
        return fillText.call(this, text, x, y, ...rest);
      };
    }, LABELS);
    // Resolve atlas completion before testing a labels-only redraw, so its real
    // asynchronous invalidation cannot masquerade as a labels cache regression.
    await page.waitForFunction(() => ["ready", "error"].includes(globalThis.__sharedLabelsRuntimeProbe.icons.getTransportFacilityIconAtlasStatus()), undefined, { timeout: 10_000 });
    report.frames.push(await captureFrame(page, "warmup"));
    // This gate observes only the fixture's relevant rendering/cache state; it
    // does not claim whole-scenario readiness after the controlled data swap.
    await waitForFixtureRenderIdle(page);

    const initial = await captureFrame(page, "initial");
    report.frames.push(initial);
    expect(initial.datasetCounts).toEqual({ city: 1, airport: 1, port: 1 });
    expectSharedFrame(initial);
    const repeat = await captureFrame(page, "labels-only");
    report.frames.push(repeat);
    expectSharedFrame(repeat);
    expect(repeat.labelClears).toBeGreaterThan(0);
    expect(repeat.markerClears, "labels-only redraw must retain contextMarkers candidates").toBe(0);
    expect(repeat.draws).toEqual(initial.draws);

    const hidden = await captureFrame(page, "city-off");
    report.frames.push(hidden);
    expectSharedFrame(hidden, { city: false });
    expect(hidden.draws.map((row) => row.box), "separated facility anchors remain stable when city labels are hidden")
      .toEqual(initial.draws.filter((row) => row.family === "facility").map((row) => row.box));
    const restored = await captureFrame(page, "city-on");
    report.frames.push(restored);
    expectSharedFrame(restored);
    expect(restored.draws).toEqual(initial.draws);

    await page.setViewportSize({ width: 840, height: 580 });
    await waitForFixtureRenderIdle(page, { timeout: 15_000 });
    const resized = await captureFrame(page, "resized");
    report.frames.push(resized);
    expectSharedFrame(resized);
    expect(resized.viewport).not.toEqual(initial.viewport);
    expect(resized.anchor).not.toEqual(initial.anchor);
    const resizedRepeat = await captureFrame(page, "labels-only");
    report.frames.push(resizedRepeat);
    expectSharedFrame(resizedRepeat);
    expect(resizedRepeat.draws).toEqual(resized.draws);
    expect(resizedRepeat.markerClears).toBe(0);
    for (const frame of report.frames) {
      expect(frame.pixelDensity.device, `${frame.action}: browser DPR`).toBe(density);
      expect(frame.pixelDensity.effective, `${frame.action}: effective renderer DPR`).toBe(density);
    }
    expect(report.pageErrors).toEqual([]);
  } catch (error) {
    report.failure = String(error.stack || error);
    report.fixtureFailureState = await page.evaluate(() => {
      const probe = globalThis.__sharedLabelsRuntimeProbe;
      if (!probe) {
        const preparation = globalThis.__sharedLabelPreparation;
        return { installed: false, preparation: preparation ? {
          loaded: preparation.loaded, error: preparation.error,
          postReady: preparation.state.postReadyTaskDiagnostics,
          cityState: preparation.state.baseCityDataState,
          contextLoadStates: preparation.state.contextLayerLoadStateByName,
          pendingContextLoads: Object.entries(preparation.state.contextLayerLoadPromiseByName || {}).filter(([, value]) => !!value).map(([key]) => key),
        } : null };
      }
      const { state } = probe;
      return {
        installed: true, activeScenarioId: state.activeScenarioId,
        renderPhase: state.renderPhase, scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
        deferExactAfterSettle: !!state.deferExactAfterSettle,
        exactAfterSettleHandle: !!state.exactAfterSettleHandle,
        zoomRenderScheduled: !!state.zoomRenderScheduled, pendingZoomTransform: !!state.pendingZoomTransform,
        renderPhaseTimerId: !!state.renderPhaseTimerId,
        dirty: state.renderPassCache?.dirty, markerClears: probe.markerClears, labelClears: probe.labelClears,
        pendingContextLoads: Object.entries(state.contextLayerLoadPromiseByName || {}).filter(([, value]) => !!value).map(([key]) => key),
      };
    }).catch((snapshotError) => ({ snapshotError: String(snapshotError.message) }));
    throw error;
  } finally {
    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, "report.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await testInfo.attach("shared-labels-runtime", { path: reportPath, contentType: "application/json" });
  }
}

for (const density of [1, 1.25, 2]) {
  test.describe(`DPR ${density}`, () => {
    test.use({ viewport: { width: 960, height: 640 }, deviceScaleFactor: density });
    test("@dev shared city and facility labels assemble, redraw and export in the real app", async ({ page }, testInfo) => {
      await runSharedLabelsFixture({ page }, testInfo, density);
    });
  });
}
