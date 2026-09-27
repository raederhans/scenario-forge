const { test, expect } = require("@playwright/test");
const {
  applyScenarioAndWaitIdle,
  gotoApp,
  waitForAppInteractive,
  waitForScenarioSelectReady,
} = require("../support/playwright-app");
const {
  samplePoliticalFeaturePixels,
} = require("../support/political-pixel-probe");
const { DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("../support/startup-paths");

test.setTimeout(120_000);

const FAST_STARTUP_PATH = toRootPath(DEFAULT_FAST_APP_OPEN_PATH);
const HOI4_ASYNC_PREWARM_PATH = `${FAST_STARTUP_PATH}&default_scenario=hoi4_1939`;

const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
  /\[physical\] global_physical_semantics\.topo\.json unavailable or deferred/i,
  /\[physical\] global_contours\.major\.topo\.json unavailable or deferred/i,
  /\[scenario\] Applying bundle without confirmed detail promotion/i,
  /\[scenario\] Detail visibility gate triggered for tno_1962/i,
  /\[map_renderer\] scenario_owner_only borders unavailable for scenario=tno_1962/i,
  /startup\.bundle\.en\.json\.gz was preloaded using link preload but not used/i,
];

async function ensureScenario(page, scenarioId, label) {
  await waitForScenarioSelectReady(page, { scenarioId, timeout: 120_000 });
  const currentScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });
  if (currentScenarioId !== scenarioId) {
    await applyScenarioAndWaitIdle(page, scenarioId, {
      timeout: 120_000,
      renderMode: "none",
      markDirtyReason: "",
      showToastOnComplete: false,
    });
  }
  await expect(page.locator("#scenarioStatus")).toContainText(label, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
}

async function setZoomPercent(page, percent, { waitAfterMs = 700 } = {}) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  if (waitAfterMs > 0) {
    await page.waitForTimeout(waitAfterMs);
  }
}

async function dragMap(page, { dx = 180, dy = 24, steps = 8 } = {}) {
  const box = await page.locator("#mapContainer").boundingBox();
  if (!box) {
    throw new Error("mapContainer bounding box unavailable");
  }
  const startX = box.x + (box.width * 0.5);
  const startY = box.y + (box.height * 0.5);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, {
    steps,
  });
  await page.mouse.up();
  await page.waitForTimeout(700);
}

async function scheduleExactAfterSettleRefreshForFocusedTest(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { scheduleExactAfterSettleRefresh } = await import("/js/core/map_renderer.js");
    if (state.deferExactAfterSettle || state.exactAfterSettleHandle) return false;
    state.deferExactAfterSettle = true;
    scheduleExactAfterSettleRefresh({
      scaleDelta: 0,
      normalizedDelta: 0,
      settleDurationMs: 0,
      exactQuietWindowMs: 0,
    });
    return true;
  });
}

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  try {
    await page.waitForFunction(() => {
      const state = globalThis.__playwrightStateRef || null;
      return String(state.renderPhase || "") === "idle"
        && !state.deferExactAfterSettle
        && !state.exactAfterSettleHandle
        && !state.runtimeChunkLoadState?.pendingPromotion
        && !state.runtimeChunkLoadState?.promotionScheduled
        && !state.runtimeChunkLoadState?.refreshScheduled
        && !state.runtimeChunkLoadState?.promotionCommitInFlight;
    }, undefined, { timeout });
  } catch (error) {
    const stateSnapshot = await page.evaluate(() => {
      const state = globalThis.__playwrightStateRef || null;
      const loadState = state?.runtimeChunkLoadState || {};
      const metrics = state?.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      return {
        renderPhase: String(state?.renderPhase || ""),
        deferExactAfterSettle: !!state?.deferExactAfterSettle,
        hasExactAfterSettleHandle: !!state?.exactAfterSettleHandle,
        pendingPromotion: !!loadState.pendingPromotion,
        pendingVisualPromotion: !!loadState.pendingVisualPromotion,
        pendingInfraPromotion: !!loadState.pendingInfraPromotion,
        promotionScheduled: !!loadState.promotionScheduled,
        refreshScheduled: !!loadState.refreshScheduled,
        promotionCommitInFlight: !!loadState.promotionCommitInFlight,
        pendingReason: String(loadState.pendingReason || ""),
        selectionVersion: Number(loadState.selectionVersion || 0),
        scenarioDataGeneration: Number(state?.scenarioDataGeneration || 0),
        colorRevision: Number(state?.colorRevision || 0),
        activeScenarioId: String(state?.activeScenarioId || ""),
        activeInteractionRecoveryTaskKey: String(state?.activeInteractionRecoveryTaskKey || ""),
        activePostReadyTaskKey: String(state?.activePostReadyTaskKey || ""),
        hitCanvasBuildScheduled: !!state?.hitCanvasBuildScheduled,
        interactionInfrastructureBuildInFlight: !!state?.interactionInfrastructureBuildInFlight,
        scenarioChunkPromotionVisualStage: metrics.scenarioChunkPromotionVisualStage || null,
        settleExactRefreshPasses: metrics.settleExactRefreshPasses || null,
      };
    }).catch((snapshotError) => ({
      snapshotError: String(snapshotError?.message || snapshotError || ""),
    }));
    throw new Error(`${error.message}\nstate=${JSON.stringify(stateSnapshot)}`);
  }
}

async function waitForFullPoliticalColorCoverage(page, { timeout = 30_000 } = {}) {
  try {
    await page.waitForFunction(() => {
      const state = globalThis.__playwrightStateRef || null;
      const loadState = state?.runtimeChunkLoadState || {};
      const landCount = Array.isArray(state?.landData?.features) ? state.landData.features.length : 0;
      const fullCount = Array.isArray(state?.landDataFull?.features) ? state.landDataFull.features.length : 0;
      const colorCount = state?.colors && typeof state.colors === "object"
        ? Object.keys(state.colors).length
        : 0;
      return String(state?.activeScenarioId || "") === "tno_1962"
        && String(state?.renderPhase || "") === "idle"
        && !state?.deferExactAfterSettle
        && !state?.exactAfterSettleHandle
        && !loadState.pendingPromotion
        && !loadState.pendingVisualPromotion
        && !loadState.promotionScheduled
        && !loadState.refreshScheduled
        && !loadState.promotionCommitInFlight
        && fullCount > landCount
        && colorCount >= fullCount;
    }, undefined, { timeout });
  } catch (error) {
    const snapshot = await page.evaluate(() => {
      const state = globalThis.__playwrightStateRef || null;
      const loadState = state?.runtimeChunkLoadState || {};
      const metrics = state?.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      return {
        activeScenarioId: String(state?.activeScenarioId || ""),
        renderPhase: String(state?.renderPhase || ""),
        deferExactAfterSettle: !!state?.deferExactAfterSettle,
        hasExactAfterSettleHandle: !!state?.exactAfterSettleHandle,
        landFeatureCount: Array.isArray(state?.landData?.features) ? state.landData.features.length : 0,
        fullFeatureCount: Array.isArray(state?.landDataFull?.features) ? state.landDataFull.features.length : 0,
        colorCount: state?.colors && typeof state.colors === "object" ? Object.keys(state.colors).length : 0,
        runtimeChunkLoadState: {
          pendingPromotion: !!loadState.pendingPromotion,
          pendingVisualPromotion: !!loadState.pendingVisualPromotion,
          pendingInfraPromotion: !!loadState.pendingInfraPromotion,
          promotionScheduled: !!loadState.promotionScheduled,
          refreshScheduled: !!loadState.refreshScheduled,
          promotionCommitInFlight: !!loadState.promotionCommitInFlight,
        },
        scenarioChunkPromotionVisualStage: metrics.scenarioChunkPromotionVisualStage || null,
        scenarioChunkPromotionDeferredInfraStage: metrics.scenarioChunkPromotionDeferredInfraStage || null,
      };
    }).catch((snapshotError) => ({
      snapshotError: String(snapshotError?.message || snapshotError || ""),
    }));
    throw new Error(`${error.message}\nfullPoliticalColorCoverage=${JSON.stringify(snapshot)}`);
  }
}

