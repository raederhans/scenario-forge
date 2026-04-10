const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(120_000);

const APP_URL = getAppUrl();
const VIEW_SETTINGS_STORAGE_KEY = "map_view_settings_v1";
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

async function dismissStartupBlocker(page) {
  const continueButton = page.getByRole("button", { name: "Continue without scenario" });
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click();
    await page.waitForTimeout(1000);
  }
}

async function ensureScenario(page, scenarioId) {
  await page.waitForFunction((expectedScenarioId) => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector(`option[value="${expectedScenarioId}"]`);
  }, scenarioId, { timeout: 120_000 });

  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });

  if (initialScenarioId !== scenarioId) {
    await page.evaluate(async (expectedScenarioId) => {
      const { applyScenarioById } = await import("/js/core/scenario_manager.js");
      await applyScenarioById(expectedScenarioId, {
        renderNow: true,
        markDirtyReason: "city-marker-visibility-regression",
        showToastOnComplete: false,
      });
    }, scenarioId);
  }

  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import("/js/core/state.js");
    return state.activeScenarioId === expectedScenarioId && !state.scenarioApplyInFlight;
  }, scenarioId, { timeout: 120_000 });
  await page.waitForTimeout(1200);
}

async function ensureBaseCityDataLoaded(page, reason = "city-marker-visibility-regression") {
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
  await page.waitForTimeout(800);
}

test("city reveal plan keeps capital coverage across synthetic pans and dark-host markers adapt", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error") {
      return;
    }
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

  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 1,
      cityPoints: {
        show: true,
        style: {
          theme: "classic_graphite",
          radius: 6.8,
          markerScale: 1.12,
          labelDensity: "balanced",
          color: "#2f343a",
          capitalColor: "#9f9072",
          opacity: 0.94,
          showLabels: true,
          labelSize: 11,
          showCapitalOverlay: true,
        },
      },
    }));
  }, VIEW_SETTINGS_STORAGE_KEY);

  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await dismissStartupBlocker(page);
  await waitForAppInteractive(page);
  await ensureScenario(page, "tno_1962");
  await ensureBaseCityDataLoaded(page);
  await setZoomPercent(page, 160);

  const runtimeCheck = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      buildCityRevealPlan,
      getEffectiveCityCollection,
      getCityMarkerRenderStyle,
    } = await import("/js/core/map_renderer.js");

    const cityCollection = getEffectiveCityCollection();
    const config = state.styleConfig?.cityPoints || {};
    const identity = globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const transforms = [
      { name: "phase-p1-base", x: Number(identity.x || 0), y: Number(identity.y || 0), k: 1.2 },
      { name: "phase-p1-pan-west", x: Number(identity.x || 0) - 220, y: Number(identity.y || 0), k: 1.2 },
      { name: "phase-p2-base", x: Number(identity.x || 0), y: Number(identity.y || 0), k: 1.55 },
    ];

    const summarizePlan = (transform) => {
      const plan = buildCityRevealPlan(cityCollection, Number(transform.k || 1), transform, config);
      const candidateCapitalCountries = new Set(
        (plan.candidateEntries || []).filter((entry) => entry.isCapital).map((entry) => entry.countryKey)
      );
      const acceptedCapitalCountries = new Set(
        (plan.markerEntries || []).filter((entry) => entry.isCapital).map((entry) => entry.countryKey)
      );
      const missingCapitalCountries = Array.from(candidateCapitalCountries)
        .filter((countryKey) => !acceptedCapitalCountries.has(countryKey))
        .slice(0, 20);
      return {
        name: transform.name,
        markerBudget: Number(plan.phase?.markerBudget || 0),
        markerCount: Array.isArray(plan.markerEntries) ? plan.markerEntries.length : 0,
        candidateCapitalCountryCount: candidateCapitalCountries.size,
        acceptedCapitalCountryCount: acceptedCapitalCountries.size,
        missingCapitalCountries,
      };
    };

    const darkSamples = (Array.isArray(cityCollection?.features) ? cityCollection.features : [])
      .map((feature) => {
        const style = getCityMarkerRenderStyle({ feature }, config);
        return {
          cityId: String(feature?.properties?.id || feature?.id || ""),
          usesLightContrast: !!style.usesLightContrast,
          backgroundColor: String(style.backgroundColor || ""),
          fillBottom: String(style.tokens?.fillBottom || ""),
          stroke: String(style.tokens?.stroke || ""),
          configColor: String(config.color || ""),
        };
      })
      .filter((entry) => entry.usesLightContrast && entry.backgroundColor)
      .slice(0, 12);

    return {
      planSummaries: transforms.map(summarizePlan),
      darkSamples,
    };
  });

  runtimeCheck.planSummaries.forEach((summary) => {
    expect(summary.candidateCapitalCountryCount).toBeGreaterThan(0);
    expect(summary.missingCapitalCountries).toEqual([]);
    expect(summary.acceptedCapitalCountryCount).toBe(summary.candidateCapitalCountryCount);
    expect(summary.markerCount).toBeGreaterThanOrEqual(summary.acceptedCapitalCountryCount);
  });
  expect(
    runtimeCheck.planSummaries.some(
      (summary) => summary.candidateCapitalCountryCount > summary.markerBudget
    )
  ).toBe(true);

  expect(runtimeCheck.darkSamples.length).toBeGreaterThan(0);
  runtimeCheck.darkSamples.forEach((sample) => {
    expect(sample.fillBottom).not.toBe("");
    expect(sample.stroke).not.toBe("");
    expect(sample.fillBottom.toLowerCase()).not.toBe(sample.configColor.toLowerCase());
  });

  const shotPath = path.join(".runtime", "browser", "mcp-artifacts", "screenshots", "qa_020_city_marker_visibility_regression.png");
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});
