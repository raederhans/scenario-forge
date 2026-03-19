const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:18080';
const VIEW_SETTINGS_STORAGE_KEY = 'map_view_settings_v1';
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

test('city points runtime bridge smoke keeps legacy radius hydration and simplified controls', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
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
  await page.waitForTimeout(1400);

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

  await page.click('#appearanceTabLayers');
  await expect(page.locator('#appearancePanelLayers')).toHaveClass(/is-active/);
  await expect(page.locator('#cityPointsMarkerScale')).toHaveValue('1.14');
  await expect(page.locator('#cityPointsTheme')).toHaveCount(0);
  await expect(page.locator('#cityPointsRadius')).toHaveCount(0);

  const cityPanelText = await page.locator('#appearancePanelLayers').innerText();
  expect(cityPanelText).not.toContain('Point Size');

  await page.click('#appearanceTabDayNight');
  await expect(page.locator('#appearancePanelDayNight')).toHaveClass(/is-active/);
  if (!(await page.locator('#dayNightEnabled').isChecked())) {
    await page.click('#dayNightEnabled');
  }
  if (!(await page.locator('#dayNightCityLightsEnabled').isChecked())) {
    await page.click('#dayNightCityLightsEnabled');
  }
  await page.selectOption('#dayNightCityLightsStyle', 'modern');
  await page.waitForTimeout(600);

  const runtimeSnapshot = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const {
      getCityLabelRenderStyle,
      getCityScenarioTag,
      getEffectiveCityCollection,
      doesScenarioCountryHideCityPoints,
    } = await import('/js/core/map_renderer.js');
    const cityStyle = state.styleConfig?.cityPoints || {};
    const hiddenCityTags = ['AFA', 'RFA'];
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
    const rawHiddenTagCityCounts = hiddenCityTags.reduce((counts, tag) => {
      counts[tag] = worldCities.filter((feature) => getCityScenarioTag(feature) === tag).length;
      return counts;
    }, {});
    const effectiveHiddenTagCityCounts = hiddenCityTags.reduce((counts, tag) => {
      counts[tag] = effectiveCities.filter((feature) => getCityScenarioTag(feature) === tag).length;
      return counts;
    }, {});
    const hiddenTagUrbanCounts = hiddenCityTags.reduce((counts, tag) => {
      counts[tag] = urbanFeatures.filter((feature) => {
        const props = feature?.properties || {};
        const hostFeatureId = String(
          props.host_feature_id || props.hostFeatureId || props.political_feature_id || props.politicalFeatureId || ''
        ).trim();
        if (!hostFeatureId) return false;
        const featureTag = String(
          state.scenarioControllersByFeatureId?.[hostFeatureId]
          || state.sovereigntyByFeatureId?.[hostFeatureId]
          || ''
        ).trim().toUpperCase();
        return featureTag === tag;
      }).length;
      return counts;
    }, {});
    const unmatchedCapitalCount = worldCities.filter((feature) => {
      const props = feature?.properties || {};
      return !!props.__city_is_country_capital && !String(
        props.__city_urban_match_id || props.urban_match_id || props.urban_area_id || ''
      ).trim();
    }).length;
    return {
      radius: cityStyle.radius,
      markerScale: cityStyle.markerScale,
      worldCityCount: worldCities.length,
      effectiveCityCount: effectiveCities.length,
      urbanFeatureCount: urbanFeatures.length,
      unmatchedCapitalCount,
      activeScenarioId: String(state.activeScenarioId || ''),
      saintPetersburgLocale: state.locales?.geo?.RU_CITY_SAINT_PETERSBURG || null,
      volgogradLocale: state.locales?.geo?.RU_CITY_VOLGOGRAD || null,
      contrastSamples,
      hiddenCityFlags: Object.fromEntries(hiddenCityTags.map((tag) => [tag, doesScenarioCountryHideCityPoints(tag)])),
      rawHiddenTagCityCounts,
      effectiveHiddenTagCityCounts,
      hiddenTagUrbanCounts,
      totalRawHiddenTagCityCount: Object.values(rawHiddenTagCityCounts).reduce((sum, count) => sum + count, 0),
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
      cityLightsStyle: String(state.styleConfig?.dayNight?.cityLightsStyle || ''),
    };
  });

  expect(runtimeSnapshot.radius).toBeCloseTo(6.8, 3);
  expect(runtimeSnapshot.markerScale).toBeCloseTo(1.14, 3);
  expect(runtimeSnapshot.worldCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.effectiveCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanFeatureCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.unmatchedCapitalCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.activeScenarioId).toBe('tno_1962');
  expect(runtimeSnapshot.saintPetersburgLocale?.en).toBe('Leningrad');
  expect(runtimeSnapshot.volgogradLocale?.en).toBe('Stalingrad');
  expect(runtimeSnapshot.contrastSamples.length).toBeGreaterThan(0);
  expect(runtimeSnapshot.hiddenCityFlags.AFA).toBe(true);
  expect(runtimeSnapshot.hiddenCityFlags.RFA).toBe(true);
  expect(runtimeSnapshot.rawHiddenTagCityCounts.AFA).toBeGreaterThan(0);
  expect(runtimeSnapshot.totalRawHiddenTagCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.effectiveHiddenTagCityCounts.AFA).toBe(0);
  expect(runtimeSnapshot.effectiveHiddenTagCityCounts.RFA).toBe(0);
  expect(runtimeSnapshot.dayNightEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsEnabled).toBe(true);
  expect(runtimeSnapshot.cityLightsStyle).toBe('modern');

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