async function collectPostEditPoliticalSnapshot(page, { label, featureId, probe } = {}) {
  return page.evaluate(async ({ label, featureId, probe }) => {
    const { state } = await import("/js/core/state.js");
    let projectGeoToScreen = null;
    try {
      ({ projectGeoToScreen } = await import("/js/core/map_renderer.js"));
    } catch (_error) {
      projectGeoToScreen = null;
    }
    const metrics = state?.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const cache = state?.renderPassCache || {};
    const toList = (value) => {
      if (value instanceof Set) return Array.from(value);
      if (Array.isArray(value)) return value.slice();
      return [];
    };
    const parseRgb = (value) => {
      const text = String(value || "").trim();
      const hex = /^#?([0-9a-f]{6})$/i.exec(text);
      if (!hex) return null;
      const number = Number.parseInt(hex[1], 16);
      return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    };
    const distance = (left, right) => {
      if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(Number(left[0] || 0) - Number(right[0] || 0))
        + Math.abs(Number(left[1] || 0) - Number(right[1] || 0))
        + Math.abs(Number(left[2] || 0) - Number(right[2] || 0))
      ) / 3;
    };
    const sampleMainCanvas = () => {
      const canvas = document.getElementById("map-canvas");
      const context = canvas instanceof HTMLCanvasElement
        ? canvas.getContext("2d", { willReadFrequently: true })
        : null;
      const d3 = globalThis.d3;
      if (!canvas || !context || !probe || !d3 || !state?.landData) {
        return { error: "sample-unavailable" };
      }
      const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
      const rendererScreenPoint = typeof projectGeoToScreen === "function"
        ? projectGeoToScreen(Number(probe.lon), Number(probe.lat))
        : null;
      let projected = rendererScreenPoint;
      if (!Array.isArray(projected)) {
        const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
        const x1 = Math.max(padding + 1, state.width - padding);
        const y1 = Math.max(padding + 1, state.height - padding);
        const projection = d3.geoEqualEarth().precision(0.1);
        projection.clipExtent(null);
        projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
        projected = projection([Number(probe.lon), Number(probe.lat)]);
      }
      if (!Array.isArray(projected) || !projected.every(Number.isFinite)) {
        return { error: "projection-miss" };
      }
      const transform = state.zoomTransform || d3.zoomIdentity || { x: 0, y: 0, k: 1 };
      const cx = rendererScreenPoint
        ? projected[0] * dpr
        : ((projected[0] * transform.k) + transform.x) * dpr;
      const cy = rendererScreenPoint
        ? projected[1] * dpr
        : ((projected[1] * transform.k) + transform.y) * dpr;
      const radiusPx = Math.max(2, 7 * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const data = context.getImageData(minX, minY, width, height).data;
      const resolvedRgb = parseRgb(String(state.colors?.[featureId] || ""));
      let bestRgb = null;
      let bestResolvedDistance = Number.POSITIVE_INFINITY;
      let pixelCount = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (!data[index + 3]) continue;
        const rgb = [data[index], data[index + 1], data[index + 2]];
        const resolvedDistance = distance(rgb, resolvedRgb);
        pixelCount += 1;
        if (resolvedDistance < bestResolvedDistance) {
          bestResolvedDistance = resolvedDistance;
          bestRgb = rgb;
        }
      }
      const center = context.getImageData(
        Math.max(0, Math.min(canvas.width - 1, Math.round(cx))),
        Math.max(0, Math.min(canvas.height - 1, Math.round(cy))),
        1,
        1,
      ).data;
      return {
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        centerRgb: [center[0], center[1], center[2]],
        bestRgb,
        bestResolvedDistance,
        pixelCount,
      };
    };
    const lastGoodFrame = cache.lastGoodFrame || {};
    return {
      label: String(label || ""),
      featureId: String(featureId || ""),
      resolvedColor: String(state?.colors?.[featureId] || ""),
      visualOverride: String(state?.visualOverrides?.[featureId] || ""),
      colorRevision: Number(state?.colorRevision || 0),
      sovereigntyRevision: Number(state?.sovereigntyRevision || 0),
      scenarioDataGeneration: Number(state?.scenarioDataGeneration || 0),
      renderPhase: String(state?.renderPhase || ""),
      deferExactAfterSettle: !!state?.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state?.exactAfterSettleHandle,
      renderPassCache: {
        dirty: { political: !!cache.dirty?.political },
        reasons: { political: String(cache.reasons?.political || "") },
      },
      partialPoliticalDirtyIds: toList(cache.partialPoliticalDirtyIds),
      pendingPoliticalColorEditIds: toList(cache.pendingPoliticalColorEditIds),
      pendingPoliticalColorEditRevision: Number(cache.pendingPoliticalColorEditRevision ?? -1),
      pendingPoliticalColorEditReason: String(cache.pendingPoliticalColorEditReason || ""),
      pendingPoliticalColorEditFirstPixelPaintSource: String(cache.pendingPoliticalColorEditFirstPixelPaintSource || ""),
      politicalPassRenders: Number(cache.counters?.politicalPassRenders || 0),
      composites: Number(cache.counters?.composites || 0),
      drawPoliticalFeatureFillLoop: metrics.drawPoliticalFeatureFillLoop || null,
      drawPoliticalBackgroundFillsPass: metrics.drawPoliticalBackgroundFillsPass || null,
      scenarioChunkPromotionVisualStage: metrics.scenarioChunkPromotionVisualStage || null,
      politicalPartialRepaint: metrics.politicalPartialRepaint || null,
      lastGoodFrame: {
        valid: !!lastGoodFrame.valid,
        stale: !!lastGoodFrame.stale,
        reason: String(lastGoodFrame.reason || ""),
        staleReason: String(lastGoodFrame.staleReason || ""),
        rejectedReason: String(lastGoodFrame.rejectedReason || ""),
        colorRevision: Number(lastGoodFrame.colorRevision || 0),
        scenarioDataGeneration: Number(lastGoodFrame.scenarioDataGeneration || 0),
        commitKeySignature: String(lastGoodFrame.commitKeySignature || ""),
        reuseCount: Number(cache.counters?.lastGoodFrameReuses || 0),
        visibleFrameReusedCount: Number(cache.counters?.visibleFrameReusedCount || 0),
        visibleFrameRejectedCount: Number(cache.counters?.visibleFrameRejectedCount || 0),
      },
      runtimeChunkLoadState: {
        pendingPromotion: !!state?.runtimeChunkLoadState?.pendingPromotion,
        pendingVisualPromotion: !!state?.runtimeChunkLoadState?.pendingVisualPromotion,
        pendingInfraPromotion: !!state?.runtimeChunkLoadState?.pendingInfraPromotion,
        promotionScheduled: !!state?.runtimeChunkLoadState?.promotionScheduled,
        refreshScheduled: !!state?.runtimeChunkLoadState?.refreshScheduled,
        promotionCommitInFlight: !!state?.runtimeChunkLoadState?.promotionCommitInFlight,
      },
      mainCanvasSample: sampleMainCanvas(),
    };
  }, {
    label,
    featureId,
    probe,
  });
}

