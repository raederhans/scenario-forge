const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);
const APP_URL = getAppUrl();
const VIEW_SETTINGS_STORAGE_KEY = "map_view_settings_v1";
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

async function activateAppearanceTab(page, tabId, panelId) {
  await page.evaluate(({ targetTabId }) => {
    const button = document.getElementById(targetTabId);
    if (!button) {
      throw new Error(`Missing appearance tab: ${targetTabId}`);
    }
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }, { targetTabId: tabId });
  await expect(page.locator(`#${panelId}`)).toHaveClass(/is-active/);
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

async function setSelectValue(page, id, value) {
  await page.evaluate(({ targetId, targetValue }) => {
    const select = document.getElementById(targetId);
    if (!select) {
      throw new Error(`Missing select: ${targetId}`);
    }
    select.value = String(targetValue);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, { targetId: id, targetValue: value });
}

async function readFirstExistingControl(page, candidateIds = []) {
  return page.evaluate((ids) => {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) {
        return {
          id,
          tagName: element.tagName.toLowerCase(),
          value: String(element.value ?? ""),
          optionCount: element.tagName === "SELECT" ? element.options.length : null,
        };
      }
    }
    return null;
  }, candidateIds);
}

async function setFirstExistingControlValue(page, candidateIds = [], value) {
  const control = await readFirstExistingControl(page, candidateIds);
  if (!control?.id) {
    throw new Error(`Missing control. Candidates: ${candidateIds.join(", ")}`);
  }
  await page.evaluate(({ targetId, targetValue }) => {
    const element = document.getElementById(targetId);
    if (!element) {
      throw new Error(`Missing control: ${targetId}`);
    }
    element.value = String(targetValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { targetId: control.id, targetValue: value });
  return control.id;
}

async function ensureBaseCityDataLoaded(page, reason = "e2e-city-points-runtime") {
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
  }, { timeout: 120000 });
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

async function waitForChunkPromotionMetric(page, { recordedAfter = 0, timeout = 30_000 } = {}) {
  await page.waitForFunction(async (startedAt) => {
    const { state } = await import("/js/core/state.js");
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const candidates = [
      metrics.scenarioChunkPromotionVisualStage,
      metrics.scenarioChunkPoliticalPromotion,
      metrics.chunkPromotionMs,
    ].filter((entry) => entry && typeof entry === "object");
    const latestRecordedAt = candidates.reduce((maxValue, entry) => {
      const recordedAt = Number(entry.recordedAt || 0);
      return Math.max(maxValue, recordedAt);
    }, 0);
    return latestRecordedAt > Number(startedAt || 0);
  }, recordedAfter, { timeout });
}

async function readUrbanContractSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    const {
      buildCityRevealPlan,
      getCityLabelRenderStyle,
      getCityMarkerRenderStyle,
      getEffectiveCityCollection,
    } = await import("/js/core/map_renderer.js");
    const cityStyle = state.styleConfig?.cityPoints || {};
    const worldCities = Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : [];
    const urbanFeatures = Array.isArray(state.urbanData?.features) ? state.urbanData.features : [];
    const effectiveCollection = getEffectiveCityCollection();
    const effectiveCities = Array.isArray(effectiveCollection?.features) ? effectiveCollection.features : [];
    const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const plan = buildCityRevealPlan(effectiveCollection, Number(transform.k || 1), transform, cityStyle);
    const sampleEntry = Array.isArray(plan?.markerEntries) ? plan.markerEntries.find(Boolean) : null;
    const sampleMarkerStyle = sampleEntry ? getCityMarkerRenderStyle(sampleEntry, cityStyle) : null;
    const contrastSamples = worldCities
      .map((feature) => {
        const props = feature?.properties || {};
        const style = getCityLabelRenderStyle({ feature }, cityStyle);
        return {
          id: String(props.id || props.__city_id || ""),
          usesLightLabel: !!style.usesLightLabel,
          backgroundColor: style.backgroundColor,
          luminance: style.luminance,
        };
      })
      .filter((entry) => entry.usesLightLabel)
      .slice(0, 12);
    const unmatchedCapitalCount = worldCities.filter((feature) => {
      const props = feature?.properties || {};
      return !!props.__city_is_country_capital && !String(
        props.__city_urban_match_id || props.urban_match_id || props.urban_area_id || ""
      ).trim();
    }).length;
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === "object"
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const promotionMetrics = [
      ["scenarioChunkPromotionVisualStage", metrics.scenarioChunkPromotionVisualStage],
      ["scenarioChunkPoliticalPromotion", metrics.scenarioChunkPoliticalPromotion],
      ["chunkPromotionMs", metrics.chunkPromotionMs],
    ].filter(([, entry]) => entry && typeof entry === "object");
    const latestPromotionMetric = promotionMetrics.sort((left, right) => (
      Number(right[1]?.recordedAt || 0) - Number(left[1]?.recordedAt || 0)
    ))[0] || [null, null];
    const themeControl = document.getElementById("cityPointsTheme");
    const pointDensityControl = document.getElementById("cityPointsPointDensity")
      || document.getElementById("cityPointsMarkerDensity");

    return {
      markerScale: Number(cityStyle.markerScale || 0),
      worldCityCount: worldCities.length,
      effectiveCityCount: effectiveCities.length,
      urbanFeatureCount: urbanFeatures.length,
      unmatchedCapitalCount,
      activeScenarioId: String(state.activeScenarioId || ""),
      contrastSamples,
      urbanCapability: state.urbanLayerCapability || null,
      urbanStoredMode: String(state.styleConfig?.urban?.mode || ""),
      urbanModeSelectValue: String(document.getElementById("urbanMode")?.value || ""),
      urbanAdaptiveStatusText: String(document.getElementById("urbanAdaptiveStatus")?.textContent || "").trim(),
      urbanAdaptiveOptionDisabled: !!document.querySelector('#urbanMode option[value="adaptive"]')?.disabled,
      contextLayerSourceUrban: String(state.contextLayerSourceByName?.urban || ""),
      urbanDiagnosticSource: String(state.layerDataDiagnostics?.urban?.source || ""),
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
      cityLightsStyle: String(state.styleConfig?.dayNight?.cityLightsStyle || ""),
      chunkPromotionMetricName: String(latestPromotionMetric[0] || ""),
      chunkPromotionRecordedAt: Number(latestPromotionMetric[1]?.recordedAt || 0),
      loadedChunkCount: Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
        ? state.activeScenarioChunks.loadedChunkIds.length
        : 0,
      theme: String(cityStyle.theme || ""),
      labelDensity: String(cityStyle.labelDensity || ""),
      markerDensity: Number(cityStyle.markerDensity || 0),
      showCapitalOverlay: !!cityStyle.showCapitalOverlay,
      sampleMarkerTokens: sampleMarkerStyle?.tokens
        ? {
          stroke: String(sampleMarkerStyle.tokens.stroke || ""),
          highlight: String(sampleMarkerStyle.tokens.highlight || ""),
          halo: String(sampleMarkerStyle.tokens.halo || ""),
          capitalAccent: String(sampleMarkerStyle.tokens.capitalAccent || ""),
        }
        : null,
      themeControl: themeControl
        ? {
          tagName: themeControl.tagName.toLowerCase(),
          value: String(themeControl.value || ""),
          optionCount: themeControl.options.length,
        }
        : null,
      pointDensityControl: pointDensityControl
        ? {
          id: pointDensityControl.id,
          tagName: pointDensityControl.tagName.toLowerCase(),
          value: String(pointDensityControl.value || ""),
        }
        : null,
    };
  });
}

