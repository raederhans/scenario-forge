const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  primeStateRef,
  waitForAppInteractive,
  waitForRenderIdle,
} = require("../support/playwright-app");

const TNO_PATH = "/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&perf=1&default_scenario=tno_1962";
const VIEWPORT = { width: 1600, height: 1000 };
const STARTUP_CONTEXT_COUNT = 3;
const STABLE_HOLD_MS = 1_000;
const ROI = Object.freeze({ cssWidth: 320, cssHeight: 240, sampleWidth: 32, sampleHeight: 24 });
const PAINT_COLOR = "#e31ac4";
const INTERACTION_PLAN = Object.freeze([
  { kind: "pan", dx: 30, dy: 10 },
  { kind: "zoom", deltaY: -120 },
  { kind: "pan", dx: -30, dy: -10 },
  { kind: "zoom", deltaY: 120 },
  { kind: "pan", dx: 24, dy: -14 },
  { kind: "zoom", deltaY: -120 },
  { kind: "pan", dx: -24, dy: 14 },
  { kind: "zoom", deltaY: 120 },
  { kind: "pan", dx: 18, dy: 12 },
  { kind: "zoom", deltaY: -120 },
  { kind: "pan", dx: -18, dy: -12 },
  { kind: "zoom", deltaY: 120 },
]);

// Trace snapshots perturb input dispatch; this lane keeps raw event/rAF evidence instead.
test.use({ trace: "off" });

function requireLabel() {
  const label = String(process.env.ATLANTROPA_PERF_LABEL || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(label)) {
    throw new Error("ATLANTROPA_PERF_LABEL is required and must contain only letters, digits, dot, underscore, or dash.");
  }
  return label;
}

function reportPathFor(label) {
  return path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    ".runtime",
    "reports",
    "generated",
    "atlantropa-refinement-20260911",
    `${label}.json`,
  );
}

function percentile(values, fraction) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const index = Math.max(0, Math.ceil(finite.length * fraction) - 1);
  return finite[Math.min(index, finite.length - 1)];
}

function summarizeInteraction(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    minMs: finite.length ? Math.min(...finite) : null,
    maxMs: finite.length ? Math.max(...finite) : null,
    p50Ms: percentile(finite, 0.50),
    p95Ms: percentile(finite, 0.95),
    quantileMethod: "nearest-rank empirical sample quantile",
  };
}

