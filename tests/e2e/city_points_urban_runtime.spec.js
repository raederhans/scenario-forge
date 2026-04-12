const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);
const APP_URL = getAppUrl();
const VIEW_SETTINGS_STORAGE_KEY = 'map_view_settings_v1';
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

async function activateAppearanceTab(page, tabId, panelId) {
  await page.evaluate(({ targetTabId }) => {
    const button = document.getElementById(targetTabId);
    if (!button) {
      throw new Error(`Missing appearance tab: ${targetTabId}`);
    }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
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
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { targetId: id, targetChecked: checked });
}

async function setSelectValue(page, id, value) {
  await page.evaluate(({ targetId, targetValue }) => {
    const select = document.getElementById(targetId);
    if (!select) {
      throw new Error(`Missing select: ${targetId}`);
    }
    select.value = String(targetValue);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { targetId: id, targetValue: value });
}

async function ensureBaseCityDataLoaded(page, reason = 'e2e-city-points-runtime') {
  await page.evaluate(async (loadReason) => {
    const { state } = await import('/js/core/state.js');
    if (typeof state.ensureBaseCityDataFn === 'function') {
      await state.ensureBaseCityDataFn({ reason: loadReason, renderNow: true });
    }
  }, reason);
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return state.baseCityDataState === 'loaded'
      && Array.isArray(state.worldCitiesData?.features)
      && state.worldCitiesData.features.length > 0;
  }, { timeout: 120000 });
}

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import('/js/core/map_renderer.js');
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(700);
}

async function waitForStableExactRender(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.renderPhase || '') === 'idle'
      && !state.deferExactAfterSettle
      && !state.exactAfterSettleHandle;
  }, { timeout });
}

async function waitForChunkPromotionMetric(page, { recordedAfter = 0, timeout = 30_000 } = {}) {
  await page.waitForFunction(async (startedAt) => {
    const { state } = await import('/js/core/state.js');
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === 'object'
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const candidates = [
      metrics.scenarioChunkPromotionVisualStage,
      metrics.scenarioChunkPoliticalPromotion,
      metrics.chunkPromotionMs,
    ].filter((entry) => entry && typeof entry === 'object');
    const latestRecordedAt = candidates.reduce((maxValue, entry) => {
      const recordedAt = Number(entry.recordedAt || 0);
      return Math.max(maxValue, recordedAt);
    }, 0);
    return latestRecordedAt > Number(startedAt || 0);
  }, recordedAfter, { timeout });
}

async function readUrbanContractSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const {
      getCityLabelRenderStyle,
      getEffectiveCityCollection,
    } = await import('/js/core/map_renderer.js');
    const cityStyle = state.styleConfig?.cityPoints || {};
    const worldCities = Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : [];
    const urbanFeatures = Array.isArray(state.urbanData?.features) ? state.urbanData.features : [];
    const effectiveCities = Array.isArray(getEffectiveCityCollection()?.features)
      ? getEffectiveCityCollection().features
      : [];
    const contrastSamples = worldCities
      .map((feature) => {
        const props = feature?.properties || {};
        const style = getCityLabelRenderStyle({ feature }, cityStyle);
        return {
          id: String(props.id || props.__city_id || ''),
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
        props.__city_urban_match_id || props.urban_match_id || props.urban_area_id || ''
      ).trim();
    }).length;
    const metrics = state.renderPerfMetrics && typeof state.renderPerfMetrics === 'object'
      ? state.renderPerfMetrics
      : (globalThis.__renderPerfMetrics || {});
    const promotionMetrics = [
      ['scenarioChunkPromotionVisualStage', metrics.scenarioChunkPromotionVisualStage],
      ['scenarioChunkPoliticalPromotion', metrics.scenarioChunkPoliticalPromotion],
      ['chunkPromotionMs', metrics.chunkPromotionMs],
    ].filter(([, entry]) => entry && typeof entry === 'object');
    const latestPromotionMetric = promotionMetrics.sort((left, right) => (
      Number(right[1]?.recordedAt || 0) - Number(left[1]?.recordedAt || 0)
    ))[0] || [null, null];
    return {
      radius: cityStyle.radius,
      markerScale: cityStyle.markerScale,
      worldCityCount: worldCities.length,
      effectiveCityCount: effectiveCities.length,
      urbanFeatureCount: urbanFeatures.length,
      unmatchedCapitalCount,
      activeScenarioId: String(state.activeScenarioId || ''),
      contrastSamples,
      urbanCapability: state.urbanLayerCapability || null,
      urbanStoredMode: String(state.styleConfig?.urban?.mode || ''),
      urbanModeSelectValue: String(document.getElementById('urbanMode')?.value || ''),
      urbanAdaptiveStatusText: String(document.getElementById('urbanAdaptiveStatus')?.textContent || '').trim(),
      urbanAdaptiveOptionDisabled: !!document.querySelector('#urbanMode option[value="adaptive"]')?.disabled,
      contextLayerSourceUrban: String(state.contextLayerSourceByName?.urban || ''),
      urbanDiagnosticSource: String(state.layerDataDiagnostics?.urban?.source || ''),
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
      cityLightsStyle: String(state.styleConfig?.dayNight?.cityLightsStyle || ''),
      chunkPromotionMetricName: String(latestPromotionMetric[0] || ''),
      chunkPromotionRecordedAt: Number(latestPromotionMetric[1]?.recordedAt || 0),
      loadedChunkCount: Array.isArray(state.activeScenarioChunks?.loadedChunkIds)
        ? state.activeScenarioChunks.loadedChunkIds.length
        : 0,
    };
  });
}

