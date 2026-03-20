const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:18080';
const LEGACY_RADIUS = 6.8;
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

async function setCheckbox(page, id, checked) {
  await page.evaluate(({ id: targetId, checked: targetChecked }) => {
    const input = document.getElementById(targetId);
    if (!input) {
      throw new Error(`Missing checkbox: ${targetId}`);
    }
    input.checked = !!targetChecked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, checked });
}

async function setInputValue(page, id, value) {
  await page.evaluate(({ id: targetId, value: targetValue }) => {
    const input = document.getElementById(targetId);
    if (!input) {
      throw new Error(`Missing input: ${targetId}`);
    }
    input.value = String(targetValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { id, value });
}

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    const canvas = Array.from(document.querySelectorAll('canvas'))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none');
    return !!select && select.querySelectorAll('option').length > 0 && !!canvas;
  });
  await page.waitForTimeout(1500);
}

async function ensureScenario(page, scenarioId, label) {
  await page.waitForFunction((targetScenarioId) => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector(`option[value="${targetScenarioId}"]`);
  }, scenarioId);
  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  });
  if (initialScenarioId !== scenarioId) {
    await page.selectOption('#scenarioSelect', scenarioId);
    const applyButton = page.locator('#applyScenarioBtn');
    if ((await applyButton.isVisible()) && (await applyButton.isEnabled())) {
      await applyButton.click();
    }
  }
  await expect(page.locator('#scenarioStatus')).toContainText(label, { timeout: 20000 });
  await page.waitForTimeout(800);
}

async function captureCanvasSample(page) {
  return page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('canvas'))
      .filter((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none')
      .sort((left, right) => (right.width * right.height) - (left.width * left.height));
    const source = candidates[0];
    if (!source) {
      throw new Error('No visible map canvas found');
    }
    const sampleWidth = 320;
    const sampleHeight = 180;
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, sampleWidth, sampleHeight);
    const image = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    let opaquePixels = 0;
    for (let index = 3; index < image.data.length; index += 4) {
      if (image.data[index] > 0) {
        opaquePixels += 1;
      }
    }
    return {
      width: sampleWidth,
      height: sampleHeight,
      opaquePixels,
      pixels: Array.from(image.data),
    };
  });
}

test('city and urban rendering regression smoke', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];
  const pageErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || error));
  });

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

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForMapReady(page);
  await ensureScenario(page, 'tno_1962', 'TNO 1962');
  consoleIssues.length = 0;
  networkFailures.length = 0;
  pageErrors.length = 0;

  const hydratedConfig = await page.evaluate(async ({ radius }) => {
    const { normalizeCityLayerStyleConfig, state } = await import('/js/core/state.js');
    state.styleConfig.cityPoints = normalizeCityLayerStyleConfig({
      ...(state.styleConfig.cityPoints || {}),
      radius,
      markerScale: 1,
    });
    state.updateToolbarInputsFn?.();
    state.renderNowFn?.();
    return {
      radius: Number(state.styleConfig?.cityPoints?.radius || 0),
      markerScale: Number(state.styleConfig?.cityPoints?.markerScale || 0),
      showCityPoints: !!state.showCityPoints,
      showUrban: !!state.showUrban,
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
    };
  }, { radius: LEGACY_RADIUS });
  await page.waitForTimeout(500);

  expect(hydratedConfig.radius).toBeCloseTo(LEGACY_RADIUS, 1);
  expect(hydratedConfig.markerScale).toBeCloseTo(1, 2);
  expect(hydratedConfig.showCityPoints).toBe(true);
  expect(hydratedConfig.showUrban).toBe(true);

  await setCheckbox(page, 'toggleCityPoints', true);
  await setCheckbox(page, 'toggleUrban', true);
  await page.waitForTimeout(500);

  const cityPointsOn = await captureCanvasSample(page);
  await setCheckbox(page, 'toggleCityPoints', false);
  await page.waitForTimeout(500);
  const cityPointsOff = await captureCanvasSample(page);
  await setCheckbox(page, 'toggleCityPoints', true);
  await page.waitForTimeout(500);
  const cityPointsRestored = await captureCanvasSample(page);

  const cityPointDiff = countChangedPixels(cityPointsOn.pixels, cityPointsOff.pixels);
  const cityPointRestoreDiff = countChangedPixels(cityPointsOff.pixels, cityPointsRestored.pixels);
  expect(cityPointsOn.opaquePixels).toBeGreaterThan(1000);
  expect(cityPointDiff).toBeGreaterThan(120);
  expect(cityPointRestoreDiff).toBeGreaterThan(120);

  const urbanOn = await captureCanvasSample(page);
  await setCheckbox(page, 'toggleUrban', false);
  await page.waitForTimeout(500);
  const urbanOff = await captureCanvasSample(page);
  const urbanDisabledState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      showUrban: !!state.showUrban,
    };
  });
  await setCheckbox(page, 'toggleUrban', true);
  await page.waitForTimeout(500);
  const urbanRestore = await captureCanvasSample(page);
  const urbanRestoredState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      showUrban: !!state.showUrban,
    };
  });
  const urbanDiff = countChangedPixels(urbanOn.pixels, urbanOff.pixels);
  const urbanRestoreDiff = countChangedPixels(urbanOff.pixels, urbanRestore.pixels);
  expect(urbanDisabledState.showUrban).toBe(false);
  expect(urbanRestoredState.showUrban).toBe(true);

  await setCheckbox(page, 'dayNightEnabled', true);
  await setCheckbox(page, 'dayNightCityLightsEnabled', false);
  await setInputValue(page, 'dayNightManualTime', 0);
  await page.waitForTimeout(700);
  const lightsOff = await captureCanvasSample(page);

  await setInputValue(page, 'dayNightCityLightsStyle', 'modern');
  await setCheckbox(page, 'dayNightCityLightsEnabled', true);
  await page.waitForTimeout(900);
  const lightsOn = await captureCanvasSample(page);
  const lightsDiff = countChangedPixels(lightsOff.pixels, lightsOn.pixels, 10);
  expect(lightsDiff).toBeGreaterThan(120);

  const finalState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      showCityPoints: !!state.showCityPoints,
      showUrban: !!state.showUrban,
      dayNightEnabled: !!state.styleConfig?.dayNight?.enabled,
      cityLightsEnabled: !!state.styleConfig?.dayNight?.cityLightsEnabled,
      cityLightsStyle: String(state.styleConfig?.dayNight?.cityLightsStyle || ''),
    };
  });

  expect(finalState.showCityPoints).toBe(true);
  expect(finalState.showUrban).toBe(true);
  expect(finalState.dayNightEnabled).toBe(true);
  expect(finalState.cityLightsEnabled).toBe(true);
  expect(finalState.cityLightsStyle).toBe('modern');
  expect(pageErrors).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  const shotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_urban_rendering_regression.png'
  );
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    hydratedConfig,
    cityPointDiff,
    cityPointRestoreDiff,
    urbanDiff,
    urbanRestoreDiff,
    lightsDiff,
    finalState,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    pageErrors,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