async function waitForPostEditPoliticalPaint(page, {
  featureId,
  probe,
  expectedColor,
  colorRevision,
  previousPoliticalPassRenders = 0,
  previousComposites = 0,
  timeout = 30_000,
} = {}) {
  try {
    await page.waitForFunction((args) => {
      const state = globalThis.__playwrightStateRef || null;
      const cache = state?.renderPassCache || {};
      const metrics = state?.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      const loadState = state?.runtimeChunkLoadState || {};
      const pendingIds = cache.pendingPoliticalColorEditIds;
      const pendingHasTarget = pendingIds instanceof Set
        ? pendingIds.has(args.featureId)
        : false;
      const pendingSize = pendingIds instanceof Set ? pendingIds.size : 0;
      const fillMetric = metrics.drawPoliticalFeatureFillLoop || {};
      const resolvedColor = String(state?.colors?.[args.featureId] || "").toLowerCase();
      return String(state?.renderPhase || "") === "idle"
        && !state?.deferExactAfterSettle
        && !state?.exactAfterSettleHandle
        && !loadState.pendingPromotion
        && !loadState.pendingVisualPromotion
        && !loadState.promotionScheduled
        && !loadState.refreshScheduled
        && !loadState.promotionCommitInFlight
        && resolvedColor === String(args.expectedColor || "").toLowerCase()
        && Number(state?.colorRevision || 0) >= Number(args.colorRevision || 0)
        && Number(cache.counters?.politicalPassRenders || 0) > Number(args.previousPoliticalPassRenders || 0)
        && Number(cache.counters?.composites || 0) > Number(args.previousComposites || 0)
        && !pendingHasTarget
        && pendingSize === 0
        && Number(cache.pendingPoliticalColorEditRevision ?? -1) === -1
        && !cache.dirty?.political
        && String(fillMetric.reason || "") !== "progressive-coarse-underlay"
        && Number(fillMetric.renderedCount || 0) > 0;
    }, {
      featureId,
      expectedColor,
      colorRevision,
      previousPoliticalPassRenders,
      previousComposites,
    }, { timeout, polling: 100 });
  } catch (error) {
    const snapshot = await collectPostEditPoliticalSnapshot(page, {
      label: "post-edit-paint-timeout",
      featureId,
      probe,
    });
    throw new Error(`${error.message}\npostEditPaint=${JSON.stringify(snapshot)}`);
  }
  return collectPostEditPoliticalSnapshot(page, {
    label: "after-stable-render-wait",
    featureId,
    probe,
  });
}

async function startChunkPromotionProbe(page) {
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const previousProbe = state.__chunkPromotionVisualStageProbe;
    if (previousProbe?.intervalId) {
      globalThis.clearInterval(previousProbe.intervalId);
    }
    const probe = {
      startedAt: Date.now(),
      sawDeferred: false,
      visualRecordedAt: 0,
      exactClearedAt: 0,
      maxSelectionVersion: Number(state.runtimeChunkLoadState?.selectionVersion || 0),
      sawPendingVisualField: false,
      sawPendingInfraField: false,
    };
    let lastDeferred = !!state.deferExactAfterSettle;
    probe.intervalId = globalThis.setInterval(() => {
      const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
        ? state.runtimeChunkLoadState
        : {};
      const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      const visualMetric = metrics.scenarioChunkPromotionVisualStage || null;
      if (state.deferExactAfterSettle) {
        probe.sawDeferred = true;
      }
      if (
        !probe.visualRecordedAt
        && visualMetric
        && Number(visualMetric.recordedAt || 0) >= probe.startedAt
      ) {
        probe.visualRecordedAt = Number(visualMetric.recordedAt || 0);
      }
      if (probe.sawDeferred && lastDeferred && !state.deferExactAfterSettle && !probe.exactClearedAt) {
        probe.exactClearedAt = Date.now();
      }
      lastDeferred = !!state.deferExactAfterSettle;
      probe.maxSelectionVersion = Math.max(
        probe.maxSelectionVersion,
        Number(loadState.selectionVersion || 0),
      );
      probe.sawPendingVisualField = probe.sawPendingVisualField
        || Object.prototype.hasOwnProperty.call(loadState, "pendingVisualPromotion");
      probe.sawPendingInfraField = probe.sawPendingInfraField
        || Object.prototype.hasOwnProperty.call(loadState, "pendingInfraPromotion");
    }, 20);
    state.__chunkPromotionVisualStageProbe = probe;
  });
}

test("chunk promotion visual stage can land before exact-after-settle clears", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "warning" && type !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
      return;
    }
    consoleIssues.push({ type, text });
  });

  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkFailures.push({ url: response.url(), status: response.status() });
    }
  });

  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      status: "failed",
      errorText: request.failure() ? request.failure().errorText : "requestfailed",
    });
  });

  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  await setZoomPercent(page, 105);
  await waitForStableExactRender(page);
  consoleIssues.length = 0;
  networkFailures.length = 0;

  const seededState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    state.runtimeChunkLoadState = {
      ...loadState,
      selectionVersion: Number(loadState.selectionVersion || 0),
    };
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      initialSelectionVersion: Number(state.runtimeChunkLoadState?.selectionVersion || 0),
      initialVisualMetricRecordedAt: Number(metrics.scenarioChunkPromotionVisualStage?.recordedAt || 0),
    };
  });

  expect(seededState.activeScenarioId).toBe("tno_1962");
  await startChunkPromotionProbe(page);

  await setZoomPercent(page, 120, { waitAfterMs: 0 });
  await scheduleExactAfterSettleRefreshForFocusedTest(page);
  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    const probe = state?.__chunkPromotionVisualStageProbe || null;
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const exactPassMetric = metrics.settleExactRefreshPasses || null;
    return !!state.deferExactAfterSettle
      || !!state.exactAfterSettleHandle
      || !!probe?.sawDeferred
      || Number(exactPassMetric?.recordedAt || 0) >= Number(probe?.startedAt || 0);
  }, { timeout: 20_000 });
  await waitForStableExactRender(page, { timeout: 30_000 });

  const finalState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const probe = state.__chunkPromotionVisualStageProbe && typeof state.__chunkPromotionVisualStageProbe === "object"
      ? { ...state.__chunkPromotionVisualStageProbe }
      : {};
    if (probe.intervalId) {
      globalThis.clearInterval(probe.intervalId);
      delete probe.intervalId;
    }
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    return {
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      selectionVersion: Number(loadState.selectionVersion || 0),
      hasPendingVisualPromotionField: Object.prototype.hasOwnProperty.call(loadState, "pendingVisualPromotion"),
      hasPendingInfraPromotionField: Object.prototype.hasOwnProperty.call(loadState, "pendingInfraPromotion"),
      visualMetricRecordedAt: Number(metrics.scenarioChunkPromotionVisualStage?.recordedAt || 0),
      probe,
    };
  });

  expect(finalState.renderPhase).toBe("idle");
  expect(finalState.deferExactAfterSettle).toBe(false);
  expect(finalState.hasExactAfterSettleHandle).toBe(false);
  expect(finalState.hasPendingVisualPromotionField).toBe(true);
  expect(finalState.hasPendingInfraPromotionField).toBe(true);
  expect(finalState.visualMetricRecordedAt).toBeGreaterThanOrEqual(seededState.initialVisualMetricRecordedAt);
  expect(finalState.probe.sawDeferred).toBe(true);
  expect(finalState.probe.sawPendingVisualField).toBe(true);
  expect(finalState.probe.sawPendingInfraField).toBe(true);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