async function installBrowserProbe(context) {
  await context.addInitScript((roi) => {
    globalThis.__atlRefinementPerf = {
      milestones: { initAtMs: performance.now() },
      eventTimings: [],
      longTasks: [],
      interactions: [],
      stableWindows: [],
      pending: null,
      roi,
    };

    const probe = globalThis.__atlRefinementPerf;
    const setMilestone = (name) => {
      if (!Number.isFinite(probe.milestones[name])) probe.milestones[name] = performance.now();
    };
    addEventListener("DOMContentLoaded", () => setMilestone("domContentLoadedAtMs"), { once: true });
    addEventListener("load", () => setMilestone("loadAtMs"), { once: true });

    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("event")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (probe.eventTimings.length >= 256) break;
          probe.eventTimings.push({
            name: entry.name,
            startTime: entry.startTime,
            processingStart: entry.processingStart,
            processingEnd: entry.processingEnd,
            duration: entry.duration,
            interactionId: entry.interactionId,
            targetId: entry.target?.id || "",
          });
        }
      }).observe({ type: "event", durationThreshold: 16 });
    }
    if (globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (probe.longTasks.length >= 256) break;
          probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      }).observe({ type: "longtask" });
    }

    const compositeHash = () => {
      const map = document.querySelector("#mapContainer");
      const mapRect = map?.getBoundingClientRect();
      if (!mapRect?.width || !mapRect?.height) return null;
      const cssWidth = Math.min(roi.cssWidth, mapRect.width);
      const cssHeight = Math.min(roi.cssHeight, mapRect.height);
      const center = probe.roiCenter || {
        x: mapRect.left + mapRect.width / 2, y: mapRect.top + mapRect.height / 2,
      };
      const left = Math.max(mapRect.left, Math.min(mapRect.right - cssWidth, center.x - cssWidth / 2));
      const top = Math.max(mapRect.top, Math.min(mapRect.bottom - cssHeight, center.y - cssHeight / 2));
      const sample = document.createElement("canvas");
      sample.width = roi.sampleWidth;
      sample.height = roi.sampleHeight;
      const context = sample.getContext("2d", { willReadFrequently: true });
      let layerCount = 0;
      for (const canvas of document.querySelectorAll("#mapContainer canvas")) {
        const rect = canvas.getBoundingClientRect();
        if (!canvas.width || !canvas.height || !rect.width || !rect.height
          || getComputedStyle(canvas).display === "none") continue;
        const sx = (left - rect.left) * canvas.width / rect.width;
        const sy = (top - rect.top) * canvas.height / rect.height;
        const sw = cssWidth * canvas.width / rect.width;
        const sh = cssHeight * canvas.height / rect.height;
        try {
          context.drawImage(canvas, sx, sy, sw, sh, 0, 0, roi.sampleWidth, roi.sampleHeight);
          layerCount += 1;
        } catch (_error) {
          // A transient zero-sized backing surface is skipped and remains visible in layerCount.
        }
      }
      const pixels = context.getImageData(0, 0, roi.sampleWidth, roi.sampleHeight).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        hash ^= pixels[index]; hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 1]; hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 2]; hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 3]; hash = Math.imul(hash, 16777619);
      }
      return { hash: hash >>> 0, layerCount, left, top, cssWidth, cssHeight };
    };
    probe.compositeHash = compositeHash;

    const currentDrawState = (state) => ({
      count: Number(state?.renderPassCache?.counters?.drawCanvas || 0),
      lastFrame: state?.renderPassCache?.lastFrame || null,
    });
    const busySnapshot = (state) => {
      const load = state?.runtimeChunkLoadState || {};
      const pendingTaskKeys = state?.renderPerfMetrics?.postReadySchedulerState?.pendingTaskKeys
        || globalThis.__renderPerfMetrics?.postReadySchedulerState?.pendingTaskKeys
        || [];
      return {
        activeScenarioId: String(state?.activeScenarioId || ""),
        scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
        isInteracting: !!state?.isInteracting,
        renderPhase: String(state?.renderPhase || ""),
        deferExactAfterSettle: !!state?.deferExactAfterSettle,
        exactAfterSettleHandle: !!state?.exactAfterSettleHandle,
        zoomRenderScheduled: !!state?.zoomRenderScheduled,
        pendingZoomTransform: !!state?.pendingZoomTransform,
        activePostReadyTaskKey: String(state?.activePostReadyTaskKey || ""),
        postReadyPendingTaskKeys: Array.isArray(pendingTaskKeys) ? [...pendingTaskKeys] : [],
        chunk: {
          pendingReason: String(load.pendingReason || ""),
          refreshScheduled: !!load.refreshScheduled,
          promotionScheduled: !!load.promotionScheduled,
          pendingPromotion: !!load.pendingPromotion,
          pendingVisualPromotion: !!load.pendingVisualPromotion,
          pendingInfraPromotion: !!load.pendingInfraPromotion,
          promotionCommitInFlight: !!load.promotionCommitInFlight,
        },
        colorRevision: Number(state?.colorRevision || 0),
        drawCanvasCount: Number(state?.renderPassCache?.counters?.drawCanvas || 0),
        selectionVersion: Number(load.selectionVersion || 0),
      };
    };
    const markTriggerInput = (pending, event, state) => {
      pending.inputAtMs = performance.now();
      pending.eventTimeStamp = event.timeStamp;
      pending.eventType = event.type;
      pending.eventTargetId = event.target?.id || "";
      pending.atInput = busySnapshot(state);
    };
    const onInput = (event, acceptedKinds) => {
      const pending = probe.pending;
      if (!pending || pending.inputAtMs !== null || !acceptedKinds.includes(pending.kind)) return;
      markTriggerInput(pending, event, globalThis.__atlRefinementState);
    };
    document.addEventListener("pointerdown", (event) => {
      const pending = probe.pending;
      if (pending?.kind === "pan" && pending.gesturePointerDownAtMs === null) {
        pending.gesturePointerDownAtMs = performance.now();
        pending.gesturePointerDownEventTimeStamp = event.timeStamp;
        pending.atGesturePointerDown = busySnapshot(globalThis.__atlRefinementState);
        return;
      }
      onInput(event, ["edit", "undo"]);
    }, true);
    document.addEventListener("pointermove", (event) => {
      const pending = probe.pending;
      if (pending?.kind !== "pan" || pending.inputAtMs !== null || !(event.buttons & 1)) return;
      markTriggerInput(pending, event, globalThis.__atlRefinementState);
    }, true);
    document.addEventListener("wheel", (event) => onInput(event, ["zoom"]), { capture: true, passive: true });

    const stateObserver = async () => {
      try {
        const stateUrl = new URL("./js/core/state.js", location.href).toString();
        const { state } = await import(stateUrl);
        globalThis.__atlRefinementState = state;
        const tick = () => {
          try {
            const now = performance.now();
            if (!probe.startupMilestonesComplete) {
              const load = state.runtimeChunkLoadState || {};
              const hasAtlantropaLand = (state.scenarioAtlantropaData?.features || [])
                .some((feature) => feature?.properties?.atl_render_layer === "land");
              const chunkReady = Number(load.selectionVersion || 0) > 0
                && (state.activeScenarioChunks?.loadedChunkIds?.length || 0) > 0
                && !load.pendingPromotion
                && !load.pendingVisualPromotion
                && !load.promotionScheduled
                && !load.refreshScheduled
                && !load.promotionCommitInFlight;
              const isTnoChunkReady = state.activeScenarioId === "tno_1962"
                && chunkReady && hasAtlantropaLand;
              const hasScenarioCoastline = globalThis.__mapCoastlineDiag?.source === "scenario"
                && globalThis.__mapCoastlineDiag?.runtimeObjectName === "scenario_coastline";
              const bootInteractive = state.bootBlocking === false && !state.scenarioApplyInFlight;
              if (bootInteractive) setMilestone("bootInteractiveAtMs");
              if (isTnoChunkReady) setMilestone("atlantropaChunkReadyAtMs");
              if (hasScenarioCoastline) {
                setMilestone("scenarioCoastlineAtMs");
              }
              if (isTnoChunkReady && hasScenarioCoastline && bootInteractive) {
                setMilestone("tnoRuntimeReadyAtMs");
              }
              if (isTnoChunkReady && hasScenarioCoastline && bootInteractive
                && !state.startupReadonly && !state.startupReadonlyUnlockInFlight
                && state.interactionInfrastructureReady) {
                setMilestone("interactionReadyAtMs");
              }
              probe.startupMilestonesComplete = [
                "bootInteractiveAtMs",
                "tnoRuntimeReadyAtMs",
                "scenarioCoastlineAtMs",
                "interactionReadyAtMs",
              ].every((name) => Number.isFinite(probe.milestones[name]));
            }

            const pending = probe.pending;
            if (pending && pending.inputAtMs !== null) {
              const drawState = currentDrawState(state);
              const afterComposite = compositeHash();
              const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
              const transformChanged = ["x", "y", "k"].some((key) =>
                Number(transform[key]) !== Number(pending.beforeTransform[key]));
              const drawAdvanced = drawState.count > pending.beforeDrawCount;
              const pixelChanged = afterComposite?.hash !== pending.beforeComposite?.hash;
              let stateChanged = transformChanged;
              if (pending.kind === "edit") {
                stateChanged = String(state.visualOverrides?.[pending.featureId] || "").toLowerCase()
                  === pending.expectedColor;
              } else if (pending.kind === "undo") {
                stateChanged = JSON.stringify(state.visualOverrides || {}) === pending.expectedOverrides;
              }
              if (stateChanged && pending.firstStateOrTransformChangedAtMs === null) {
                pending.firstStateOrTransformChangedAtMs = now;
              }
              if (drawAdvanced && pending.firstDrawCounterAdvancedAtMs === null) {
                pending.firstDrawCounterAdvancedAtMs = now;
              }
              if (pixelChanged && pending.firstCompositeChangedAtMs === null) {
                pending.firstCompositeChangedAtMs = now;
              }
              if (pending.firstStateOrTransformChangedAtMs !== null
                && pending.firstDrawCounterAdvancedAtMs !== null
                && pending.firstCompositeChangedAtMs !== null) {
                probe.interactions.push({
                  sampleIndex: pending.sampleIndex,
                  kind: pending.kind,
                  inputAtMs: pending.inputAtMs,
                  firstDrawAndCompositeFeedbackAtMs: now,
                  inputToDrawAndCompositeFeedbackMs: now - pending.inputAtMs,
                  firstStateOrTransformChangedAtMs: pending.firstStateOrTransformChangedAtMs,
                  inputToStateOrTransformChangedMs: pending.firstStateOrTransformChangedAtMs - pending.inputAtMs,
                  firstDrawCounterAdvancedAtMs: pending.firstDrawCounterAdvancedAtMs,
                  inputToDrawCounterAdvancedMs: pending.firstDrawCounterAdvancedAtMs - pending.inputAtMs,
                  firstCompositeChangedAtMs: pending.firstCompositeChangedAtMs,
                  inputToCompositeChangedMs: pending.firstCompositeChangedAtMs - pending.inputAtMs,
                  eventTimeStamp: pending.eventTimeStamp,
                  eventType: pending.eventType,
                  eventTargetId: pending.eventTargetId,
                  atInput: pending.atInput,
                  gesturePointerDownAtMs: pending.gesturePointerDownAtMs,
                  gesturePointerDownEventTimeStamp: pending.gesturePointerDownEventTimeStamp,
                  gesturePointerDownToTriggerMs: pending.gesturePointerDownAtMs === null
                    ? null : pending.inputAtMs - pending.gesturePointerDownAtMs,
                  gesturePointerDownToFeedbackMs: pending.gesturePointerDownAtMs === null
                    ? null : now - pending.gesturePointerDownAtMs,
                  atGesturePointerDown: pending.atGesturePointerDown,
                  beforeTransform: pending.beforeTransform,
                  afterTransform: { x: transform.x, y: transform.y, k: transform.k },
                  beforeDrawCount: pending.beforeDrawCount,
                  afterDrawCount: drawState.count,
                  afterFrame: drawState.lastFrame ? {
                    phase: String(drawState.lastFrame.phase || ""),
                    totalMs: Number(drawState.lastFrame.totalMs || 0),
                    transform: drawState.lastFrame.transform || null,
                  } : null,
                  beforeComposite: pending.beforeComposite,
                  afterComposite,
                  colorRevisionBefore: pending.colorRevisionBefore,
                  colorRevisionAfter: Number(state.colorRevision || 0),
                  featureId: pending.featureId || null,
                  coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
                  activeScenarioId: String(state.activeScenarioId || ""),
                  evidence: "native input to rAF observing advanced renderPassCache.counters.drawCanvas and changed bounded composite ROI",
                });
                probe.pending = null;
              }
            }
            requestAnimationFrame(tick);
          } catch (error) {
            probe.stateObserverError = String(error?.stack || error);
          }
        };
        requestAnimationFrame(tick);
      } catch (error) {
        probe.stateObserverError = String(error?.stack || error);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", stateObserver, { once: true });
    } else {
      stateObserver();
    }
  }, ROI);
}

