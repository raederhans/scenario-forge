const { test, expect } = require("@playwright/test");
const {
  applyScenarioAndWaitIdle,
  gotoApp,
  waitForAppInteractive,
  waitForScenarioSelectReady,
} = require("../support/playwright-app");
const { DEFAULT_FAST_APP_OPEN_PATH, toRootPath } = require("../support/startup-paths");

test.setTimeout(120_000);

const FAST_STARTUP_PATH = toRootPath(DEFAULT_FAST_APP_OPEN_PATH);
const HOI4_SYNC_PREWARM_PATH = `${FAST_STARTUP_PATH}&default_scenario=hoi4_1939`;

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

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(700);
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

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
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

  await setZoomPercent(page, 120);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.deferExactAfterSettle || !!state.exactAfterSettleHandle;
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
  expect(finalState.hasPendingVisualPromotionField).toBe(true);
  expect(finalState.hasPendingInfraPromotionField).toBe(true);
  expect(finalState.visualMetricRecordedAt).toBeGreaterThanOrEqual(seededState.initialVisualMetricRecordedAt);
  expect(finalState.probe.sawDeferred).toBe(true);
  expect(finalState.probe.sawPendingVisualField).toBe(true);
  expect(finalState.probe.sawPendingInfraField).toBe(true);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

test("sync prewarm threshold completes first-frame chunk prewarm before refresh handoff", async ({ page }) => {
  await gotoApp(page, HOI4_SYNC_PREWARM_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);

  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const prewarmMetric = state.scenarioPerfMetrics?.chunkedFirstFramePrewarm || null;
    const visualPromotionMetric = state.renderPerfMetrics?.scenarioChunkPromotionVisualStage || null;
    return !!prewarmMetric
      && prewarmMetric.mode === "sync"
      && Number(prewarmMetric.prewarmCompletedAt || 0) > 0
      && Number(prewarmMetric.refreshScheduledAt || 0) >= Number(prewarmMetric.prewarmCompletedAt || 0)
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
  expect(stageOrder.prewarmMetric.mode).toBe("sync");
  expect(stageOrder.prewarmMetric.synchronous).toBe(true);
  expect(Number(stageOrder.prewarmMetric.prewarmCompletedAt || 0)).toBeGreaterThan(0);
  expect(Number(stageOrder.prewarmMetric.refreshScheduledAt || 0))
    .toBeGreaterThanOrEqual(Number(stageOrder.prewarmMetric.prewarmCompletedAt || 0));
  expect(String(stageOrder.visualPromotionMetric?.activeScenarioId || "")).toBe("hoi4_1939");
  expect(Number(stageOrder.visualPromotionMetric?.promotionVersion || 0)).toBeGreaterThanOrEqual(1);
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
  expect(afterDrag.isInteracting).toBe(false);
  expect(afterDrag.blackFrameCount).toBe(beforeDrag.blackFrameCount);
});

test("tno zoom-end keeps Great Lakes Congo political detail fill stable", async ({ page }) => {
  const landProbes = [
    { id: "west_kivu_drc", lon: 28.85, lat: -1.65 },
    { id: "east_kivu_rwanda", lon: 30.05, lat: -1.95 },
    { id: "north_tanganyika_burundi", lon: 29.35, lat: -3.5 },
    { id: "west_tanganyika_drc", lon: 28.95, lat: -4.6 },
  ];

  await gotoApp(page, FAST_STARTUP_PATH, { waitUntil: "domcontentloaded" });
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962", "TNO 1962");
  await waitForStableExactRender(page);

  const beforeZoom = await page.evaluate(async (probes) => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
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
      const featureId = String(props.id || "").trim();
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
    expect(probe.resolvedColor, `missing color before zoom at ${probe.id}`).toBeTruthy();
  }

  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    state.getViewportGeoBoundsFn = () => [12, -8, 28, 6];
    if (state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object") {
      state.runtimeChunkLoadState.focusCountryOverride = "CD";
    }
  });
  await setZoomPercent(page, 175);
  await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn({ reason: "zoom-end", delayMs: 0 });
    }
  });
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    const loadedChunkIds = Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
    return loadedChunkIds.includes("political.detail.country.cd")
      && loadedChunkIds.includes("political.detail.country.gco");
  }, { timeout: 30_000 });
  await waitForStableExactRender(page, { timeout: 30_000 });

  const afterZoom = await page.evaluate(async (probes) => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const d3 = globalThis.d3;
    const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
    const requiredChunkIds = Array.isArray(state.runtimeChunkLoadState?.lastSelection?.requiredChunkIds)
      ? state.runtimeChunkLoadState.lastSelection.requiredChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
    const loadedChunkIds = Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
      ? state.activeScenarioChunks.loadedChunkIds.map((chunkId) => String(chunkId || ""))
      : [];
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
      const featureId = String(props.id || "").trim();
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
  expect(afterZoom.isInteracting).toBe(false);
  expect(afterZoom.blackFrameCount).toBe(beforeZoom.blackFrameCount);
  expect(afterZoom.loadedChunkIds).toContain("political.detail.country.cd");
  expect(afterZoom.loadedChunkIds).toContain("political.detail.country.gco");
  for (const probe of afterZoom.results) {
    expect(probe.featureId, `missing feature after zoom at ${probe.id}`).toBeTruthy();
    expect(probe.resolvedColor, `missing color after zoom at ${probe.id}`).toBeTruthy();
  }
});