test("large chunked startup shows coarse first frame before async detail prewarm handoff", async ({ page }) => {
  await gotoApp(page, HOI4_ASYNC_PREWARM_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.waitForFunction(() => {
    const state = globalThis.__playwrightStateRef || null;
    const prewarmMetric = state.scenarioPerfMetrics?.chunkedFirstFramePrewarm || null;
    const visualPromotionMetric = state.renderPerfMetrics?.scenarioChunkPromotionVisualStage || null;
    return !!prewarmMetric
      && prewarmMetric.mode === "async"
      && prewarmMetric.synchronous === false
      && prewarmMetric.awaited === false
      && prewarmMetric.chunkPrewarmDeferred === true
      && Number(prewarmMetric.refreshScheduledAt || 0) > 0
      && Number(prewarmMetric.detailPrewarmStartedAt || 0) > 0
      && Number(prewarmMetric.detailPrewarmCompletedAt || 0) >= Number(prewarmMetric.detailPrewarmStartedAt || 0)
      && !!visualPromotionMetric
      && String(visualPromotionMetric.activeScenarioId || "") === "hoi4_1939"
      && Number(visualPromotionMetric.promotionVersion || 0) >= 1;
  }, { timeout: 30_000 });

  const stageOrder = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const prewarmMetric = state.scenarioPerfMetrics?.chunkedFirstFramePrewarm || null;
    const visualPromotionMetric = state.renderPerfMetrics?.scenarioChunkPromotionVisualStage || null;
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      prewarmMetric,
      visualPromotionMetric,
    };
  });

  expect(stageOrder.activeScenarioId).toBe("hoi4_1939");
  expect(stageOrder.prewarmMetric).toBeTruthy();
  expect(stageOrder.prewarmMetric.mode).toBe("async");
  expect(stageOrder.prewarmMetric.synchronous).toBe(false);
  expect(stageOrder.prewarmMetric.awaited).toBe(false);
  expect(stageOrder.prewarmMetric.chunkPrewarmDeferred).toBe(true);
  expect(Number(stageOrder.prewarmMetric.refreshScheduledAt || 0)).toBeGreaterThan(0);
  expect(Number(stageOrder.prewarmMetric.detailPrewarmStartedAt || 0)).toBeGreaterThan(0);
  expect(Number(stageOrder.prewarmMetric.detailPrewarmCompletedAt || 0))
    .toBeGreaterThanOrEqual(Number(stageOrder.prewarmMetric.detailPrewarmStartedAt || 0));
  expect(String(stageOrder.visualPromotionMetric?.activeScenarioId || "")).toBe("hoi4_1939");
  expect(Number(stageOrder.visualPromotionMetric?.promotionVersion || 0)).toBeGreaterThanOrEqual(1);
});

test("exact-after-settle repaints political pass with stable invalidation metric", async ({ page }) => {
  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const beforeRefresh = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      politicalPassRenders: Number(state.renderPassCache?.counters?.politicalPassRenders || 0),
      settleExactRefreshPassesSequence: Number(metrics.settleExactRefreshPasses?.sequence || 0),
    };
  });

  expect(beforeRefresh.activeScenarioId).toBe("tno_1962");

  const scheduled = await scheduleExactAfterSettleRefreshForFocusedTest(page);
  expect(scheduled).toBe(true);
  await waitForStableExactRender(page, { timeout: 30_000 });
  await page.waitForFunction((previousSequence) => {
    const state = globalThis.__playwrightStateRef || null;
    const metrics = state?.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return Number(metrics.settleExactRefreshPasses?.sequence || 0) > Number(previousSequence || 0);
  }, beforeRefresh.settleExactRefreshPassesSequence, { timeout: 30_000 });

  const afterRefresh = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      politicalPassRenders: Number(state.renderPassCache?.counters?.politicalPassRenders || 0),
      settleExactRefreshPasses: metrics.settleExactRefreshPasses || null,
    };
  });

  expect(afterRefresh.activeScenarioId).toBe("tno_1962");
  expect(afterRefresh.renderPhase).toBe("idle");
  expect(afterRefresh.deferExactAfterSettle).toBe(false);
  expect(afterRefresh.hasExactAfterSettleHandle).toBe(false);
  expect(afterRefresh.politicalPassRenders).toBeGreaterThan(beforeRefresh.politicalPassRenders);
  expect(afterRefresh.settleExactRefreshPasses?.targetPasses || []).toContain("political");
  expect(afterRefresh.settleExactRefreshPasses?.politicalInvalidationReason).toBe("exact-after-settle-political");
  expect(Number(afterRefresh.settleExactRefreshPasses?.politicalInvalidatedAt || 0)).toBeGreaterThan(0);
});

test("tno zoom diagnostic keeps political pass padded during transformed frames", async ({ page }) => {
  await gotoApp(page, `${FAST_STARTUP_PATH}&render_diag=1`, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const previousTransformedPoliticalSignature = await page.evaluate(() => JSON.stringify(
    globalThis.__mapRenderDiag?.transformedPasses?.political || null,
  ));
  await setZoomPercent(page, 145, { waitAfterMs: 0 });
  const diagHandle = await page.waitForFunction((previousSignature) => {
    const diag = globalThis.__mapRenderDiag || {};
    const politicalPass = diag.politicalPass || null;
    const transformedPolitical = (diag.transformedPasses || {}).political || null;
    const transformedPoliticalSignature = JSON.stringify(transformedPolitical);
    const currentScale = Number(transformedPolitical?.current?.k);
    const scaleRatio = Number(transformedPolitical?.scaleRatio);
    if (
      !politicalPass
      || !transformedPolitical
      || transformedPoliticalSignature === previousSignature
      || !Number.isFinite(currentScale)
      || Math.abs(currentScale - 1.45) > 0.001
      || !Number.isFinite(scaleRatio)
      || scaleRatio <= 0
      || Number(politicalPass.visibleItemCount || 0) <= 0
      || Number(politicalPass.overscanPx || 0) <= 96
      || Math.abs(scaleRatio - 1) <= 0.01
    ) {
      return false;
    }
    return {
      politicalPass,
      transformedPolitical,
      transformedPoliticalSignature,
    };
  }, previousTransformedPoliticalSignature, { timeout: 30_000 });
  const diag = await diagHandle.jsonValue();

  expect(diag.politicalPass.visibleItemCount).toBeGreaterThan(0);
  expect(diag.politicalPass.overscanPx).toBeGreaterThan(96);
  expect(diag.transformedPolitical).toBeTruthy();
  expect(diag.transformedPoliticalSignature).not.toBe(previousTransformedPoliticalSignature);
  expect(Number(diag.transformedPolitical.current.k)).toBeCloseTo(1.45, 3);
  expect(Number.isFinite(Number(diag.transformedPolitical.scaleRatio))).toBe(true);
  expect(Number(diag.transformedPolitical.scaleRatio)).toBeGreaterThan(0);
  expect(Math.abs(Number(diag.transformedPolitical.scaleRatio) - 1)).toBeGreaterThan(0.01);
});

test("tno drag interaction settles cleanly without black-frame regression", async ({ page }) => {
  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const beforeDrag = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
    };
  });

  expect(beforeDrag.activeScenarioId).toBe("tno_1962");

  await dragMap(page);
  await waitForStableExactRender(page, { timeout: 30_000 });

  const afterDrag = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      isInteracting: !!state.isInteracting,
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
    };
  });

  expect(afterDrag.activeScenarioId).toBe("tno_1962");
  expect(afterDrag.renderPhase).toBe("idle");
  expect(afterDrag.deferExactAfterSettle).toBe(false);
  expect(afterDrag.hasExactAfterSettleHandle).toBe(false);
  expect(afterDrag.isInteracting).toBe(false);
  expect(afterDrag.blackFrameCount).toBe(beforeDrag.blackFrameCount);
});

