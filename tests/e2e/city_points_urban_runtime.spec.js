const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:18080';
const VIEW_SETTINGS_STORAGE_KEY = 'map_view_settings_v1';

test('city points runtime bridge smoke keeps legacy radius hydration and simplified controls', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text() });
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

  await page.click('#appearanceTabLayers');
  await expect(page.locator('#appearancePanelLayers')).toHaveClass(/is-active/);
  await expect(page.locator('#cityPointsMarkerScale')).toHaveValue('1.14');
  await expect(page.locator('#cityPointsTheme')).toHaveCount(0);
  await expect(page.locator('#cityPointsRadius')).toHaveCount(0);

  const cityPanelText = await page.locator('#appearancePanelLayers').innerText();
  expect(cityPanelText).toContain('Classic Graphite');
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
    const cityStyle = state.styleConfig?.cityPoints || {};
    const worldCities = Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : [];
    const urbanFeatures = Array.isArray(state.urbanData?.features) ? state.urbanData.features : [];
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
      urbanFeatureCount: urbanFeatures.length,
      unmatchedCapitalCount,
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
      cityLightsStyle: String(state.styleConfig?.dayNight?.cityLightsStyle || ''),
    };
  });

  expect(runtimeSnapshot.radius).toBeCloseTo(6.8, 3);
  expect(runtimeSnapshot.markerScale).toBeCloseTo(1.14, 3);
  expect(runtimeSnapshot.worldCityCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.urbanFeatureCount).toBeGreaterThan(0);
  expect(runtimeSnapshot.unmatchedCapitalCount).toBeGreaterThan(0);
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
