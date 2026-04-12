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
  /europe_topology\.json was preloaded using link preload but not used/i,
];

async function ensureScenario(page, scenarioId) {
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });

  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });

  if (initialScenarioId === scenarioId) {
    await page.waitForTimeout(1200);
    return;
  }

  await page.selectOption("#scenarioSelect", scenarioId);
  const applyButton = page.locator("#applyScenarioBtn");
  if (await applyButton.isVisible().catch(() => false)) {
    if (await applyButton.isEnabled().catch(() => false)) {
      await applyButton.click();
    }
  }
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "") === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId, { timeout: 120_000 });
  await page.waitForTimeout(1200);
}

async function ensureBaseCityDataLoaded(page, reason = "e2e-city-reveal-plan-regression") {
  await page.evaluate(async (loadReason) => {
    const { state } = await import("/js/core/state.js");
    if (typeof state.ensureBaseCityDataFn === "function") {
      await state.ensureBaseCityDataFn({ reason: loadReason, renderNow: true });
    }
  }, reason);
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return state.baseCityDataState === "loaded"
      && Array.isArray(state.worldCitiesData?.features)
      && state.worldCitiesData.features.length > 0;
  }, { timeout: 120_000 });
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import("/js/core/map_renderer.js");
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(700);
}

test("city reveal plan keeps capital coverage stable across low-zoom pan", async ({ page }) => {
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
  await ensureScenario(page, "tno_1962");
  await ensureBaseCityDataLoaded(page);
  await setZoomPercent(page, 140);

  const runtime = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { buildCityRevealPlan, getEffectiveCityCollection } = await import("/js/core/map_renderer.js");

    const makeTransform = (source, dx = 0, dy = 0) => ({
      x: Number(source?.x || 0) + dx,
      y: Number(source?.y || 0) + dy,
      k: Math.max(0.0001, Number(source?.k || 1)),
      apply([x, y]) {
        return [
          (Number(x) * this.k) + this.x,
          (Number(y) * this.k) + this.y,
        ];
      },
    });

    const summarizePlan = (plan) => {
      const candidateCapitalCountries = new Set(
        (Array.isArray(plan?.candidateEntries) ? plan.candidateEntries : [])
          .filter((entry) => entry.isCapital)
          .map((entry) => entry.countryKey)
      );
      const capitalMarkerCountries = new Set(
        (Array.isArray(plan?.markerEntries) ? plan.markerEntries : [])
          .filter((entry) => entry.isCapital)
          .map((entry) => entry.countryKey)
      );
      return {
        candidateCapitalCountries,
        capitalMarkerCountries,
        markerCount: Array.isArray(plan?.markerEntries) ? plan.markerEntries.length : 0,
        candidateCount: Array.isArray(plan?.candidateEntries) ? plan.candidateEntries.length : 0,
        markerBudget: Number(plan?.phase?.markerBudget || 0),
      };
    };

    const cityCollection = getEffectiveCityCollection();
    const config = state.styleConfig?.cityPoints || {};
    const baseTransform = makeTransform(state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 });
    const shiftedTransform = makeTransform(baseTransform, -160, 0);
    const basePlan = buildCityRevealPlan(cityCollection, baseTransform.k, baseTransform, config);
    const shiftedPlan = buildCityRevealPlan(cityCollection, shiftedTransform.k, shiftedTransform, config);
    const baseSummary = summarizePlan(basePlan);
    const shiftedSummary = summarizePlan(shiftedPlan);
    const commonCandidateCountries = Array.from(baseSummary.candidateCapitalCountries)
      .filter((countryKey) => shiftedSummary.candidateCapitalCountries.has(countryKey));

    return {
      base: {
        markerCount: baseSummary.markerCount,
        candidateCount: baseSummary.candidateCount,
        candidateCapitalCount: baseSummary.candidateCapitalCountries.size,
        markerBudget: baseSummary.markerBudget,
        missingCapitalCountries: commonCandidateCountries.filter((countryKey) => !baseSummary.capitalMarkerCountries.has(countryKey)),
      },
      shifted: {
        markerCount: shiftedSummary.markerCount,
        candidateCount: shiftedSummary.candidateCount,
        candidateCapitalCount: shiftedSummary.candidateCapitalCountries.size,
        markerBudget: shiftedSummary.markerBudget,
        missingCapitalCountries: commonCandidateCountries.filter((countryKey) => !shiftedSummary.capitalMarkerCountries.has(countryKey)),
      },
      commonCandidateCountries,
      zoomScale: Number(baseTransform.k || 0),
    };
  });

  expect(runtime.zoomScale).toBeGreaterThan(1.15);
  expect(runtime.zoomScale).toBeLessThan(1.45);
  expect(runtime.commonCandidateCountries.length).toBeGreaterThan(8);
  expect(runtime.base.candidateCapitalCount).toBeGreaterThan(runtime.base.markerBudget);
  expect(runtime.base.missingCapitalCountries).toEqual([]);
  expect(runtime.shifted.missingCapitalCountries).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

test("point density changes marker budgets while label density only changes labels", async ({ page }) => {
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
  await ensureScenario(page, "tno_1962");
  await ensureBaseCityDataLoaded(page, "e2e-city-marker-density-regression");
  await setZoomPercent(page, 320);

  const runtime = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const { buildCityRevealPlan, getEffectiveCityCollection } = await import("/js/core/map_renderer.js");

    const cityCollection = getEffectiveCityCollection();
    const baseConfig = { ...(state.styleConfig?.cityPoints || {}) };
    const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const scale = Math.max(0.0001, Number(transform?.k || 1));

    const summarizePlan = (config) => {
      const plan = buildCityRevealPlan(cityCollection, scale, transform, config);
      const candidateCapitalCountries = new Set(
        (Array.isArray(plan?.candidateEntries) ? plan.candidateEntries : [])
          .filter((entry) => entry.isCapital)
          .map((entry) => entry.countryKey)
      );
      const acceptedCapitalCountries = new Set(
        (Array.isArray(plan?.markerEntries) ? plan.markerEntries : [])
          .filter((entry) => entry.isCapital)
          .map((entry) => entry.countryKey)
      );
      return {
        markerBudget: Number(plan?.phase?.markerBudget || 0),
        markerCount: Array.isArray(plan?.markerEntries) ? plan.markerEntries.length : 0,
        labelCount: Array.isArray(plan?.labelEntries) ? plan.labelEntries.length : 0,
        candidateCapitalCount: candidateCapitalCountries.size,
        acceptedCapitalCount: acceptedCapitalCountries.size,
      };
    };

    return {
      lowPointDensity: summarizePlan({ ...baseConfig, markerDensity: 0.5, labelDensity: "balanced" }),
      highPointDensity: summarizePlan({ ...baseConfig, markerDensity: 1.35, labelDensity: "balanced" }),
      sparseLabels: summarizePlan({ ...baseConfig, markerDensity: 1, labelDensity: "sparse" }),
      denseLabels: summarizePlan({ ...baseConfig, markerDensity: 1, labelDensity: "dense" }),
    };
  });

  expect(runtime.lowPointDensity.markerCount).toBeLessThanOrEqual(runtime.highPointDensity.markerCount);
  expect(runtime.lowPointDensity.acceptedCapitalCount).toBe(runtime.lowPointDensity.candidateCapitalCount);
  expect(runtime.highPointDensity.acceptedCapitalCount).toBe(runtime.highPointDensity.candidateCapitalCount);
  expect(runtime.sparseLabels.markerCount).toBe(runtime.denseLabels.markerCount);
  expect(runtime.sparseLabels.labelCount).toBeLessThan(runtime.denseLabels.labelCount);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});