test("tno zoom-end keeps Great Lakes Congo political detail fill stable", async ({ page }) => {
  const landProbes = [
    { id: "west_kivu_drc", lon: 28.85, lat: -1.65 },
    { id: "west_tanganyika_drc", lon: 28.95, lat: -4.6 },
  ];

  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);
  await waitForFullPoliticalColorCoverage(page);

  const beforeZoom = await page.evaluate(async (probes) => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
      ? state.landDataFull.features
      : (Array.isArray(state.landData?.features) ? state.landData.features : []);
    const getFeatureId = (feature) => {
      const props = feature?.properties || {};
      return String(props.id || props.NUTS_ID || feature?.id || "").trim();
    };
    const results = probes.map((probe) => {
      let matchedFeature = null;
      for (const feature of features) {
        try {
          if (feature?.geometry && d3.geoContains(feature, [probe.lon, probe.lat])) {
            matchedFeature = feature;
            break;
          }
        } catch (_error) {
          // Ignore malformed geometries while sampling this fixed regression probe.
        }
      }
      const props = matchedFeature?.properties || {};
      const featureId = getFeatureId(matchedFeature);
      return {
        ...probe,
        featureId,
        countryCode: String(props.cntr_code || "").trim(),
        resolvedColor: featureId ? String(state.colors?.[featureId] || "") : "",
      };
    });
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
      results,
    };
  }, landProbes);

  expect(beforeZoom.activeScenarioId).toBe("tno_1962");
  for (const probe of beforeZoom.results) {
    expect(probe.featureId, `missing feature before zoom at ${probe.id}`).toBeTruthy();
    expect(probe.countryCode, `missing country before zoom at ${probe.id}`).toBeTruthy();
    expect(probe.resolvedColor, `missing color before zoom at ${probe.id}`).toBeTruthy();
  }
  const beforePixelSamples = await samplePoliticalFeaturePixels(page, landProbes);
  for (const sample of beforePixelSamples) {
    expect(sample.error, `pixel probe failed before zoom at ${sample.id}: ${JSON.stringify(sample)}`).toBeFalsy();
    expect(sample.nonLandPixelCount, `land-fill-only pixels before zoom at ${sample.id}: ${JSON.stringify(sample)}`)
      .toBeGreaterThan(0);
    expect(sample.bestResolvedDistance, `visible pixel does not match resolved color before zoom at ${sample.id}: ${JSON.stringify(sample)}`)
      .toBeLessThan(55);
  }

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.getViewportGeoBoundsFn = () => [12, -8, 28, 6];
    if (state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object") {
      state.runtimeChunkLoadState.focusCountryOverride = "GCO";
    }
  });
  await setZoomPercent(page, 175, { waitAfterMs: 0 });
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const loadState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : null;
    if (loadState) {
      loadState.pendingReason = "zoom-end";
      loadState.pendingDelayMs = 0;
    }
    if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn({ reason: "zoom-end", delayMs: 0, flushPending: true });
    }
  });
  await page.waitForFunction((expectedChunkIds) => {
    const state = globalThis.__playwrightStateRef || null;
    const loadedChunkIds = Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
    return expectedChunkIds.every((chunkId) => loadedChunkIds.includes(chunkId));
  }, ["political.detail.country.gco"], { timeout: 30_000 });
  await waitForStableExactRender(page, { timeout: 30_000 });

  const afterZoom = await page.evaluate(async (probes) => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
      ? state.landDataFull.features
      : (Array.isArray(state.landData?.features) ? state.landData.features : []);
    const requiredChunkIds = Array.isArray(state.runtimeChunkLoadState?.lastSelection?.requiredChunkIds)
      ? state.runtimeChunkLoadState.lastSelection.requiredChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
    const loadedChunkIds = Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
    const getFeatureId = (feature) => {
      const props = feature?.properties || {};
      return String(props.id || props.NUTS_ID || feature?.id || "").trim();
    };
    const results = probes.map((probe) => {
      let matchedFeature = null;
      for (const feature of features) {
        try {
          if (feature?.geometry && d3.geoContains(feature, [probe.lon, probe.lat])) {
            matchedFeature = feature;
            break;
          }
        } catch (_error) {
          // Ignore malformed geometries while sampling this fixed regression probe.
        }
      }
      const props = matchedFeature?.properties || {};
      const featureId = getFeatureId(matchedFeature);
      return {
        ...probe,
        featureId,
        countryCode: String(props.cntr_code || "").trim(),
        resolvedColor: featureId ? String(state.colors?.[featureId] || "") : "",
      };
    });
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      isInteracting: !!state.isInteracting,
      requiredChunkIds,
      loadedChunkIds,
      blackFrameCount: Number(metrics.blackFrameCount?.count || 0),
      visualMetric: metrics.scenarioChunkPromotionVisualStage || null,
      results,
    };
  }, landProbes);

  expect(afterZoom.activeScenarioId).toBe("tno_1962");
  expect(afterZoom.renderPhase).toBe("idle");
  expect(afterZoom.deferExactAfterSettle).toBe(false);
  expect(afterZoom.hasExactAfterSettleHandle).toBe(false);
  expect(afterZoom.isInteracting).toBe(false);
  expect(afterZoom.blackFrameCount).toBe(beforeZoom.blackFrameCount);
  expect(afterZoom.requiredChunkIds).toContain("political.detail.country.gco");
  expect(afterZoom.loadedChunkIds).toContain("political.detail.country.gco");
  const afterPixelSamples = await samplePoliticalFeaturePixels(page, landProbes);
  for (const [index, probe] of afterZoom.results.entries()) {
    const beforeProbe = beforeZoom.results[index];
    expect(probe.featureId, `missing feature after zoom at ${probe.id}`).toBeTruthy();
    expect(probe.countryCode, `country changed after zoom at ${probe.id}`).toBe(beforeProbe.countryCode);
    expect(probe.resolvedColor, `missing color after zoom at ${probe.id}`).toBeTruthy();
    expect(probe.resolvedColor, `color changed after zoom at ${probe.id}`).toBe(beforeProbe.resolvedColor);
  }
  for (const [index, sample] of afterPixelSamples.entries()) {
    const beforeSample = beforePixelSamples[index];
    expect(sample.error, `pixel probe failed after zoom at ${sample.id}: ${JSON.stringify(sample)}`).toBeFalsy();
    expect(sample.nonLandPixelCount, `land-fill-only pixels after zoom at ${sample.id}: ${JSON.stringify(sample)}`)
      .toBeGreaterThan(0);
    expect(sample.bestResolvedDistance, `visible pixel does not match resolved color after zoom at ${sample.id}: ${JSON.stringify(sample)}`)
      .toBeLessThan(55);
    expect(sample.resolvedColor, `pixel resolved color changed after zoom at ${sample.id}`).toBe(beforeSample.resolvedColor);
  }
});

