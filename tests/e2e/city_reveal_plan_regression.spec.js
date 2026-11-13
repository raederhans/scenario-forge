const { test, expect, prepareSharedCityRuntimeState } = require("./support/fixtures");
const { getConsoleIgnorePatterns } = require("./support/expectations/console-allowlist");

test.setTimeout(120_000);

const IGNORED_CONSOLE_PATTERNS = getConsoleIgnorePatterns(__filename);

const ALLOWED_DEFERRED_SCENARIO_HYDRATION_WARNING_PATTERNS = [
  /\[boot\] Failed to hydrate active scenario bundle\. reason=post-ready-idle/i,
  /\[boot\] Deferred full scenario hydration failed during idle scheduling\./i,
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

async function waitForStableExactRender(page, { timeout = 20_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

function isAllowedCityRevealLaneWarning(text = "") {
  return ALLOWED_DEFERRED_SCENARIO_HYDRATION_WARNING_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldIgnoreConsoleIssue(text = "") {
  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))
    || isAllowedCityRevealLaneWarning(text);
}

async function prepareCityRevealState(page, {
  reason,
  zoomPercent,
} = {}) {
  await prepareSharedCityRuntimeState(page, {
    scenarioId: "tno_1962",
    scenarioApplyReason: "city-reveal-plan-regression",
    loadBaseCityDataReason: reason,
    zoomPercent,
    timeout: 120_000,
  });
}

test("city reveal plan keeps capital coverage stable across low-zoom pan", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "warning" && type !== "error") return;
    const text = msg.text();
    if (shouldIgnoreConsoleIssue(text)) {
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

  await prepareCityRevealState(page, {
    reason: "e2e-city-reveal-plan-regression",
    zoomPercent: 140,
  });

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
      const candidateProtectedCapitalCountries = new Set(
        (Array.isArray(plan?.candidateEntries) ? plan.candidateEntries : [])
          .filter((entry) => entry.isCapital && (entry.isDefaultCountry || entry.isPrimaryPower))
          .map((entry) => entry.countryKey)
      );
      const capitalMarkerCountries = new Set(
        (Array.isArray(plan?.markerEntries) ? plan.markerEntries : [])
          .filter((entry) => entry.isCapital)
          .map((entry) => entry.countryKey)
      );
      const protectedCapitalMarkerCountries = new Set(
        (Array.isArray(plan?.markerEntries) ? plan.markerEntries : [])
          .filter((entry) => entry.isCapital && (entry.isDefaultCountry || entry.isPrimaryPower))
          .map((entry) => entry.countryKey)
      );
      return {
        candidateCapitalCountries,
        candidateProtectedCapitalCountries,
        capitalMarkerCountries,
        protectedCapitalMarkerCountries,
        markerCount: Array.isArray(plan?.markerEntries) ? plan.markerEntries.length : 0,
        candidateCount: Array.isArray(plan?.candidateEntries) ? plan.candidateEntries.length : 0,
        markerBudget: Number(plan?.markerBudget || 0),
        priorityReserveBudget: Number(plan?.priorityReserveBudget || 0),
        excludedScenarioTags: Array.from(new Set(
          (Array.isArray(plan?.candidateEntries) ? plan.candidateEntries : [])
            .map((entry) => String(entry?.scenarioTag || ""))
            .filter((tag) => tag === "AFA" || tag === "RFA")
        )),
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
        candidateProtectedCapitalCount: baseSummary.candidateProtectedCapitalCountries.size,
        markerBudget: baseSummary.markerBudget,
        priorityReserveBudget: baseSummary.priorityReserveBudget,
        missingCapitalCountries: commonCandidateCountries.filter((countryKey) => !baseSummary.capitalMarkerCountries.has(countryKey)),
        missingProtectedCapitalCountries: Array.from(baseSummary.candidateProtectedCapitalCountries)
          .filter((countryKey) => !baseSummary.protectedCapitalMarkerCountries.has(countryKey)),
        excludedScenarioTags: baseSummary.excludedScenarioTags,
      },
      shifted: {
        markerCount: shiftedSummary.markerCount,
        candidateCount: shiftedSummary.candidateCount,
        candidateCapitalCount: shiftedSummary.candidateCapitalCountries.size,
        candidateProtectedCapitalCount: shiftedSummary.candidateProtectedCapitalCountries.size,
        markerBudget: shiftedSummary.markerBudget,
        priorityReserveBudget: shiftedSummary.priorityReserveBudget,
        missingCapitalCountries: commonCandidateCountries.filter((countryKey) => !shiftedSummary.capitalMarkerCountries.has(countryKey)),
        missingProtectedCapitalCountries: Array.from(shiftedSummary.candidateProtectedCapitalCountries)
          .filter((countryKey) => !shiftedSummary.protectedCapitalMarkerCountries.has(countryKey)),
        excludedScenarioTags: shiftedSummary.excludedScenarioTags,
      },
      commonCandidateCountries,
      zoomScale: Number(baseTransform.k || 0),
    };
  });

  expect(runtime.zoomScale).toBeGreaterThan(1.15);
  expect(runtime.zoomScale).toBeLessThan(1.45);
  expect(runtime.commonCandidateCountries.length).toBeGreaterThan(8);
  expect(runtime.base.candidateCapitalCount).toBeGreaterThan(runtime.base.markerBudget);
  expect(runtime.base.candidateProtectedCapitalCount).toBeGreaterThan(1);
  expect(runtime.base.markerCount).toBeLessThanOrEqual(runtime.base.markerBudget);
  expect(runtime.shifted.markerCount).toBeLessThanOrEqual(runtime.shifted.markerBudget);
  expect(runtime.base.priorityReserveBudget).toBeLessThanOrEqual(runtime.base.markerBudget);
  expect(runtime.shifted.priorityReserveBudget).toBeLessThanOrEqual(runtime.shifted.markerBudget);
  expect(runtime.base.missingProtectedCapitalCountries).toEqual([]);
  expect(runtime.shifted.missingProtectedCapitalCountries).toEqual([]);
  expect(runtime.base.excludedScenarioTags).toEqual([]);
  expect(runtime.shifted.excludedScenarioTags).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});