async function readRuntimeSnapshot(page) {
  return page.evaluate(() => {
    const state = globalThis.__playwrightStateRef;
    const getFeatureId = (feature) => String(feature?.properties?.id || feature?.id || "").trim();
    const atlLand = (state.scenarioAtlantropaData?.features || [])
      .filter((feature) => feature?.properties?.atl_render_layer === "land");
    const pickMetric = (name) => {
      const metric = state.renderPerfMetrics?.[name] || globalThis.__renderPerfMetrics?.[name] || null;
      if (!metric) return null;
      return Object.fromEntries(Object.entries(metric).filter(([key, value]) =>
        ["sequence", "durationMs", "totalMs", "selectionMs", "loadMs", "mergeMs", "featureCount", "reason"]
          .includes(key) && (typeof value === "number" || typeof value === "string")));
    };
    const navigation = performance.getEntriesByType("navigation")[0];
    return {
      browserNowMs: performance.now(),
      timeOrigin: performance.timeOrigin,
      milestones: { ...(globalThis.__atlRefinementPerf?.milestones || {}) },
      stateObserverError: globalThis.__atlRefinementPerf?.stateObserverError || null,
      navigation: navigation ? {
        startTime: navigation.startTime,
        responseStart: navigation.responseStart,
        responseEnd: navigation.responseEnd,
        domInteractive: navigation.domInteractive,
        domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
        loadEventEnd: navigation.loadEventEnd,
        duration: navigation.duration,
      } : null,
      activeScenarioId: String(state.activeScenarioId || ""),
      runtimeReady: !!globalThis.__playwrightIsScenarioRuntimeReady?.(state),
      atlLandCount: atlLand.length,
      atlLandIds: atlLand.map(getFeatureId).filter(Boolean),
      loadedChunkCount: state.activeScenarioChunks?.loadedChunkIds?.length || 0,
      selectionVersion: Number(state.runtimeChunkLoadState?.selectionVersion || 0),
      interactionInfrastructureReady: !!state.interactionInfrastructureReady,
      startupReadonly: !!state.startupReadonly,
      coastline: {
        source: String(globalThis.__mapCoastlineDiag?.source || ""),
        object: String(globalThis.__mapCoastlineDiag?.runtimeObjectName || ""),
        reason: String(globalThis.__mapCoastlineDiag?.reason || ""),
      },
      metrics: Object.fromEntries([
        "scenarioChunkPromotionVisualStage",
        "scenarioChunkPromotionInfraStage",
        "rebuildPoliticalLandCollectionsBreakdown",
        "drawScenarioAtlantropaLandLikeOverlayLayer",
      ].map((name) => [name, pickMetric(name)])),
      renderFrame: {
        drawCanvasCount: Number(state.renderPassCache?.counters?.drawCanvas || 0),
        frameCount: Number(state.renderPassCache?.counters?.frames || 0),
        lastFrame: state.renderPassCache?.lastFrame ? {
          phase: String(state.renderPassCache.lastFrame.phase || ""),
          totalMs: Number(state.renderPassCache.lastFrame.totalMs || 0),
          transform: state.renderPassCache.lastFrame.transform || null,
        } : null,
      },
      roi: globalThis.__atlRefinementPerf?.roi || null,
    };
  });
}