test("tno post-edit keeps political detail fill before progressive recovery skip", async ({ page }) => {
  const targetFeatureId = "FR_ARR_18002";
  const editColor = "#ff00aa";

  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const editResult = await page.evaluate(async ({ targetFeatureId, color }) => {
    const { state } = await import("/js/core/state.js");
    const {
      projectGeoToScreen,
      refreshMapDataForScenarioChunkPromotion,
      refreshResolvedColorsForFeatures,
    } = await import("/js/core/map_renderer.js");
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    const getFeatureId = (feature) => {
      const props = feature?.properties || {};
      return String(props.id || props.NUTS_ID || feature?.id || "").trim();
    };
    const normalizePoint = (coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
    };
    const collectRings = (geometry) => {
      if (!geometry || !Array.isArray(geometry.coordinates)) return [];
      if (geometry.type === "Polygon") return geometry.coordinates;
      if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
      return [];
    };
    const summarizeBounds = (points) => {
      if (!points.length) return null;
      return points.reduce((bounds, point) => ({
        minLon: Math.min(bounds.minLon, point[0]),
        minLat: Math.min(bounds.minLat, point[1]),
        maxLon: Math.max(bounds.maxLon, point[0]),
        maxLat: Math.max(bounds.maxLat, point[1]),
      }), {
        minLon: Number.POSITIVE_INFINITY,
        minLat: Number.POSITIVE_INFINITY,
        maxLon: Number.NEGATIVE_INFINITY,
        maxLat: Number.NEGATIVE_INFINITY,
      });
    };
    const collectProbeCandidates = (feature) => {
      const rings = collectRings(feature?.geometry);
      const points = [];
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        for (const coordinate of ring) {
          const point = normalizePoint(coordinate);
          if (point) points.push(point);
        }
      }
      const candidates = [];
      try {
        const centroidPoint = normalizePoint(d3.geoCentroid(feature));
        if (centroidPoint) candidates.push({ source: "geo-centroid", point: centroidPoint });
      } catch (_error) {
        // Keep deterministic feature probe selection even when centroid helpers reject a geometry.
      }
      const bounds = summarizeBounds(points);
      if (bounds) {
        candidates.push({
          source: "bounds-center",
          point: [
            (bounds.minLon + bounds.maxLon) / 2,
            (bounds.minLat + bounds.maxLat) / 2,
          ],
        });
      }
      const step = Math.max(1, Math.floor(points.length / 64));
      for (let index = 0; index < points.length; index += step) {
        candidates.push({ source: "vertex", point: points[index] });
      }
      for (let index = step; index < points.length; index += step) {
        const previous = points[Math.max(0, index - step)];
        const current = points[index];
        if (!previous || !current) continue;
        candidates.push({
          source: "segment-midpoint",
          point: [
            (previous[0] + current[0]) / 2,
            (previous[1] + current[1]) / 2,
          ],
        });
      }
      return { candidates, bounds, pointCount: points.length };
    };

    const targetFeature = features.find((feature) => getFeatureId(feature) === targetFeatureId) || null;
    if (!targetFeature) {
      return {
        error: "target-feature-missing",
        targetFeatureId,
        featureCount: features.length,
        sampleFeatureIds: features.map(getFeatureId).filter(Boolean).slice(0, 16),
      };
    }
    if (!state.colors?.[targetFeatureId]) {
      return {
        error: "target-color-missing",
        targetFeatureId,
        targetGeometryType: String(targetFeature?.geometry?.type || ""),
      };
    }
    const probeSearch = collectProbeCandidates(targetFeature);
    let selectedProbe = null;
    for (const candidate of probeSearch.candidates) {
      const point = candidate?.point;
      if (!point) continue;
      try {
        if (targetFeature?.geometry && d3.geoContains(targetFeature, point)) {
          selectedProbe = { ...candidate, lon: point[0], lat: point[1] };
          break;
        }
      } catch (_error) {
        // Keep searching later candidates from the same target geometry.
      }
    }
    if (!selectedProbe) {
      return {
        error: "target-probe-missing",
        targetFeatureId,
        targetGeometryType: String(targetFeature?.geometry?.type || ""),
        targetProbeSearch: {
          bounds: probeSearch.bounds,
          candidateCount: probeSearch.candidates.length,
          pointCount: probeSearch.pointCount,
          firstCandidates: probeSearch.candidates.slice(0, 8).map((candidate) => ({
            source: candidate.source,
            point: candidate.point,
          })),
        },
      };
    }
    const selected = {
      id: targetFeatureId,
      lon: selectedProbe.lon,
      lat: selectedProbe.lat,
      featureId: targetFeatureId,
      probeSource: selectedProbe.source,
    };

    const toList = (value) => {
      if (value instanceof Set) return Array.from(value);
      if (Array.isArray(value)) return value.slice();
      return [];
    };
    const parseRgb = (value) => {
      const text = String(value || "").trim();
      const hex = /^#?([0-9a-f]{6})$/i.exec(text);
      if (!hex) return null;
      const number = Number.parseInt(hex[1], 16);
      return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    };
    const distance = (left, right) => {
      if (!Array.isArray(left) || !Array.isArray(right)) return Number.POSITIVE_INFINITY;
      return (
        Math.abs(Number(left[0] || 0) - Number(right[0] || 0))
        + Math.abs(Number(left[1] || 0) - Number(right[1] || 0))
        + Math.abs(Number(left[2] || 0) - Number(right[2] || 0))
      ) / 3;
    };
    const sampleMainCanvas = () => {
      const canvas = document.getElementById("map-canvas");
      const context = canvas instanceof HTMLCanvasElement
        ? canvas.getContext("2d", { willReadFrequently: true })
        : null;
      if (!canvas || !context || !d3 || !state.landData) return { error: "sample-unavailable" };
      const dpr = Number(state.dpr || globalThis.devicePixelRatio || 1);
      const rendererScreenPoint = typeof projectGeoToScreen === "function"
        ? projectGeoToScreen(Number(selected.lon), Number(selected.lat))
        : null;
      let projected = rendererScreenPoint;
      if (!Array.isArray(projected)) {
        const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
        const x1 = Math.max(padding + 1, state.width - padding);
        const y1 = Math.max(padding + 1, state.height - padding);
        const projection = d3.geoEqualEarth().precision(0.1);
        projection.clipExtent(null);
        projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
        projected = projection([Number(selected.lon), Number(selected.lat)]);
      }
      if (!Array.isArray(projected) || !projected.every(Number.isFinite)) return { error: "projection-miss" };
      const transform = state.zoomTransform || d3.zoomIdentity || { x: 0, y: 0, k: 1 };
      const cx = rendererScreenPoint
        ? projected[0] * dpr
        : ((projected[0] * transform.k) + transform.x) * dpr;
      const cy = rendererScreenPoint
        ? projected[1] * dpr
        : ((projected[1] * transform.k) + transform.y) * dpr;
      const radiusPx = Math.max(2, 7 * dpr);
      const minX = Math.max(0, Math.floor(cx - radiusPx));
      const minY = Math.max(0, Math.floor(cy - radiusPx));
      const maxX = Math.min(canvas.width, Math.ceil(cx + radiusPx));
      const maxY = Math.min(canvas.height, Math.ceil(cy + radiusPx));
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const data = context.getImageData(minX, minY, width, height).data;
      const resolvedRgb = parseRgb(String(state.colors?.[selected.featureId] || ""));
      let bestRgb = null;
      let bestResolvedDistance = Number.POSITIVE_INFINITY;
      let pixelCount = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (!data[index + 3]) continue;
        const rgb = [data[index], data[index + 1], data[index + 2]];
        const resolvedDistance = distance(rgb, resolvedRgb);
        pixelCount += 1;
        if (resolvedDistance < bestResolvedDistance) {
          bestResolvedDistance = resolvedDistance;
          bestRgb = rgb;
        }
      }
      const center = context.getImageData(
        Math.max(0, Math.min(canvas.width - 1, Math.round(cx))),
        Math.max(0, Math.min(canvas.height - 1, Math.round(cy))),
        1,
        1,
      ).data;
      return {
        canvasPoint: { x: cx, y: cy },
        sampleBox: { minX, minY, width, height },
        centerRgb: [center[0], center[1], center[2]],
        bestRgb,
        bestResolvedDistance,
        pixelCount,
      };
    };
    const buildSnapshot = (label) => {
      const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
        ? state.renderPerfMetrics
        : (globalThis.__renderPerfMetrics || {});
      const cache = state.renderPassCache || {};
      const lastGoodFrame = cache.lastGoodFrame || {};
      return {
        label,
        featureId: selected.featureId,
        resolvedColor: String(state.colors?.[selected.featureId] || ""),
        visualOverride: String(state.visualOverrides?.[selected.featureId] || ""),
        colorRevision: Number(state.colorRevision || 0),
        sovereigntyRevision: Number(state.sovereigntyRevision || 0),
        scenarioDataGeneration: Number(state.scenarioDataGeneration || 0),
        renderPhase: String(state.renderPhase || ""),
        deferExactAfterSettle: !!state.deferExactAfterSettle,
        hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
        renderPassCache: {
          dirty: { political: !!cache.dirty?.political },
          reasons: { political: String(cache.reasons?.political || "") },
        },
        partialPoliticalDirtyIds: toList(cache.partialPoliticalDirtyIds),
        pendingPoliticalColorEditIds: toList(cache.pendingPoliticalColorEditIds),
        pendingPoliticalColorEditRevision: Number(cache.pendingPoliticalColorEditRevision ?? -1),
        pendingPoliticalColorEditReason: String(cache.pendingPoliticalColorEditReason || ""),
        pendingPoliticalColorEditFirstPixelPaintSource: String(cache.pendingPoliticalColorEditFirstPixelPaintSource || ""),
        politicalPassRenders: Number(cache.counters?.politicalPassRenders || 0),
        composites: Number(cache.counters?.composites || 0),
        drawPoliticalFeatureFillLoop: metrics.drawPoliticalFeatureFillLoop || null,
        drawPoliticalBackgroundFillsPass: metrics.drawPoliticalBackgroundFillsPass || null,
        scenarioChunkPromotionVisualStage: metrics.scenarioChunkPromotionVisualStage || null,
        politicalPartialRepaint: metrics.politicalPartialRepaint || null,
        lastGoodFrame: {
          valid: !!lastGoodFrame.valid,
          stale: !!lastGoodFrame.stale,
          reason: String(lastGoodFrame.reason || ""),
          staleReason: String(lastGoodFrame.staleReason || ""),
          rejectedReason: String(lastGoodFrame.rejectedReason || ""),
          colorRevision: Number(lastGoodFrame.colorRevision || 0),
          scenarioDataGeneration: Number(lastGoodFrame.scenarioDataGeneration || 0),
          commitKeySignature: String(lastGoodFrame.commitKeySignature || ""),
          reuseCount: Number(cache.counters?.lastGoodFrameReuses || 0),
          visibleFrameReusedCount: Number(cache.counters?.visibleFrameReusedCount || 0),
          visibleFrameRejectedCount: Number(cache.counters?.visibleFrameRejectedCount || 0),
        },
        runtimeChunkLoadState: {
          pendingPromotion: !!state.runtimeChunkLoadState?.pendingPromotion,
          pendingVisualPromotion: !!state.runtimeChunkLoadState?.pendingVisualPromotion,
          pendingInfraPromotion: !!state.runtimeChunkLoadState?.pendingInfraPromotion,
          promotionScheduled: !!state.runtimeChunkLoadState?.promotionScheduled,
          refreshScheduled: !!state.runtimeChunkLoadState?.refreshScheduled,
          promotionCommitInFlight: !!state.runtimeChunkLoadState?.promotionCommitInFlight,
        },
        mainCanvasSample: sampleMainCanvas(),
      };
    };
    const snapshots = [buildSnapshot("before-edit")];

    state.visualOverrides = state.visualOverrides || {};
    state.visualOverrides[selected.featureId] = color;
    refreshResolvedColorsForFeatures([selected.featureId], { renderNow: false });
    snapshots.push(buildSnapshot("after-refresh-resolved-colors"));
    const pendingAfterRefresh = {
      size: Number(state.renderPassCache?.pendingPoliticalColorEditIds?.size || 0),
      revision: Number(state.renderPassCache?.pendingPoliticalColorEditRevision ?? -1),
      colorRevision: Number(state.colorRevision || 0),
      reason: String(state.renderPassCache?.pendingPoliticalColorEditReason || ""),
    };

    if (state.renderPerfMetrics && typeof state.renderPerfMetrics === "object") {
      delete state.renderPerfMetrics.drawPoliticalFeatureFillLoop;
      delete state.renderPerfMetrics.drawPoliticalFeatureStrokeLoop;
      delete state.renderPerfMetrics.drawPoliticalBackgroundFillsPass;
    }
    if (globalThis.__renderPerfMetrics && typeof globalThis.__renderPerfMetrics === "object") {
      delete globalThis.__renderPerfMetrics.drawPoliticalFeatureFillLoop;
      delete globalThis.__renderPerfMetrics.drawPoliticalFeatureStrokeLoop;
      delete globalThis.__renderPerfMetrics.drawPoliticalBackgroundFillsPass;
    }

    refreshMapDataForScenarioChunkPromotion({
      reason: "scenario-chunk-promotion",
      changedLayerKeys: ["political"],
      politicalFeatureIds: [selected.featureId],
      hasPoliticalPayloadChange: true,
      suppressRender: false,
    });
    snapshots.push(buildSnapshot("after-scenario-chunk-promotion"));

    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const fillMetric = metrics.drawPoliticalFeatureFillLoop || null;
    const strokeMetric = metrics.drawPoliticalFeatureStrokeLoop || null;
    const backgroundMetric = metrics.drawPoliticalBackgroundFillsPass || null;
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      selected,
      resolvedColor: String(state.colors?.[selected.featureId] || ""),
      renderPhase: String(state.renderPhase || ""),
      pendingAfterRefresh,
      pendingAfterPromotion: {
        size: Number(state.renderPassCache?.pendingPoliticalColorEditIds?.size || 0),
        revision: Number(state.renderPassCache?.pendingPoliticalColorEditRevision ?? -1),
        colorRevision: Number(state.colorRevision || 0),
      },
      dirtyReason: String(state.renderPassCache?.reasons?.political || ""),
      fillMetric,
      strokeMetric,
      backgroundMetric,
      snapshots,
    };
  }, {
    targetFeatureId,
    color: editColor,
  });

  expect(editResult.error, JSON.stringify(editResult)).toBeFalsy();
  expect(editResult.activeScenarioId).toBe("tno_1962");
  expect(editResult.selected?.featureId, JSON.stringify(editResult)).toBe(targetFeatureId);
  expect(editResult.resolvedColor.toLowerCase()).toBe(editColor);
  expect(editResult.pendingAfterRefresh.size).toBeGreaterThan(0);
  expect(editResult.pendingAfterRefresh.revision).toBe(editResult.pendingAfterRefresh.colorRevision);
  expect(editResult.pendingAfterRefresh.reason).toBe("refresh-colors");
  expect(editResult.fillMetric?.reason || "").not.toBe("progressive-coarse-underlay");
  expect(Number(editResult.fillMetric?.renderedCount || 0), JSON.stringify(editResult)).toBeGreaterThan(0);
  expect(editResult.strokeMetric?.reason || "").not.toBe("progressive-coarse-underlay");

  const postEditPaint = await waitForPostEditPoliticalPaint(page, {
    featureId: editResult.selected.featureId,
    probe: editResult.selected,
    expectedColor: editColor,
    colorRevision: editResult.pendingAfterRefresh.colorRevision,
    previousPoliticalPassRenders: Number(editResult.snapshots?.[0]?.politicalPassRenders || 0),
    previousComposites: Number(editResult.snapshots?.[0]?.composites || 0),
  });
  expect(postEditPaint.pendingPoliticalColorEditIds, JSON.stringify({ editResult, postEditPaint })).toHaveLength(0);
  expect(postEditPaint.pendingPoliticalColorEditRevision, JSON.stringify({ editResult, postEditPaint })).toBe(-1);
  expect(postEditPaint.renderPassCache?.dirty?.political, JSON.stringify({ editResult, postEditPaint })).toBe(false);

  const pixelSamples = await samplePoliticalFeaturePixels(page, [editResult.selected], { radius: 7 });
  expect(pixelSamples[0].error, `pixel probe failed after edit: ${JSON.stringify({ sample: pixelSamples[0], editResult, postEditPaint })}`).toBeFalsy();
  expect(pixelSamples[0].bestResolvedDistance, `edited color not visible after promotion: ${JSON.stringify({ sample: pixelSamples[0], editResult, postEditPaint })}`)
    .toBeLessThan(55);
});