test('city points runtime bridge smoke keeps legacy radius hydration and simplified controls', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      const text = msg.text();
      if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
        return;
      }
      consoleIssues.push({ type, text });
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      networkFailures.push({ url: res.url(), status });
    }
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({
      url: req.url(),
      status: 'failed',
      errorText: req.failure() ? req.failure().errorText : 'requestfailed',
    });
  });

  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, JSON.stringify({
      schemaVersion: 1,
      cityPoints: {
        show: true,
        style: {
          theme: 'classic_graphite',
          radius: 6.8,
          markerScale: 1.14,
          labelDensity: 'balanced',
          color: '#2f343a',
          capitalColor: '#9f9072',
          opacity: 0.94,
          showLabels: true,
          labelSize: 11,
          showCapitalOverlay: true,
        },
      },
    }));
  }, VIEW_SETTINGS_STORAGE_KEY);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);

  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector('option[value="tno_1962"]');
  });

  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  });
  if (initialScenarioId !== 'tno_1962') {
    await page.selectOption('#scenarioSelect', 'tno_1962');
    const applyButton = page.locator('#applyScenarioBtn');
    const applyVisible = await applyButton.isVisible();
    const applyEnabled = applyVisible ? await applyButton.isEnabled() : false;
    if (applyVisible && applyEnabled) {
      await page.click('#applyScenarioBtn');
    }
    await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 20000 });
    await page.waitForTimeout(1200);
  }

  await activateAppearanceTab(page, 'appearanceTabLayers', 'appearancePanelLayers');
  await expect(page.locator('#cityPointsMarkerScale')).toHaveValue('1.14');
  await expect(page.locator('#cityPointsTheme')).toHaveCount(0);
  await expect(page.locator('#cityPointsRadius')).toHaveCount(0);

  const cityPanelText = await page.locator('#appearancePanelLayers').innerText();
  expect(cityPanelText).not.toContain('Point Size');

  await activateAppearanceTab(page, 'appearanceTabDayNight', 'appearancePanelDayNight');
  if (!(await page.locator('#dayNightEnabled').isChecked())) {
    await setCheckbox(page, 'dayNightEnabled', true);
  }
  if (!(await page.locator('#dayNightCityLightsEnabled').isChecked())) {
    await setCheckbox(page, 'dayNightCityLightsEnabled', true);
  }
  await setSelectValue(page, 'dayNightCityLightsStyle', 'modern');
  await page.waitForTimeout(600);
  await ensureBaseCityDataLoaded(page);
  await waitForStableExactRender(page);

  const runtimeSnapshot = await readUrbanContractSnapshot(page);

  expect(runtimeSnapshot.radius).toBeCloseTo(6.8, 3);
  expect(runtimeSnapshot.markerScale).toBeCloseTo(1.14, 3);
  expect(runtimeSnapshot.worldCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.effectiveCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanFeatureCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.unmatchedCapitalCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.activeScenarioId).toBe('tno_1962');
  expect(runtimeSnapshot.contrastSamples.length).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanCapability?.adaptiveAvailable).toBe(true);
  expect(runtimeSnapshot.urbanCapability?.missingOwnerCount).toBe(0);
  expect(runtimeSnapshot.urbanStoredMode).toBe('adaptive');
  expect(runtimeSnapshot.urbanModeSelectValue).toBe('adaptive');
  expect(runtimeSnapshot.urbanAdaptiveOptionDisabled).toBe(false);
  expect(runtimeSnapshot.urbanAdaptiveStatusText).toBe('');
  expect(runtimeSnapshot.contextLayerSourceUrban).toBe('external');
  expect(runtimeSnapshot.urbanDiagnosticSource).toBe('external');
  expect(runtimeSnapshot.dayNightEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsStyle).toBe('modern');

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
  expect(postInteractionSnapshot.contextLayerSourceUrban).toBe('external');
  expect(postInteractionSnapshot.urbanDiagnosticSource).toBe('external');
  expect(postInteractionSnapshot.urbanCapability?.adaptiveAvailable).toBe(true);
  expect(postInteractionSnapshot.urbanCapability?.missingOwnerCount).toBe(0);
  expect(postInteractionSnapshot.urbanStoredMode).toBe('adaptive');
  expect(postInteractionSnapshot.urbanModeSelectValue).toBe('adaptive');
  expect(postInteractionSnapshot.urbanAdaptiveOptionDisabled).toBe(false);
  expect(postInteractionSnapshot.urbanAdaptiveStatusText).toBe('');

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'qa_019_city_points_urban_runtime.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  console.log(JSON.stringify({
    runtimeSnapshot,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