async function openColdTnoContext(browser, index) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installBrowserProbe(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error)));
  const hostStartedAt = process.hrtime.bigint();
  const response = await gotoApp(page, TNO_PATH, { waitUntil: "domcontentloaded" });
  await primeStateRef(page);
  await waitForAppInteractive(page, { timeout: 120_000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef;
    return state?.activeScenarioId === "tno_1962"
      && globalThis.__playwrightIsScenarioRuntimeReady?.(state)
      && (state.scenarioAtlantropaData?.features || [])
        .some((feature) => feature?.properties?.atl_render_layer === "land")
      && globalThis.__mapCoastlineDiag?.source === "scenario"
      && globalThis.__mapCoastlineDiag?.runtimeObjectName === "scenario_coastline";
  }, undefined, { timeout: 120_000 });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 120_000 });
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef;
    return !!state?.interactionInfrastructureReady
      && !state.startupReadonly
      && !state.startupReadonlyUnlockInFlight;
  }, undefined, { timeout: 120_000 });
  // Let the independent rAF observer timestamp the first frame after the ready
  // predicates become true. The timestamp comes from that observer, not from
  // this wait completing.
  await page.waitForFunction(() => (
    Number.isFinite(globalThis.__atlRefinementPerf?.milestones?.tnoRuntimeReadyAtMs)
      || !!globalThis.__atlRefinementPerf?.stateObserverError
  ), undefined, { timeout: 5_000 }).catch(() => {});
  const snapshot = await readRuntimeSnapshot(page);
  snapshot.contextIndex = index;
  snapshot.hostNavigationToSettledMs = Number(process.hrtime.bigint() - hostStartedAt) / 1e6;
  snapshot.httpStatus = response?.status() || null;
  snapshot.pageErrors = pageErrors;
  return { context, page, snapshot };
}

function validateStartupSnapshot(snapshot) {
  expect(snapshot.activeScenarioId).toBe("tno_1962");
  expect(snapshot.runtimeReady).toBe(true);
  expect(snapshot.atlLandCount).toBeGreaterThan(0);
  expect(snapshot.loadedChunkCount).toBeGreaterThan(0);
  expect(snapshot.interactionInfrastructureReady).toBe(true);
  expect(snapshot.startupReadonly).toBe(false);
  expect(snapshot.coastline).toMatchObject({
    source: "scenario",
    object: "scenario_coastline",
    reason: "scenario_accepted",
  });
  expect(snapshot.stateObserverError).toBeNull();
  expect(snapshot.milestones.tnoRuntimeReadyAtMs).toEqual(expect.any(Number));
  expect(snapshot.milestones.tnoRuntimeReadyAtMs)
    .toBeGreaterThanOrEqual(snapshot.milestones.atlantropaChunkReadyAtMs);
  expect(snapshot.milestones.tnoRuntimeReadyAtMs)
    .toBeGreaterThanOrEqual(snapshot.milestones.scenarioCoastlineAtMs);
  expect(snapshot.milestones.tnoRuntimeReadyAtMs)
    .toBeGreaterThanOrEqual(snapshot.milestones.bootInteractiveAtMs);
  expect(snapshot.milestones.interactionReadyAtMs)
    .toBeGreaterThanOrEqual(snapshot.milestones.tnoRuntimeReadyAtMs);
  expect(snapshot.renderFrame.drawCanvasCount).toBeGreaterThan(0);
  expect(snapshot.pageErrors).toEqual([]);
}

async function findAtlantropaTarget(page) {
  const requestedId = String(process.env.ATLANTROPA_PERF_TARGET_ID || "").trim();
  const fixedPoints = {
    ATLISL_west_med_balearics: [2.95, 39.65],
    ATLISL_levant_cyprus: [33.3, 35.0],
  };
  if (requestedId && !fixedPoints[requestedId]) throw new Error(`Unknown fixed Atlantropa probe: ${requestedId}`);
  return page.evaluate(({ requestedId, fixedPoint }) => {
    const state = globalThis.__playwrightStateRef;
    const getFeatureId = (feature) => String(feature?.properties?.id || feature?.id || "").trim();
    const candidates = (state.scenarioAtlantropaData?.features || [])
      .filter((feature) => feature?.properties?.atl_render_layer === "land"
        && feature?.properties?.atl_interactive !== false
        && (!requestedId || getFeatureId(feature) === requestedId))
      .map((feature) => {
        const bounds = globalThis.d3.geoBounds(feature);
        const width = Math.max(0, bounds[1][0] - bounds[0][0]);
        const height = Math.max(0, bounds[1][1] - bounds[0][1]);
        const points = [];
        const centroid = globalThis.d3.geoCentroid(feature);
        if (centroid.every(Number.isFinite)) points.push(centroid);
        for (let yi = 1; yi <= 7; yi += 1) {
          for (let xi = 1; xi <= 7; xi += 1) {
            points.push([
              bounds[0][0] + width * xi / 8,
              bounds[0][1] + height * yi / 8,
            ]);
          }
        }
        const inside = fixedPoint
          ? (globalThis.d3.geoContains(feature, fixedPoint) ? fixedPoint : null)
          : points.find((point) => globalThis.d3.geoContains(feature, point));
        return {
          id: getFeatureId(feature),
          point: inside,
          score: Math.min(globalThis.d3.geoArea(feature), Math.PI * 4 - globalThis.d3.geoArea(feature)),
          regionId: String(feature.properties?.region_id || ""),
          ownerTag: String(feature.properties?.owner_tag || ""),
        };
      })
      .filter((entry) => entry.id && entry.point?.every(Number.isFinite))
      .sort((left, right) => right.score - left.score);
    if (!candidates.length) throw new Error("No interactive Atlantropa land feature has a usable interior point.");
    return candidates[0];
  }, { requestedId, fixedPoint: fixedPoints[requestedId] || null });
}

