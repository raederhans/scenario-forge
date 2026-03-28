const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

const APP_URL = getAppUrl();
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

test.setTimeout(60000);

function countChangedPixels(left, right, threshold = 12) {
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

function computeLuminanceDelta(left, right) {
  const limit = Math.min(left.length, right.length);
  let total = 0;
  for (let index = 0; index < limit; index += 4) {
    total += Math.abs(left[index] - right[index]);
    total += Math.abs(left[index + 1] - right[index + 1]);
    total += Math.abs(left[index + 2] - right[index + 2]);
  }
  return total;
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
    return {
      width: sampleWidth,
      height: sampleHeight,
      pixels: Array.from(image.data),
    };
  });
}

async function configureCityLights(page, style, enabled) {
  await page.evaluate(async ({ targetStyle, targetEnabled }) => {
    const { normalizeDayNightStyleConfig, state } = await import('/js/core/state.js');
    const next = normalizeDayNightStyleConfig({
      ...(state.styleConfig?.dayNight || {}),
      enabled: true,
      mode: 'manual',
      manualUtcMinutes: 0,
      cityLightsEnabled: !!targetEnabled,
      cityLightsStyle: targetStyle,
      cityLightsIntensity: 0.72,
    });
    state.styleConfig.dayNight = next;
    state.updateToolbarInputsFn?.();
    state.renderNowFn?.();
  }, { targetStyle: style, targetEnabled: enabled });
}

async function ensureScenario(page, scenarioId) {
  await page.waitForFunction((targetScenarioId) => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector(`option[value="${targetScenarioId}"]`);
  }, scenarioId);

  const activeScenarioId = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  });

  if (activeScenarioId !== scenarioId) {
    await page.selectOption('#scenarioSelect', scenarioId);
    const applyButton = page.locator('#applyScenarioBtn');
    if ((await applyButton.isVisible()) && (await applyButton.isEnabled())) {
      await applyButton.click();
    }
  }

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const { state } = await import('/js/core/state.js');
      return String(state.activeScenarioId || '');
    });
  }, { timeout: 20000 }).toBe(scenarioId);
}

async function setMapZoom(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import('/js/core/map_renderer.js');
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(900);
}

test('city lights default scene and intensity regression', async ({ page }) => {
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
  await ensureScenario(page, 'blank_base');

  consoleIssues.length = 0;
  networkFailures.length = 0;
  pageErrors.length = 0;

  await configureCityLights(page, 'modern', false);
  await page.waitForTimeout(900);
  const lightsOff = await captureCanvasSample(page);

  await configureCityLights(page, 'modern', true);
  await page.waitForTimeout(900);
  const modernLights = await captureCanvasSample(page);
  const modernLowZoomScreenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_lights_modern_low_zoom.png'
  );
  fs.mkdirSync(path.dirname(modernLowZoomScreenshotPath), { recursive: true });
  await page.screenshot({ path: modernLowZoomScreenshotPath, fullPage: true });

  await setMapZoom(page, 250);
  await configureCityLights(page, 'modern', false);
  await page.waitForTimeout(900);
  const highZoomLightsOff = await captureCanvasSample(page);

  await configureCityLights(page, 'modern', true);
  await page.waitForTimeout(900);
  const modernHighZoomLights = await captureCanvasSample(page);
  const modernHighZoomScreenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_lights_modern_high_zoom.png'
  );
  await page.screenshot({ path: modernHighZoomScreenshotPath, fullPage: true });

  await setMapZoom(page, 100);
  await configureCityLights(page, 'modern', true);
  await page.waitForTimeout(900);

  await configureCityLights(page, 'historical_1930s', true);
  await page.waitForTimeout(900);
  const historicalLights = await captureCanvasSample(page);

  const offToModernChanged = countChangedPixels(lightsOff.pixels, modernLights.pixels, 10);
  const offToHistoricalChanged = countChangedPixels(lightsOff.pixels, historicalLights.pixels, 10);
  const modernToHistoricalChanged = countChangedPixels(modernLights.pixels, historicalLights.pixels, 10);
  const offToModernLuminance = computeLuminanceDelta(lightsOff.pixels, modernLights.pixels);
  const offToHistoricalLuminance = computeLuminanceDelta(lightsOff.pixels, historicalLights.pixels);
  const highZoomOffToModernChanged = countChangedPixels(highZoomLightsOff.pixels, modernHighZoomLights.pixels, 10);
  const highZoomOffToModernLuminance = computeLuminanceDelta(highZoomLightsOff.pixels, modernHighZoomLights.pixels);

  expect(offToModernChanged).toBeGreaterThan(250);
  expect(offToModernChanged).toBeGreaterThan(offToHistoricalChanged);
  expect(offToModernLuminance).toBeGreaterThan(offToHistoricalLuminance);
  expect(modernToHistoricalChanged).toBeGreaterThan(180);
  expect(highZoomOffToModernChanged).toBeGreaterThan(90);
  expect(highZoomOffToModernLuminance).toBeGreaterThan(9000);
  expect(pageErrors).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  const screenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_lights_layer_regression.png'
  );
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(JSON.stringify({
    offToModernChanged,
    offToHistoricalChanged,
    modernToHistoricalChanged,
    offToModernLuminance,
    offToHistoricalLuminance,
    highZoomOffToModernChanged,
    highZoomOffToModernLuminance,
    screenshot: screenshotPath,
    modernLowZoomScreenshot: modernLowZoomScreenshotPath,
    modernHighZoomScreenshot: modernHighZoomScreenshotPath,
    pageErrors,
    consoleIssues,
    networkFailures,
  }, null, 2));
});
