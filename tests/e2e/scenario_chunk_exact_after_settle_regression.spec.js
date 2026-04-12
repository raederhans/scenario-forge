const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(120_000);

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
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });
  const currentScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });
  if (currentScenarioId !== scenarioId) {
    await page.selectOption("#scenarioSelect", scenarioId);
    const applyButton = page.locator("#applyScenarioBtn");
    if (await applyButton.isVisible().catch(() => false)) {
      if (await applyButton.isEnabled().catch(() => false)) {
        await applyButton.click();
      }
    }
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

  await page.goto(getAppUrl(), { waitUntil: "domcontentloaded" });
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