async function centerTarget(page, target) {
  await page.evaluate(async ({ point }) => {
    const renderer = await import(new URL("./js/core/map_renderer.js", location.href).toString());
    renderer.setZoomPercent(100);
    globalThis.__atlRefinementTargetPoint = point;
  }, target);
  await waitForRenderIdle(page, { scenarioId: "tno_1962" });

  const dragTowardTarget = async () => {
    const position = await page.evaluate(async ({ point }) => {
      const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href).toString());
      const state = globalThis.__playwrightStateRef;
      const projected = projectGeoToScreen(...point);
      const rect = document.querySelector("#mapContainer").getBoundingClientRect();
      const dx = Math.max(-state.width * 0.6, Math.min(state.width * 0.6, state.width / 2 - projected[0]));
      const dy = Math.max(-state.height * 0.6, Math.min(state.height * 0.6, state.height / 2 - projected[1]));
      return {
        dx, dy,
        start: {
          x: rect.left + state.width / 2 - dx / 2,
          y: rect.top + state.height / 2 - dy / 2,
        },
      };
    }, target);
    if (Math.hypot(position.dx, position.dy) < 2) return;
    await page.keyboard.down("Shift");
    try {
      await page.mouse.move(position.start.x, position.start.y);
      await page.mouse.down();
      await page.mouse.move(position.start.x + position.dx, position.start.y + position.dy, { steps: 8 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up("Shift");
    }
    await waitForRenderIdle(page, { scenarioId: "tno_1962" });
  };

  await dragTowardTarget();
  await page.evaluate(async () => {
    const renderer = await import(new URL("./js/core/map_renderer.js", location.href).toString());
    renderer.setZoomPercent(400);
  });
  await waitForRenderIdle(page, { scenarioId: "tno_1962" });
  await dragTowardTarget();
  return page.evaluate(async ({ point }) => {
    const { projectGeoToScreen } = await import(new URL("./js/core/map_renderer.js", location.href).toString());
    const projected = projectGeoToScreen(...point);
    const rect = document.querySelector("#mapContainer").getBoundingClientRect();
    const screenPoint = { x: rect.left + projected[0], y: rect.top + projected[1] };
    // Zoom bounds can prevent centering a small island. Observe its actual
    // screen neighborhood rather than an unrelated patch at the map center.
    globalThis.__atlRefinementPerf.roiCenter = screenPoint;
    return screenPoint;
  }, target);
}

async function waitForStableMeasurementWindow(page, label) {
  await page.evaluate(() => {
    globalThis.__atlRefinementPerf.stableCandidate = null;
  });
  await page.waitForFunction(({ holdMs, sampleLabel }) => {
    const state = globalThis.__playwrightStateRef;
    const probe = globalThis.__atlRefinementPerf;
    const load = state?.runtimeChunkLoadState || {};
    const pendingTaskKeys = state?.renderPerfMetrics?.postReadySchedulerState?.pendingTaskKeys
      || globalThis.__renderPerfMetrics?.postReadySchedulerState?.pendingTaskKeys
      || [];
    const snapshot = {
      label: sampleLabel,
      activeScenarioId: String(state?.activeScenarioId || ""),
      scenarioApplyInFlight: !!state?.scenarioApplyInFlight,
      startupReadonly: !!state?.startupReadonly,
      startupReadonlyUnlockInFlight: !!state?.startupReadonlyUnlockInFlight,
      interactionInfrastructureReady: !!state?.interactionInfrastructureReady,
      isInteracting: !!state?.isInteracting,
      renderPhase: String(state?.renderPhase || ""),
      deferExactAfterSettle: !!state?.deferExactAfterSettle,
      exactAfterSettleHandle: !!state?.exactAfterSettleHandle,
      zoomRenderScheduled: !!state?.zoomRenderScheduled,
      pendingZoomTransform: !!state?.pendingZoomTransform,
      renderPhaseTimerId: !!state?.renderPhaseTimerId,
      activePostReadyTaskKey: String(state?.activePostReadyTaskKey || ""),
      postReadyPendingTaskKeys: Array.isArray(pendingTaskKeys) ? [...pendingTaskKeys] : [],
      chunk: {
        pendingReason: String(load.pendingReason || ""),
        refreshScheduled: !!load.refreshScheduled,
        promotionScheduled: !!load.promotionScheduled,
        pendingPromotion: !!load.pendingPromotion,
        pendingVisualPromotion: !!load.pendingVisualPromotion,
        pendingInfraPromotion: !!load.pendingInfraPromotion,
        promotionCommitInFlight: !!load.promotionCommitInFlight,
      },
      colorRevision: Number(state?.colorRevision || 0),
      drawCanvasCount: Number(state?.renderPassCache?.counters?.drawCanvas || 0),
      selectionVersion: Number(load.selectionVersion || 0),
      coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
      coastlineObject: String(globalThis.__mapCoastlineDiag?.runtimeObjectName || ""),
    };
    const idle = snapshot.activeScenarioId === "tno_1962"
      && !snapshot.scenarioApplyInFlight
      && !snapshot.startupReadonly
      && !snapshot.startupReadonlyUnlockInFlight
      && snapshot.interactionInfrastructureReady
      && !snapshot.isInteracting
      && snapshot.renderPhase === "idle"
      && !snapshot.deferExactAfterSettle
      && !snapshot.exactAfterSettleHandle
      && !snapshot.zoomRenderScheduled
      && !snapshot.pendingZoomTransform
      && !snapshot.renderPhaseTimerId
      && !snapshot.activePostReadyTaskKey
      && snapshot.postReadyPendingTaskKeys.length === 0
      && !snapshot.chunk.pendingReason
      && !snapshot.chunk.refreshScheduled
      && !snapshot.chunk.promotionScheduled
      && !snapshot.chunk.pendingPromotion
      && !snapshot.chunk.pendingVisualPromotion
      && !snapshot.chunk.pendingInfraPromotion
      && !snapshot.chunk.promotionCommitInFlight
      && snapshot.coastlineSource === "scenario"
      && snapshot.coastlineObject === "scenario_coastline";
    const signature = JSON.stringify([
      snapshot.activeScenarioId,
      snapshot.colorRevision,
      snapshot.drawCanvasCount,
      snapshot.selectionVersion,
      state?.renderPerfMetrics?.scenarioChunkPromotionVisualStage?.sequence || 0,
      state?.renderPerfMetrics?.scenarioChunkPromotionInfraStage?.sequence || 0,
      state?.landData?.features?.length || 0,
    ]);
    const prior = probe.stableCandidate;
    if (!idle || !prior || prior.signature !== signature) {
      probe.stableCandidate = { signature, sinceMs: performance.now(), snapshot };
      probe.stableDiagnostics = { idle, stableForMs: 0, snapshot };
      return false;
    }
    const stableForMs = performance.now() - prior.sinceMs;
    probe.stableDiagnostics = { idle, stableForMs, snapshot };
    return stableForMs >= holdMs;
  }, { holdMs: STABLE_HOLD_MS, sampleLabel: label }, { timeout: 60_000 });
  return page.evaluate(({ holdMs, sampleLabel }) => {
    const probe = globalThis.__atlRefinementPerf;
    const window = {
      label: sampleLabel,
      holdMs,
      acceptedAtMs: performance.now(),
      stableForMs: Number(probe.stableDiagnostics?.stableForMs || 0),
      snapshot: probe.stableDiagnostics?.snapshot || null,
    };
    probe.stableWindows.push(window);
    return window;
  }, { holdMs: STABLE_HOLD_MS, sampleLabel: label });
}

