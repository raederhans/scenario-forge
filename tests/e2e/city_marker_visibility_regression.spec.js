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

function countChangedPixels(left, right, threshold = 14) {
  const limit = Math.min(left.length, right.length);
  let changed = 0;
  for (let index = 0; index < limit; index += 4) {
    const delta = Math.abs(left[index] - right[index])
      + Math.abs(left[index + 1] - right[index + 1])
      + Math.abs(left[index + 2] - right[index + 2])
      + Math.abs(left[index + 3] - right[index + 3]);
    if (delta >= threshold) {
      changed += 1;
    }
  }
  return changed;
}

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

async function waitForStableExactRender(page, { timeout = 20_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.renderPhase || "") === "idle"
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

async function setCheckbox(page, id, checked) {
  await page.evaluate(({ targetId, targetChecked }) => {
    const input = document.getElementById(targetId);
    if (!input) {
      throw new Error(`Missing checkbox: ${targetId}`);
    }
    input.checked = !!targetChecked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { targetId: id, targetChecked: checked });
}

async function captureCapitalPatch(page, cityId) {
  return page.evaluate(async (targetCityId) => {
    const { state } = await import("/js/core/state.js");
    const { buildCityRevealPlan, getEffectiveCityCollection } = await import("/js/core/map_renderer.js");

    const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const plan = buildCityRevealPlan(getEffectiveCityCollection(), Number(transform.k || 1), transform, state.styleConfig?.cityPoints || {});
    const entry = (Array.isArray(plan?.labelEntries) ? plan.labelEntries : []).find((candidate) => String(candidate?.cityId || "") === String(targetCityId || ""))
      || (Array.isArray(plan?.markerEntries) ? plan.markerEntries : []).find((candidate) => String(candidate?.cityId || "") === String(targetCityId || ""));
    if (!entry || !Array.isArray(entry.screenPoint)) {
      throw new Error(`Missing visible capital entry: ${targetCityId}`);
    }

    const candidates = Array.from(document.querySelectorAll("canvas"))
      .filter((canvas) => canvas.width >= 200 && canvas.height >= 120 && getComputedStyle(canvas).display !== "none")
      .sort((left, right) => (right.width * right.height) - (left.width * left.height));
    const source = candidates[0];
    if (!source) {
      throw new Error("No visible map canvas found");
    }

    const dpr = Math.max(1, Number(globalThis.devicePixelRatio || 1));
    const patchWidthCss = 180;
    const patchHeightCss = 120;
    const patchWidth = Math.max(40, Math.round(patchWidthCss * dpr));
    const patchHeight = Math.max(40, Math.round(patchHeightCss * dpr));
    const centerX = Math.round((Number(entry.screenPoint[0] || 0) + 28) * dpr);
    const centerY = Math.round((Number(entry.screenPoint[1] || 0) - 28) * dpr);
    const minX = Math.max(0, Math.min(source.width - patchWidth, centerX - Math.round(patchWidth / 2)));
    const minY = Math.max(0, Math.min(source.height - patchHeight, centerY - Math.round(patchHeight / 2)));

    const patch = document.createElement("canvas");
    patch.width = patchWidth;
    patch.height = patchHeight;
    const ctx = patch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, minX, minY, patchWidth, patchHeight, 0, 0, patchWidth, patchHeight);
    const image = ctx.getImageData(0, 0, patchWidth, patchHeight);
    return {
      cityId: String(entry.cityId || ""),
      width: patchWidth,
      height: patchHeight,
      pixels: Array.from(image.data),
      markerSizePx: Number(entry.markerSizePx || 0),
    };
  }, cityId);
}

test("city reveal plan keeps capital coverage across synthetic pans and overlay toggle visibly changes capital treatment", async ({ page }) => {
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
          markerDensity: 1,
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
  await waitForStableExactRender(page);

  const runtimeCheck = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      buildCityRevealPlan,
      getCityMarkerRenderStyle,
      getEffectiveCityCollection,
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
      const candidateProtectedCapitalCountries = new Set(
        (plan.candidateEntries || [])
          .filter((entry) => entry.isCapital && (entry.isDefaultCountry || entry.isPrimaryPower))
          .map((entry) => entry.countryKey)
      );
      const acceptedCapitalCountries = new Set(
        (plan.markerEntries || []).filter((entry) => entry.isCapital).map((entry) => entry.countryKey)
      );
      const acceptedProtectedCapitalCountries = new Set(
        (plan.markerEntries || [])
          .filter((entry) => entry.isCapital && (entry.isDefaultCountry || entry.isPrimaryPower))
          .map((entry) => entry.countryKey)
      );
      const missingProtectedCapitalCountries = Array.from(candidateProtectedCapitalCountries)
        .filter((countryKey) => !acceptedProtectedCapitalCountries.has(countryKey))
        .slice(0, 20);
      return {
        name: transform.name,
        markerBudget: Number(plan.markerBudget || 0),
        priorityReserveBudget: Number(plan.priorityReserveBudget || 0),
        markerCount: Array.isArray(plan.markerEntries) ? plan.markerEntries.length : 0,
        candidateCapitalCountryCount: candidateCapitalCountries.size,
        acceptedCapitalCountryCount: acceptedCapitalCountries.size,
        candidateProtectedCapitalCountryCount: candidateProtectedCapitalCountries.size,
        acceptedProtectedCapitalCountryCount: acceptedProtectedCapitalCountries.size,
        missingProtectedCapitalCountries,
        excludedScenarioTags: Array.from(new Set(
          (plan.candidateEntries || [])
            .map((entry) => String(entry?.scenarioTag || ""))
            .filter((tag) => tag === "AFA" || tag === "RFA")
        )),
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

    const visiblePlan = buildCityRevealPlan(
      cityCollection,
      Number(state.zoomTransform?.k || 1),
      state.zoomTransform || identity,
      config,
    );
    const visibleCapital = (Array.isArray(visiblePlan?.labelEntries) ? visiblePlan.labelEntries : [])
      .find((entry) => entry.isCapital)
      || (Array.isArray(visiblePlan?.markerEntries) ? visiblePlan.markerEntries : []).find((entry) => entry.isCapital);

    return {
      planSummaries: transforms.map(summarizePlan),
      darkSamples,
      visibleCapitalCityId: String(visibleCapital?.cityId || ""),
    };
  });

  runtimeCheck.planSummaries.forEach((summary) => {
    expect(summary.candidateCapitalCountryCount).toBeGreaterThan(0);
    expect(summary.candidateProtectedCapitalCountryCount).toBeGreaterThan(0);
    expect(summary.markerCount).toBeLessThanOrEqual(summary.markerBudget);
    expect(summary.priorityReserveBudget).toBeLessThanOrEqual(summary.markerBudget);
    expect(summary.missingProtectedCapitalCountries).toEqual([]);
    expect(summary.markerCount).toBeGreaterThanOrEqual(summary.acceptedProtectedCapitalCountryCount);
    expect(summary.excludedScenarioTags).toEqual([]);
  });
  expect(
    runtimeCheck.planSummaries.some(
      (summary) => summary.candidateCapitalCountryCount > summary.acceptedCapitalCountryCount
    )
  ).toBe(true);

  expect(runtimeCheck.darkSamples.length).toBeGreaterThan(0);
  runtimeCheck.darkSamples.forEach((sample) => {
    expect(sample.fillBottom).toBeTruthy();
    expect(sample.stroke).toBeTruthy();
  });
  expect(runtimeCheck.visibleCapitalCityId).toBeTruthy();

  const capitalOverlayOn = await captureCapitalPatch(page, runtimeCheck.visibleCapitalCityId);
  await setCheckbox(page, "cityCapitalOverlayEnabled", false);
  await waitForStableExactRender(page);
  const capitalOverlayOff = await captureCapitalPatch(page, runtimeCheck.visibleCapitalCityId);
  const overlayDiff = countChangedPixels(capitalOverlayOn.pixels, capitalOverlayOff.pixels, 12);

  const overlayState = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return {
      showCapitalOverlay: !!state.styleConfig?.cityPoints?.showCapitalOverlay,
    };
  });

  expect(overlayState.showCapitalOverlay).toBe(false);
  expect(capitalOverlayOn.markerSizePx).toBeGreaterThan(0);
  expect(overlayDiff).toBeGreaterThan(80);

  const shotPath = path.join(".runtime", "browser", "mcp-artifacts", "screenshots", "qa_020_city_marker_visibility_regression.png");
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);
});
