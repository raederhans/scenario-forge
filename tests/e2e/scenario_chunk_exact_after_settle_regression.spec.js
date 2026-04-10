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

test("exact-after-settle issues a second flush for pending scenario chunk refresh without a second interaction", async ({ page }) => {
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
    const runtimeState = state.runtimeChunkLoadState && typeof state.runtimeChunkLoadState === "object"
      ? state.runtimeChunkLoadState
      : {};
    const originalScheduleScenarioChunkRefreshFn = state.scheduleScenarioChunkRefreshFn;
    const probeCalls = [];
    state.__scenarioChunkRefreshProbeCalls = probeCalls;
    if (typeof originalScheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn = (options = {}) => {
        probeCalls.push({
          reason: String(options?.reason || ""),
          flushPending: !!options?.flushPending,
          delayMs: Number.isFinite(Number(options?.delayMs)) ? Number(options.delayMs) : null,
          renderPhase: String(state.renderPhase || ""),
          deferExactAfterSettle: !!state.deferExactAfterSettle,
          exactAfterSettleHandle: !!state.exactAfterSettleHandle,
        });
        return originalScheduleScenarioChunkRefreshFn(options);
      };
    }
    state.runtimeChunkLoadState = {
      ...runtimeState,
      pendingReason: "test-exact-after-settle",
      pendingDelayMs: 0,
      pendingPromotion: null,
    };
    return {
      activeScenarioId: String(state.activeScenarioId || ""),
      hasScheduleScenarioChunkRefreshFn: typeof state.scheduleScenarioChunkRefreshFn === "function",
    };
  });

  expect(seededState.activeScenarioId).toBe("tno_1962");
  expect(seededState.hasScheduleScenarioChunkRefreshFn).toBe(true);

  await setZoomPercent(page, 120);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return !!state.deferExactAfterSettle || !!state.exactAfterSettleHandle;
  }, { timeout: 20_000 });
  await waitForStableExactRender(page, { timeout: 30_000 });

  const finalState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const probeCalls = Array.isArray(state.__scenarioChunkRefreshProbeCalls)
      ? state.__scenarioChunkRefreshProbeCalls.map((entry) => ({ ...entry }))
      : [];
    return {
      renderPhase: String(state.renderPhase || ""),
      deferExactAfterSettle: !!state.deferExactAfterSettle,
      hasExactAfterSettleHandle: !!state.exactAfterSettleHandle,
      pendingReason: String(state.runtimeChunkLoadState?.pendingReason || ""),
      refreshScheduled: !!state.runtimeChunkLoadState?.refreshScheduled,
      probeCalls,
    };
  });

  const deferredFlushCall = finalState.probeCalls.find((entry) => (
    entry.flushPending
    && entry.deferExactAfterSettle
  ));
  const postExactFlushCall = finalState.probeCalls.find((entry) => (
    entry.reason === "exact-after-settle"
    && entry.flushPending
    && !entry.deferExactAfterSettle
    && entry.renderPhase === "idle"
  ));

  expect(finalState.renderPhase).toBe("idle");
  expect(finalState.deferExactAfterSettle).toBe(false);
  expect(finalState.hasExactAfterSettleHandle).toBe(false);
  expect(deferredFlushCall).toBeTruthy();
  expect(postExactFlushCall).toBeTruthy();
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});