async function armInteraction(page, payload) {
  await page.evaluate((next) => {
    const state = globalThis.__playwrightStateRef;
    const probe = globalThis.__atlRefinementPerf;
    if (probe.pending) throw new Error(`Interaction probe already armed for ${probe.pending.kind}.`);
    const transform = state.zoomTransform || { x: 0, y: 0, k: 1 };
    probe.pending = {
      ...next,
      inputAtMs: null,
      eventTimeStamp: null,
      gesturePointerDownAtMs: null,
      gesturePointerDownEventTimeStamp: null,
      atGesturePointerDown: null,
      atInput: null,
      firstStateOrTransformChangedAtMs: null,
      firstDrawCounterAdvancedAtMs: null,
      firstCompositeChangedAtMs: null,
      beforeTransform: { x: transform.x, y: transform.y, k: transform.k },
      beforeDrawCount: Number(state.renderPassCache?.counters?.drawCanvas || 0),
      beforeComposite: probe.compositeHash(),
      colorRevisionBefore: Number(state.colorRevision || 0),
    };
  }, payload);
}

async function waitForInteractionEvidence(page, expectedCount) {
  // This is a deadlock guard. Latency acceptance is decided from A/B samples, not this timeout.
  await page.waitForFunction((count) => (
    !globalThis.__atlRefinementPerf?.pending
      && globalThis.__atlRefinementPerf?.interactions?.length === count
  ), expectedCount, { timeout: 15_000 });
  await waitForRenderIdle(page, { scenarioId: "tno_1962", timeout: 60_000 });
  const sample = await page.evaluate((index) => {
    const samples = globalThis.__atlRefinementPerf.interactions;
    samples[index].settledAtMs = performance.now();
    samples[index].inputToSettledMs = samples[index].settledAtMs - samples[index].inputAtMs;
    return samples[index];
  }, expectedCount - 1);
  console.log(
    `[atlantropa-perf] interaction ${expectedCount}/${INTERACTION_PLAN.length + 2}`
      + ` ${sample.kind} primary=${sample.inputToDrawAndCompositeFeedbackMs.toFixed(2)}ms`,
  );
}

async function runPanZoomSamples(page, centerPoint) {
  for (let index = 0; index < INTERACTION_PLAN.length; index += 1) {
    const action = INTERACTION_PLAN[index];
    await page.mouse.move(centerPoint.x, centerPoint.y);
    await waitForStableMeasurementWindow(page, `pan-zoom-${index}`);
    await armInteraction(page, { kind: action.kind, sampleIndex: index });
    if (action.kind === "pan") {
      await page.keyboard.down("Shift");
      try {
        await page.mouse.down();
        await page.mouse.move(centerPoint.x + action.dx, centerPoint.y + action.dy, { steps: 3 });
        await page.mouse.up();
      } finally {
        await page.keyboard.up("Shift");
      }
    } else {
      await page.mouse.wheel(0, action.deltaY);
    }
    await waitForInteractionEvidence(page, index + 1);
  }
}

async function selectActualAtlantropaLand(page, point) {
  await page.keyboard.down("Control");
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    await page.keyboard.up("Control");
  }
  await expect.poll(() => page.evaluate(() => globalThis.__playwrightStateRef.devSelectedHit?.id || ""))
    .not.toBe("");
  return page.evaluate(() => {
    const state = globalThis.__playwrightStateRef;
    const selectedId = String(state.devSelectedHit?.id || "").trim();
    const getFeatureId = (feature) => String(feature?.properties?.id || feature?.id || "").trim();
    const feature = (state.scenarioAtlantropaData?.features || []).find((entry) => getFeatureId(entry) === selectedId);
    return {
      selectedId,
      targetType: String(state.devSelectedHit?.targetType || ""),
      isAtlantropaLand: feature?.properties?.atl_render_layer === "land",
      isInLandIndex: !!state.landIndex?.has(selectedId),
      regionId: String(feature?.properties?.region_id || ""),
      ownerTag: String(feature?.properties?.owner_tag || ""),
      resolvedColor: String(state.colors?.[selectedId] || ""),
      overridesBefore: { ...(state.visualOverrides || {}) },
      historyPastBefore: state.historyPast?.length || 0,
      historyFutureBefore: state.historyFuture?.length || 0,
      selectionCount: state.devSelectionFeatureIds?.size || 0,
    };
  });
}