test("tno runtime color coverage includes rendered spatial items", async ({ page }) => {
  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);
  await waitForFullPoliticalColorCoverage(page);

  // 这里锁的是“已经进入可见绘制列表”的颜色合同，覆盖 spatialItems 比只查 landData state 更接近真实画布路径。
  const coverage = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      getCountryCode: getSharedFeatureCountryCode,
      getFeatureId: getSharedFeatureId,
      normalizeFeatureCountryCode,
    } = await import("/js/core/feature_identity.js");
    const spatialItems = Array.isArray(state.spatialItems) ? state.spatialItems : [];
    const colors = state.colors && typeof state.colors === "object" ? state.colors : {};
    const ownerColors = {
      ...(state.sovereignBaseColors || {}),
    };
    const missingFeatureIds = [];
    const missingResolvedColors = [];
    const missingFullResolvedColors = [];
    const missingOwnerColors = [];
    const countryOwnerSourceMismatches = [];
    const fullFeatures = Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length
      ? state.landDataFull.features
      : (Array.isArray(state.landData?.features) ? state.landData.features : []);
    const interactiveFeatureCount = Array.isArray(state.landData?.features) ? state.landData.features.length : 0;
    const normalizeCode = (value) => normalizeFeatureCountryCode(value, { allowReserved: true });
    const getFeatureId = (feature, fallback = "") => {
      return getSharedFeatureId(feature, { fallback });
    };
    const landFeatureIds = new Set(
      (Array.isArray(state.landData?.features) ? state.landData.features : [])
        .map((feature, index) => getFeatureId(feature, `feature-${index}`))
        .filter(Boolean)
    );
    const fullFeatureIds = new Set(
      fullFeatures
        .map((feature, index) => getFeatureId(feature, `feature-${index}`))
        .filter(Boolean)
    );
    const getFeatureCountryCode = (feature, fallback = "") => {
      return getSharedFeatureCountryCode(feature, {
        fallbackCountryCode: fallback,
        fallbackId: fallback,
      });
    };
    const getBaseColorFields = (countryCode) => {
      const code = normalizeCode(countryCode);
      const sovereignBaseColor = String(state.sovereignBaseColors?.[code] || "");
      return {
        sovereignBaseColor,
        baseColor: sovereignBaseColor,
      };
    };
    const getDisplayOwnerCode = (feature, featureId, fallbackCountryCode = "") => {
      const props = feature?.properties || {};
      const directOwnerCode = normalizeCode(state.sovereigntyByFeatureId?.[featureId] || "");
      const shellOwnerCode = normalizeCode(
        state.scenarioAutoShellOwnerByFeatureId?.[featureId]
        || props.scenario_shell_owner_hint
        || props.scenario_shell_controller_hint
        || ""
      );
      const featureCountryCode = getFeatureCountryCode(feature, fallbackCountryCode);
      const shellCandidate = String(props.id ?? featureId ?? feature?.id ?? "").trim().toUpperCase();
      const isScenarioShell = String(props.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback"
        || shellCandidate.startsWith("RU_ARCTIC_FB_")
        || String(props.name || "").toLowerCase().includes("shell fallback");
      if (String(state.mapSemanticMode || "").trim().toLowerCase() === "blank") {
        return isScenarioShell ? (directOwnerCode || shellOwnerCode || "") : directOwnerCode;
      }
      return isScenarioShell
        ? (directOwnerCode || shellOwnerCode || "")
        : (directOwnerCode || featureCountryCode || "");
    };
    const getSourceCollection = (featureId) => {
      if (landFeatureIds.has(featureId)) return "landData";
      if (fullFeatureIds.has(featureId)) return "landDataFull";
      return "spatialItems";
    };
    const getRawOwnerFields = (props = {}) => ({
      owner: props.owner,
      sovereign: props.sovereign,
      cntr_code: props.cntr_code,
      CNTR_CODE: props.CNTR_CODE,
      CNTR: props.CNTR,
      iso_a2: props.iso_a2,
      ISO_A2: props.ISO_A2,
      iso_a2_eh: props.iso_a2_eh,
      ISO_A2_EH: props.ISO_A2_EH,
      adm0_a2: props.adm0_a2,
      ADM0_A2: props.ADM0_A2,
      country_code: props.country_code,
      countryCode: props.countryCode,
      __city_country_code: props.__city_country_code,
      scenario_shell_owner_hint: props.scenario_shell_owner_hint,
      scenario_shell_controller_hint: props.scenario_shell_controller_hint,
      scenario_helper_kind: props.scenario_helper_kind,
      render_as_base_geography: props.render_as_base_geography,
    });
    for (const [index, feature] of fullFeatures.entries()) {
      const props = feature?.properties || {};
      const featureId = getFeatureId(feature, `feature-${index}`);
      const countryCode = getFeatureCountryCode(feature);
      if (countryCode === "ATL") {
        continue;
      }
      if (featureId && !String(colors[featureId] || "").trim()) {
        missingFullResolvedColors.push({
          featureId,
          countryCode,
          index,
        });
      }
    }
    for (const item of spatialItems) {
      const feature = item?.feature || null;
      const props = feature?.properties || {};
      const featureId = String(item?.featureId || getFeatureId(feature) || "").trim();
      const countryCode = getFeatureCountryCode(feature, item?.countryCode);
      const displayOwnerCode = getDisplayOwnerCode(feature, featureId, countryCode);
      const countryBase = getBaseColorFields(countryCode);
      const displayOwnerBase = getBaseColorFields(displayOwnerCode);
      const resolvedColor = String(colors[featureId] || "");
      const sourceCollection = getSourceCollection(featureId);
      if (!featureId) {
        missingFeatureIds.push({
          drawOrder: Number(item?.drawOrder || 0),
          countryCode,
        });
        continue;
      }
      if (countryCode === "ATL") {
        continue;
      }
      if (!resolvedColor.trim()) {
        missingResolvedColors.push({
          featureId,
          countryCode,
          drawOrder: Number(item?.drawOrder || 0),
        });
      }
      if (displayOwnerCode && !displayOwnerBase.baseColor.trim()) {
        missingOwnerColors.push({
          featureId,
          countryCode,
          displayOwnerCode,
          resolvedColor,
          sovereignBaseColor: countryBase.sovereignBaseColor,
          displayOwnerSovereignBaseColor: displayOwnerBase.sovereignBaseColor,
          drawOrder: Number(item?.drawOrder || 0),
          sourceCollection,
          borderMeshCountryCode: item?.borderMeshCountryCode || "",
          rawOwnerFields: getRawOwnerFields(props),
          classification: "base-color-key-missing",
        });
      }
      if (
        countryCode
        && displayOwnerCode
        && countryCode !== displayOwnerCode
        && !countryBase.baseColor.trim()
        && displayOwnerBase.baseColor.trim()
      ) {
        countryOwnerSourceMismatches.push({
          featureId,
          countryCode,
          displayOwnerCode,
          resolvedColor,
          sovereignBaseColor: countryBase.sovereignBaseColor,
          displayOwnerSovereignBaseColor: displayOwnerBase.sovereignBaseColor,
          drawOrder: Number(item?.drawOrder || 0),
          sourceCollection,
          borderMeshCountryCode: item?.borderMeshCountryCode || "",
          rawOwnerFields: getRawOwnerFields(props),
          classification: "display-owner-source-mismatch",
        });
      }
    }
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      spatialItemCount: spatialItems.length,
      fullFeatureCount: fullFeatures.length,
      interactiveFeatureCount,
      colorCount: Object.keys(colors).length,
      ownerColorCount: Object.keys(ownerColors).length,
      missingFeatureIds: missingFeatureIds.slice(0, 20),
      missingResolvedColors: missingResolvedColors.slice(0, 20),
      missingFullResolvedColors: missingFullResolvedColors.slice(0, 20),
      missingOwnerColors: missingOwnerColors.slice(0, 20),
      countryOwnerSourceMismatches: countryOwnerSourceMismatches.slice(0, 20),
      missingFeatureIdCount: missingFeatureIds.length,
      missingResolvedColorCount: missingResolvedColors.length,
      missingFullResolvedColorCount: missingFullResolvedColors.length,
      missingOwnerColorCount: missingOwnerColors.length,
      countryOwnerSourceMismatchCount: countryOwnerSourceMismatches.length,
    };
  });

  expect(coverage.activeScenarioId).toBe("tno_1962");
  expect(coverage.spatialItemCount).toBeGreaterThan(0);
  expect(coverage.fullFeatureCount).toBeGreaterThanOrEqual(coverage.interactiveFeatureCount);
  expect(coverage.colorCount).toBeGreaterThan(0);
  expect(coverage.ownerColorCount).toBeGreaterThan(0);
  expect(coverage.missingFeatureIdCount, `spatial items missing feature ids: ${JSON.stringify(coverage)}`).toBe(0);
  expect(coverage.missingFullResolvedColorCount, `full visual features missing resolved colors: ${JSON.stringify(coverage)}`).toBe(0);
  expect(coverage.missingResolvedColorCount, `rendered spatial items missing resolved colors: ${JSON.stringify(coverage)}`).toBe(0);
  expect(coverage.missingOwnerColorCount, `rendered spatial items missing display owner base colors: ${JSON.stringify(coverage)}`).toBe(0);
});