test("city points runtime bridge exposes preset + point-density controls and syncs them into runtime state", async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error") {
      const text = msg.text();
      if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
        return;
      }
      consoleIssues.push({ type, text });
    }
  });

  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) {
      networkFailures.push({ url: res.url(), status });
    }
  });

  page.on("requestfailed", (req) => {
    networkFailures.push({
      url: req.url(),
      status: "failed",
      errorText: req.failure() ? req.failure().errorText : "requestfailed",
    });
  });

  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 1,
      cityPoints: {
        show: true,
        style: {
          theme: "atlas_ink",
          radius: 6.8,
          markerScale: 1.14,
          markerDensity: 0.72,
          labelDensity: "dense",
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
  await waitForAppInteractive(page);

  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    return !!select && !!select.querySelector('option[value="tno_1962"]');
  });

  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import("/js/core/state.js");
    return String(state.activeScenarioId || "");
  });
  if (initialScenarioId !== "tno_1962") {
    await page.selectOption("#scenarioSelect", "tno_1962");
    const applyButton = page.locator("#applyScenarioBtn");
    const applyVisible = await applyButton.isVisible();
    const applyEnabled = applyVisible ? await applyButton.isEnabled() : false;
    if (applyVisible && applyEnabled) {
      await page.click("#applyScenarioBtn");
    }
    await expect(page.locator("#scenarioStatus")).toContainText("TNO 1962", { timeout: 20000 });
    await page.waitForTimeout(1200);
  }

  await activateAppearanceTab(page, "appearanceTabLayers", "appearancePanelLayers");
  await expect(page.locator("#cityPointsMarkerScale")).toHaveValue("1.15");
  await expect(page.locator("#cityPointsThemeStatic")).toHaveCount(0);
  await expect(page.locator("#cityPointsRadius")).toHaveCount(0);
  await expect(page.locator("#cityPointsTheme")).toHaveCount(1);

  const themeControl = await readFirstExistingControl(page, ["cityPointsTheme"]);
  expect(themeControl?.tagName).toBe("select");
  expect(Number(themeControl?.optionCount || 0)).toBeGreaterThan(1);
  expect(themeControl?.value).toBe("atlas_ink");

  const pointDensityControl = await readFirstExistingControl(page, ["cityPointsPointDensity", "cityPointsMarkerDensity"]);
  expect(pointDensityControl?.tagName).toBeTruthy();
  expect(pointDensityControl?.value).toBeTruthy();
  await expect(page.locator("#cityPointsRadius")).toHaveCount(0);

  await activateAppearanceTab(page, "appearanceTabDayNight", "appearancePanelDayNight");
  if (!(await page.locator("#dayNightEnabled").isChecked())) {
    await setCheckbox(page, "dayNightEnabled", true);
  }
  if (!(await page.locator("#dayNightCityLightsEnabled").isChecked())) {
    await setCheckbox(page, "dayNightCityLightsEnabled", true);
  }
  await setSelectValue(page, "dayNightCityLightsStyle", "modern");
  await page.waitForTimeout(600);
  await ensureBaseCityDataLoaded(page);
  await waitForStableExactRender(page);

  const runtimeSnapshot = await readUrbanContractSnapshot(page);

  expect(runtimeSnapshot.worldCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.effectiveCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanFeatureCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.unmatchedCapitalCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.activeScenarioId).toBe("tno_1962");
  expect(runtimeSnapshot.contrastSamples.length).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanCapability?.adaptiveAvailable).toBe(true);
  expect(runtimeSnapshot.urbanCapability?.missingOwnerCount).toBe(0);
  expect(runtimeSnapshot.urbanStoredMode).toBe("adaptive");
  expect(runtimeSnapshot.urbanModeSelectValue).toBe("adaptive");
  expect(runtimeSnapshot.urbanAdaptiveOptionDisabled).toBe(false);
  expect(runtimeSnapshot.urbanAdaptiveStatusText).toBe("");
  expect(runtimeSnapshot.contextLayerSourceUrban).toBe("external");
  expect(runtimeSnapshot.urbanDiagnosticSource).toBe("external");
  expect(runtimeSnapshot.dayNightEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsStyle).toBe("modern");
  expect(runtimeSnapshot.theme).toBe("atlas_ink");
  expect(runtimeSnapshot.markerScale).toBeCloseTo(1.14, 2);
  expect(runtimeSnapshot.labelDensity).toBe("dense");
  expect(runtimeSnapshot.markerDensity).toBeCloseTo(0.72, 2);
  expect(runtimeSnapshot.showCapitalOverlay).toBe(true);
  expect(runtimeSnapshot.themeControl?.optionCount).toBeGreaterThan(1);
  expect(runtimeSnapshot.pointDensityControl?.id).toBeTruthy();
  expect(runtimeSnapshot.sampleMarkerTokens?.stroke).toBeTruthy();

  const preZoomChunkPromotionRecordedAt = runtimeSnapshot.chunkPromotionRecordedAt;
  await setZoomPercent(page, 120);
  await waitForStableExactRender(page);
  await waitForChunkPromotionMetric(page, {
    recordedAfter: preZoomChunkPromotionRecordedAt,
    timeout: 30_000,
  });

  const postInteractionSnapshot = await readUrbanContractSnapshot(page);
  expect(postInteractionSnapshot.chunkPromotionMetricName).toBeTruthy();
  expect(postInteractionSnapshot.chunkPromotionRecordedAt).toBeGreaterThanOrEqual(preZoomChunkPromotionRecordedAt);
  expect(postInteractionSnapshot.loadedChunkCount).toBeGreaterThan(0);
  expect(postInteractionSnapshot.contextLayerSourceUrban).toBe("external");
  expect(postInteractionSnapshot.urbanDiagnosticSource).toBe("external");
  expect(postInteractionSnapshot.urbanCapability?.adaptiveAvailable).toBe(true);
  expect(postInteractionSnapshot.urbanCapability?.missingOwnerCount).toBe(0);
  expect(postInteractionSnapshot.urbanStoredMode).toBe("adaptive");
  expect(postInteractionSnapshot.urbanModeSelectValue).toBe("adaptive");
  expect(postInteractionSnapshot.urbanAdaptiveOptionDisabled).toBe(false);
  expect(postInteractionSnapshot.urbanAdaptiveStatusText).toBe("");

  const originalTokens = runtimeSnapshot.sampleMarkerTokens;
  await activateAppearanceTab(page, "appearanceTabLayers", "appearancePanelLayers");
  await setSelectValue(page, "cityPointsTheme", "classic_graphite");
  const pointDensityControlId = await setFirstExistingControlValue(page, ["cityPointsPointDensity", "cityPointsMarkerDensity"], 0.55);
  await waitForStableExactRender(page);
  const updatedSnapshot = await readUrbanContractSnapshot(page);
  expect(updatedSnapshot.theme).toBe("classic_graphite");
  expect(updatedSnapshot.markerDensity).toBeCloseTo(0.55, 2);
  expect(updatedSnapshot.themeControl?.value).toBe("classic_graphite");
  expect(updatedSnapshot.pointDensityControl?.id).toBe(pointDensityControlId);
  expect(updatedSnapshot.sampleMarkerTokens).not.toEqual(originalTokens);

  const shotPath = path.join(".runtime", "browser", "mcp-artifacts", "screenshots", "qa_019_city_points_urban_runtime.png");
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  console.log(JSON.stringify({
    runtimeSnapshot,
    postInteractionSnapshot,
    updatedSnapshot,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