async function editAndUndo(page, point, selected, firstSampleIndex) {
  await page.locator("#paintModeVisualBtn").click();
  await page.locator("#toolFillBtn").click();
  await page.locator("#customColor").fill(PAINT_COLOR);
  await page.mouse.move(point.x, point.y);
  await waitForStableMeasurementWindow(page, "edit");
  await armInteraction(page, {
    kind: "edit",
    sampleIndex: firstSampleIndex,
    featureId: selected.selectedId,
    expectedColor: PAINT_COLOR,
  });
  await page.mouse.click(point.x, point.y);
  await waitForInteractionEvidence(page, firstSampleIndex + 1);
  const painted = await page.evaluate((featureId) => {
    const state = globalThis.__playwrightStateRef;
    return {
      override: String(state.visualOverrides?.[featureId] || ""),
      resolvedColor: String(state.colors?.[featureId] || ""),
      historyPast: state.historyPast?.length || 0,
      historyFuture: state.historyFuture?.length || 0,
      scenario: String(state.activeScenarioId || ""),
      coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
    };
  }, selected.selectedId);
  expect(painted.override.toLowerCase()).toBe(PAINT_COLOR);
  expect(painted.historyPast).toBe(selected.historyPastBefore + 1);

  const undoPoint = await page.locator("#undoBtn").boundingBox();
  expect(undoPoint).not.toBeNull();
  await page.mouse.move(undoPoint.x + undoPoint.width / 2, undoPoint.y + undoPoint.height / 2);
  await waitForStableMeasurementWindow(page, "undo");
  await armInteraction(page, {
    kind: "undo",
    sampleIndex: firstSampleIndex + 1,
    featureId: selected.selectedId,
    expectedOverrides: JSON.stringify(selected.overridesBefore),
  });
  await page.mouse.click(undoPoint.x + undoPoint.width / 2, undoPoint.y + undoPoint.height / 2);
  await waitForInteractionEvidence(page, firstSampleIndex + 2);
  const restored = await page.evaluate((featureId) => {
    const state = globalThis.__playwrightStateRef;
    const atlIds = new Set((state.scenarioAtlantropaData?.features || [])
      .filter((feature) => feature?.properties?.atl_render_layer === "land")
      .map((feature) => String(feature?.properties?.id || feature?.id || "").trim()));
    return {
      overrides: { ...(state.visualOverrides || {}) },
      resolvedColor: String(state.colors?.[featureId] || ""),
      historyPast: state.historyPast?.length || 0,
      historyFuture: state.historyFuture?.length || 0,
      selectedId: String(state.devSelectedHit?.id || ""),
      selectedStillActualAtlantropaLand: atlIds.has(String(state.devSelectedHit?.id || "")),
      landIndexed: !!state.landIndex?.has(featureId),
      scenario: String(state.activeScenarioId || ""),
      coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
      coastlineObject: String(globalThis.__mapCoastlineDiag?.runtimeObjectName || ""),
    };
  }, selected.selectedId);
  expect(restored.overrides).toEqual(selected.overridesBefore);
  expect(restored.resolvedColor).toBe(selected.resolvedColor);
  expect(restored.historyPast).toBe(selected.historyPastBefore);
  expect(restored.historyFuture).toBe(selected.historyFutureBefore + 1);
  expect(restored).toMatchObject({
    selectedId: selected.selectedId,
    selectedStillActualAtlantropaLand: true,
    landIndexed: true,
    scenario: "tno_1962",
    coastlineSource: "scenario",
    coastlineObject: "scenario_coastline",
  });
  return { painted, restored };
}

test("TNO Atlantropa refinement records cold startup and active interaction A/B evidence @dev", async ({ browser }, testInfo) => {
  // JUSTIFY: three cold contexts plus fourteen native interactions with one-second stable windows; opt-in development measurement.
  test.setTimeout(420_000);
  test.skip(
    !String(process.env.ATLANTROPA_PERF_LABEL || "").trim(),
    "Dedicated A/B harness requires ATLANTROPA_PERF_LABEL.",
  );
  const label = requireLabel();
  const outputPath = reportPathFor(label);
  const report = {
    measurementVersion: 1,
    label,
    scenarioId: "tno_1962",
    viewport: VIEWPORT,
    roi: ROI,
    startupContract: {
      contexts: STARTUP_CONTEXT_COUNT,
      cacheIsolation: "new Playwright BrowserContext per sample",
      ready: "actual ATL land and detail chunk loaded; runtime predicate true; dedicated scenario coastline accepted",
      statisticalClaim: "raw cold-context values only; no startup p95 claim",
    },
    interactionContract: {
      primaryMetric: "native input to first rAF observing changed transform/state, advanced renderPassCache.counters.drawCanvas, and changed bounded composite ROI",
      secondaryMetric: "input to waitForRenderIdle convergence",
      samples: INTERACTION_PLAN.length,
      stableWindow: `${STABLE_HOLD_MS}ms with post-ready, chunk, exact/zoom scheduling empty and state signature unchanged before every sample`,
      panTrigger: "first pointermove with primary button down; pointerdown gesture timing retained separately",
      acceptance: "no latency threshold in harness; compare frozen baseline and candidate reports",
    },
    environment: {
      browserVersion: browser.version(),
      nodeVersion: process.version,
      host: os.hostname(),
      platform: process.platform,
    },
    startups: [],
    panZoom: [],
    editing: null,
    summary: null,
  };
  let active = null;
  try {
    for (let index = 0; index < STARTUP_CONTEXT_COUNT; index += 1) {
      const opened = await openColdTnoContext(browser, index);
      report.startups.push(opened.snapshot);
      active = opened;
      validateStartupSnapshot(opened.snapshot);
      console.log(
        `[atlantropa-perf] startup ${index + 1}/${STARTUP_CONTEXT_COUNT}`
          + ` tnoReady=${opened.snapshot.milestones.tnoRuntimeReadyAtMs.toFixed(2)}ms`
          + ` settled=${opened.snapshot.hostNavigationToSettledMs.toFixed(2)}ms`,
      );
      if (index === STARTUP_CONTEXT_COUNT - 1) {
        continue;
      } else {
        await opened.context.close();
        active = null;
      }
    }

    const { page } = active;
    if (await page.locator("#scenarioGuidePopover").isVisible()) {
      await page.locator("#scenarioGuideCloseBtn").click();
    }
    const target = await findAtlantropaTarget(page);
    let centerPoint = await centerTarget(page, target);
    await waitForStableMeasurementWindow(page, "after-center-target");
    await runPanZoomSamples(page, centerPoint);
    centerPoint = await centerTarget(page, target);
    const selected = await selectActualAtlantropaLand(page, centerPoint);
    expect(selected.selectedId).toBe(target.id);
    expect(selected.targetType).toBe("land");
    expect(selected.isAtlantropaLand).toBe(true);
    expect(selected.isInLandIndex).toBe(true);
    const editResult = await editAndUndo(page, centerPoint, selected, INTERACTION_PLAN.length);

    const probe = await page.evaluate(() => ({
      interactions: globalThis.__atlRefinementPerf?.interactions || [],
      eventTimings: globalThis.__atlRefinementPerf?.eventTimings || [],
      longTasks: globalThis.__atlRefinementPerf?.longTasks || [],
      stableWindows: globalThis.__atlRefinementPerf?.stableWindows || [],
      stableDiagnostics: globalThis.__atlRefinementPerf?.stableDiagnostics || null,
      stateObserverError: globalThis.__atlRefinementPerf?.stateObserverError || null,
    }));
    report.panZoom = probe.interactions.slice(0, INTERACTION_PLAN.length);
    report.editing = {
      target,
      selected,
      ...editResult,
      samples: probe.interactions.slice(INTERACTION_PLAN.length),
    };
    report.eventTimings = probe.eventTimings;
    report.longTasks = probe.longTasks;
    report.stableWindows = probe.stableWindows;
    report.stableDiagnostics = probe.stableDiagnostics;
    report.stateObserverError = probe.stateObserverError;
    expect(report.panZoom).toHaveLength(INTERACTION_PLAN.length);
    expect(report.panZoom.filter((entry) => entry.kind === "pan")).toHaveLength(6);
    expect(report.panZoom.filter((entry) => entry.kind === "zoom")).toHaveLength(6);
    expect(report.panZoom.every((entry) => entry.activeScenarioId === "tno_1962"
      && entry.coastlineSource === "scenario"
      && entry.beforeComposite?.layerCount > 0
      && entry.afterComposite?.layerCount > 0)).toBe(true);
    expect(report.editing.samples.map((entry) => entry.kind)).toEqual(["edit", "undo"]);

    const interactionValues = report.panZoom.map((entry) => entry.inputToDrawAndCompositeFeedbackMs);
    report.summary = {
      startupTnoReadyMs: report.startups.map((entry) => entry.milestones?.tnoRuntimeReadyAtMs ?? null),
      startupSettledMs: report.startups.map((entry) => entry.hostNavigationToSettledMs),
      startupQuantiles: null,
      panZoomPrimary: summarizeInteraction(interactionValues),
      panPrimary: summarizeInteraction(report.panZoom.filter((entry) => entry.kind === "pan")
        .map((entry) => entry.inputToDrawAndCompositeFeedbackMs)),
      zoomPrimary: summarizeInteraction(report.panZoom.filter((entry) => entry.kind === "zoom")
        .map((entry) => entry.inputToDrawAndCompositeFeedbackMs)),
      editUndoPrimary: summarizeInteraction(report.editing.samples
        .map((entry) => entry.inputToDrawAndCompositeFeedbackMs)),
    };
  } finally {
    if (active?.page && !active.page.isClosed()) {
      try {
        report.partialProbe = await active.page.evaluate(() => ({
          interactions: globalThis.__atlRefinementPerf?.interactions || [],
          pending: globalThis.__atlRefinementPerf?.pending || null,
          eventTimings: globalThis.__atlRefinementPerf?.eventTimings || [],
          longTasks: globalThis.__atlRefinementPerf?.longTasks || [],
          stableWindows: globalThis.__atlRefinementPerf?.stableWindows || [],
          stableDiagnostics: globalThis.__atlRefinementPerf?.stableDiagnostics || null,
          milestones: globalThis.__atlRefinementPerf?.milestones || {},
          stateObserverError: globalThis.__atlRefinementPerf?.stateObserverError || null,
          runtime: globalThis.__playwrightStateRef ? {
            activeScenarioId: String(globalThis.__playwrightStateRef.activeScenarioId || ""),
            renderPhase: String(globalThis.__playwrightStateRef.renderPhase || ""),
            pendingZoomTransform: !!globalThis.__playwrightStateRef.pendingZoomTransform,
            zoomRenderScheduled: !!globalThis.__playwrightStateRef.zoomRenderScheduled,
            coastlineSource: String(globalThis.__mapCoastlineDiag?.source || ""),
            coastlineObject: String(globalThis.__mapCoastlineDiag?.runtimeObjectName || ""),
          } : null,
        }));
      } catch (error) {
        report.partialProbeReadError = String(error?.stack || error);
      }
    }
    if (active?.context) await active.context.close();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await testInfo.attach("atlantropa-refinement-perf", { path: outputPath, contentType: "application/json" });
  }
});
