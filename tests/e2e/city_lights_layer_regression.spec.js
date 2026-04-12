const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

const APP_URL = getAppUrl('/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&dev_nocache=1');
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
  /\[data_loader\] Optional city_aliases missing or invalid/i,
  /Locales file missing or invalid, using defaults/i,
  /Geo alias file missing or invalid, using defaults/i,
  /\[boot\] Failed to hydrate active scenario bundle\. reason=post-ready/i,
  /\[scenario\] Failed to load optional resource "runtime_topology"/i,
  /was preloaded using link preload but not used within a few seconds/i,
  /ERR_CONNECTION_REFUSED/i,
  /Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true/i,
];
const IGNORED_NETWORK_PATTERNS = [
  /\/data\/city_aliases\.json$/i,
  /\/data\/locales\.json$/i,
  /\/data\/geo_aliases\.json$/i,
  /\/data\/scenarios\/[^/]+\/scenario\.bundle\.[^.]+\.json(?:\.gz)?$/i,
];

test.setTimeout(120000);

function shouldIgnoreConsoleIssue(text) {
  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(String(text || '')));
}

function shouldIgnoreNetworkFailure(url) {
  return IGNORED_NETWORK_PATTERNS.some((pattern) => pattern.test(String(url || '')));
}

const DEFAULT_MODERN_LIGHTS_CONFIG = {
  enabled: true,
  mode: 'manual',
  manualUtcMinutes: 0,
  cityLightsEnabled: true,
  cityLightsStyle: 'modern',
  cityLightsIntensity: 0.78,
  cityLightsTextureOpacity: 0.54,
  cityLightsCorridorStrength: 0.62,
  cityLightsCoreSharpness: 0.54,
  cityLightsPopulationBoostEnabled: true,
  cityLightsPopulationBoostStrength: 0.56,
};

const EASTERN_NIGHT_UTC_MINUTES = 18 * 60;
const EAST_ASIA_NIGHT_UTC_MINUTES = 14 * 60;
const AMERICAS_NIGHT_UTC_MINUTES = 4 * 60;

const URBAN_SAMPLE_POINTS = [
  { name: 'London', lon: -0.1276, lat: 51.5072 },
  { name: 'New York', lon: -74.0060, lat: 40.7128 },
];

const RURAL_SAMPLE_POINTS = [
  { name: 'Sahara East', lon: 5.0, lat: 25.0 },
  { name: 'Sahara West', lon: -10.0, lat: 23.0 },
];

const EASTERN_URBAN_SAMPLE_POINTS = [
  { name: 'Moscow', lon: 37.6173, lat: 55.7558 },
  { name: 'Delhi', lon: 77.1025, lat: 28.7041 },
  { name: 'Beijing', lon: 116.4074, lat: 39.9042 },
  { name: 'Riyadh', lon: 46.6753, lat: 24.7136 },
  { name: 'Perth', lon: 115.8605, lat: -31.9505 },
];

const EASTERN_RURAL_SAMPLE_POINTS = [
  { name: 'Central Siberia', lon: 92.0, lat: 61.0 },
  { name: 'Tibetan Plateau', lon: 88.0, lat: 33.0 },
  { name: 'Empty Quarter', lon: 52.0, lat: 20.0 },
  { name: 'Western Australia Outback', lon: 124.0, lat: -24.0 },
];

const HISTORICAL_CAPITAL_SAMPLE_POINTS = [
  { name: 'Moscow', lon: 37.6173, lat: 55.7558 },
  { name: 'Delhi', lon: 77.1025, lat: 28.7041 },
  { name: 'Beijing', lon: 116.4074, lat: 39.9042 },
  { name: 'Cairo', lon: 31.2357, lat: 30.0444 },
];

const HISTORICAL_EUROPE_SAMPLE_POINTS = [
  { name: 'Rome', lon: 12.4964, lat: 41.9028 },
  { name: 'Milan', lon: 9.1900, lat: 45.4642 },
  { name: 'Moscow', lon: 37.6173, lat: 55.7558 },
  { name: 'Saint Petersburg', lon: 30.3351, lat: 59.9343 },
];

const HISTORICAL_JAPAN_SAMPLE_POINTS = [
  { name: 'Tokyo', lon: 139.6917, lat: 35.6895 },
  { name: 'Osaka', lon: 135.5023, lat: 34.6937 },
];

const HISTORICAL_US_EAST_COAST_SAMPLE_POINTS = [
  { name: 'New York', lon: -74.0060, lat: 40.7128 },
  { name: 'Washington', lon: -77.0369, lat: 38.9072 },
];

const HISTORICAL_US_WEST_COAST_SAMPLE_POINTS = [
  { name: 'Los Angeles', lon: -118.2437, lat: 34.0522 },
  { name: 'San Francisco', lon: -122.4194, lat: 37.7749 },
];

const EAST_ASIA_RURAL_SAMPLE_POINTS = [
  { name: 'Gobi Desert', lon: 104.0, lat: 43.0 },
  { name: 'Taklamakan Basin', lon: 86.0, lat: 40.0 },
];

const AMERICAS_RURAL_SAMPLE_POINTS = [
  { name: 'Great Basin', lon: -116.0, lat: 39.0 },
  { name: 'Northern Manitoba', lon: -98.0, lat: 56.0 },
];

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

function computeMeanLuminance(pixels) {
  let total = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

function computeBrightPixelRatio(pixels, threshold = 245) {
  let bright = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      pixels[index] >= threshold
      && pixels[index + 1] >= threshold
      && pixels[index + 2] >= threshold
    ) {
      bright += 1;
    }
    count += 1;
  }
  return count > 0 ? bright / count : 0;
}

async function waitForBootOverlayHidden(page) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('bootOverlay');
    return !overlay || (overlay.classList.contains('hidden') && !document.body.classList.contains('app-booting'));
  }, { timeout: 30000 });
}

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    const canvas = Array.from(document.querySelectorAll('canvas'))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none');
    return !!select && select.querySelectorAll('option').length > 0 && !!canvas;
  });
  await waitForScenarioInteractionsReady(page);
  await ensureScenario(page, 'tno_1962');
  await waitForBootOverlayHidden(page);
  await page.waitForTimeout(1500);
}

async function waitForScenarioInteractionsReady(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      startupReadonly: !!state.startupReadonly,
      startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 30000 }).toEqual({
    startupReadonly: false,
    startupReadonlyUnlockInFlight: false,
    scenarioApplyInFlight: false,
  });
}

async function waitForDefaultScenario(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      renderPhase: String(state.renderPhase || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 30000 }).toEqual({
    activeScenarioId: 'tno_1962',
    renderPhase: 'idle',
    scenarioApplyInFlight: false,
  });
}

async function captureCanvasSample(page) {
  return page.evaluate(() => {
    const source = document.getElementById('map-canvas');
    if (!(source instanceof HTMLCanvasElement) || source.width < 200 || source.height < 120) {
      throw new Error('Primary map canvas is not ready');
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

async function configureCityLights(page, style, enabled, overrides = {}) {
  const targetManualUtcMinutes = Number.isFinite(overrides.manualUtcMinutes)
    ? overrides.manualUtcMinutes
    : DEFAULT_MODERN_LIGHTS_CONFIG.manualUtcMinutes;
  const targetPopulationBoostEnabled = overrides.populationBoostEnabled !== false;
  const targetPopulationBoostStrength = Number.isFinite(overrides.populationBoostStrength)
    ? overrides.populationBoostStrength
    : DEFAULT_MODERN_LIGHTS_CONFIG.cityLightsPopulationBoostStrength;
  const targetIntensity = Number.isFinite(overrides.intensity)
    ? overrides.intensity
    : DEFAULT_MODERN_LIGHTS_CONFIG.cityLightsIntensity;
  const targetTextureOpacity = Number.isFinite(overrides.textureOpacity)
    ? overrides.textureOpacity
    : DEFAULT_MODERN_LIGHTS_CONFIG.cityLightsTextureOpacity;
  const targetCorridorStrength = Number.isFinite(overrides.corridorStrength)
    ? overrides.corridorStrength
    : DEFAULT_MODERN_LIGHTS_CONFIG.cityLightsCorridorStrength;
  const targetCoreSharpness = Number.isFinite(overrides.coreSharpness)
    ? overrides.coreSharpness
    : DEFAULT_MODERN_LIGHTS_CONFIG.cityLightsCoreSharpness;
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return !state.scenarioApplyInFlight && !state.startupReadonlyUnlockInFlight;
  }, { timeout: 30000 });
  await page.evaluate(async ({
    targetStyle,
    targetEnabled,
    targetPopulationBoostEnabled,
    targetPopulationBoostStrength,
    targetIntensity,
    targetTextureOpacity,
    targetCorridorStrength,
    targetCoreSharpness,
    targetManualUtcMinutes,
  }) => {
    const [{ state, normalizeDayNightStyleConfig }, { markDirty }] = await Promise.all([
      import('/js/core/state.js'),
      import('/js/core/dirty_state.js'),
    ]);
    state.styleConfig.dayNight = normalizeDayNightStyleConfig({
      ...(state.styleConfig?.dayNight || {}),
      enabled: true,
      mode: 'manual',
      manualUtcMinutes: targetManualUtcMinutes,
      cityLightsEnabled: !!targetEnabled,
      cityLightsStyle: String(targetStyle || 'modern'),
      cityLightsIntensity: targetIntensity,
      cityLightsTextureOpacity: targetTextureOpacity,
      cityLightsCorridorStrength: targetCorridorStrength,
      cityLightsCoreSharpness: targetCoreSharpness,
      cityLightsPopulationBoostEnabled: !!targetPopulationBoostEnabled,
      cityLightsPopulationBoostStrength: targetPopulationBoostStrength,
    });
    markDirty('test-day-night-city-lights');
  }, {
    targetStyle: style,
    targetEnabled: enabled,
    targetPopulationBoostEnabled,
    targetPopulationBoostStrength,
    targetIntensity,
    targetTextureOpacity,
    targetCorridorStrength,
    targetCoreSharpness,
    targetManualUtcMinutes,
  });
  await page.evaluate(() => {
    globalThis.renderApp?.();
  });
  await page.waitForFunction(async ({
    targetStyle,
    targetEnabled,
    targetPopulationBoostEnabled,
    targetPopulationBoostStrength,
    targetIntensity,
    targetManualUtcMinutes,
  }) => {
    const { state } = await import('/js/core/state.js');
    const config = state.styleConfig?.dayNight || {};
    return (
      !!config.enabled
      && String(config.mode || '') === 'manual'
      && Number(config.manualUtcMinutes) === targetManualUtcMinutes
      && !!config.cityLightsPopulationBoostEnabled === !!targetPopulationBoostEnabled
      && !!config.cityLightsEnabled === !!targetEnabled
      && String(config.cityLightsStyle || '') === String(targetStyle || 'modern')
      && Math.abs(Number(config.cityLightsPopulationBoostStrength || 0) - targetPopulationBoostStrength) < 0.001
      && Math.abs(Number(config.cityLightsIntensity || 0) - targetIntensity) < 0.001
    );
  }, {
    targetStyle: style,
    targetEnabled: enabled,
    targetPopulationBoostEnabled,
    targetPopulationBoostStrength,
    targetIntensity,
    targetManualUtcMinutes,
  }, { timeout: 30000 });
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.renderPhase || '') === 'idle';
  }, { timeout: 30000 });
  await waitForBootOverlayHidden(page);
}

async function ensureScenario(page, scenarioId) {
  await waitForScenarioInteractionsReady(page);
  await page.waitForFunction((targetScenarioId) => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector(`option[value="${targetScenarioId}"]`);
  }, scenarioId);

  const activeScenarioId = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  });

  if (activeScenarioId !== scenarioId) {
    await page.evaluate(async (targetScenarioId) => {
      const select = document.querySelector('#scenarioSelect');
      if (select instanceof HTMLSelectElement) {
        select.value = targetScenarioId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const { applyScenarioByIdCommand } = await import('/js/core/scenario_dispatcher.js');
      await applyScenarioByIdCommand(targetScenarioId, {
        renderMode: 'flush',
        markDirtyReason: '',
        showToastOnComplete: false,
      });
    }, scenarioId);
  }

  await expect.poll(async () => {
    return page.evaluate(async () => {
      const { state } = await import('/js/core/state.js');
      return {
        activeScenarioId: String(state.activeScenarioId || ''),
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
      };
    });
  }, { timeout: 30000 }).toEqual({
    activeScenarioId: scenarioId,
    scenarioApplyInFlight: false,
  });
  await page.waitForTimeout(1200);
}

async function setMapZoom(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import('/js/core/map_renderer.js');
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.renderPhase || '') === 'idle';
  }, { timeout: 30000 });
  await waitForBootOverlayHidden(page);
  await page.waitForTimeout(900);
}

async function sampleWindowLuminance(page, point, radiusPx = 20) {
  return page.evaluate(async ({ point, radiusPx }) => {
    const source = document.getElementById('map-canvas');
    if (!(source instanceof HTMLCanvasElement) || source.width < 200 || source.height < 120) {
      throw new Error('Primary map canvas is not ready');
    }
    const { state } = await import('/js/core/state.js');
    const projection = globalThis.d3.geoEqualEarth().precision(0.1);
    const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * 0.04));
    const x1 = Math.max(padding + 1, state.width - padding);
    const y1 = Math.max(padding + 1, state.height - padding);
    projection.fitExtent([[padding, padding], [x1, y1]], state.landData);
    const projected = projection([Number(point.lon), Number(point.lat)]);
    if (!Array.isArray(projected)) {
      throw new Error(`Failed to project ${point.name || 'sample point'}`);
    }
    const transform = state.zoomTransform || globalThis.d3.zoomIdentity || { x: 0, y: 0, k: 1 };
    const screenX = (projected[0] * transform.k) + transform.x;
    const screenY = (projected[1] * transform.k) + transform.y;
    const sampleRadius = Math.max(4, Math.round(Number(radiusPx) || 20));
    const left = Math.max(0, Math.floor(screenX - sampleRadius));
    const top = Math.max(0, Math.floor(screenY - sampleRadius));
    const right = Math.min(source.width, Math.ceil(screenX + sampleRadius));
    const bottom = Math.min(source.height, Math.ceil(screenY + sampleRadius));
    if (right - left < 2 || bottom - top < 2) {
      throw new Error(`Sample window clipped for ${point.name || 'sample point'}`);
    }
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = right - left;
    sampleCanvas.height = bottom - top;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    sampleCtx.drawImage(source, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
    const image = sampleCtx.getImageData(0, 0, right - left, bottom - top);
    let total = 0;
    let max = 0;
    let bright = 0;
    let pixels = 0;
    for (let index = 0; index < image.data.length; index += 4) {
      const alpha = image.data[index + 3] / 255;
      const luminance = (
        image.data[index] * 0.2126
        + image.data[index + 1] * 0.7152
        + image.data[index + 2] * 0.0722
      ) * alpha;
      total += luminance;
      if (luminance > max) max = luminance;
      if (luminance >= 228) bright += 1;
      pixels += 1;
    }
    return {
      name: point.name || '',
      average: pixels ? total / pixels : 0,
      brightRatio: pixels ? bright / pixels : 0,
      peak: max,
    };
  }, { point, radiusPx });
}

async function samplePointGroup(page, points, radiusPx = 20) {
  const samples = [];
  for (const point of points) {
    samples.push(await sampleWindowLuminance(page, point, radiusPx));
  }
  return {
    samples,
    average: samples.reduce((sum, entry) => sum + entry.average, 0) / Math.max(samples.length, 1),
    averageBrightRatio: samples.reduce((sum, entry) => sum + entry.brightRatio, 0) / Math.max(samples.length, 1),
    maxBrightRatio: Math.max(...samples.map((entry) => entry.brightRatio)),
    peak: Math.max(...samples.map((entry) => entry.peak)),
  };
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
      if (shouldIgnoreConsoleIssue(text)) {
        return;
      }
      consoleIssues.push({ type, text });
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400 && !shouldIgnoreNetworkFailure(res.url())) {
      networkFailures.push({ url: res.url(), status });
    }
  });

  page.on('requestfailed', (req) => {
    if (shouldIgnoreNetworkFailure(req.url())) {
      return;
    }
    const errorText = req.failure() ? req.failure().errorText : 'requestfailed';
    if (String(errorText).includes('ERR_CONNECTION_REFUSED')) {
      return;
    }
    networkFailures.push({
      url: req.url(),
      status: 'failed',
      errorText,
    });
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForMapReady(page);

  consoleIssues.length = 0;
  networkFailures.length = 0;
  pageErrors.length = 0;

  await configureCityLights(page, 'modern', false);
  await page.waitForTimeout(250);
  const lightsOff = await captureCanvasSample(page);

  await configureCityLights(page, 'modern', true);
  await page.waitForTimeout(250);
  const modernLights = await captureCanvasSample(page);
  const modernUrban = await samplePointGroup(page, URBAN_SAMPLE_POINTS);
  const modernRural = await samplePointGroup(page, RURAL_SAMPLE_POINTS);
  await waitForBootOverlayHidden(page);
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
  await page.waitForTimeout(250);
  const highZoomLightsOff = await captureCanvasSample(page);

  await configureCityLights(page, 'modern', true, { populationBoostEnabled: false });
  await page.waitForTimeout(250);
  const modernHighZoomNoBoost = await captureCanvasSample(page);
  const boostOffUrban = await samplePointGroup(page, URBAN_SAMPLE_POINTS, 24);
  const boostOffRural = await samplePointGroup(page, RURAL_SAMPLE_POINTS, 24);

  await configureCityLights(page, 'modern', true, { populationBoostEnabled: true });
  await page.waitForTimeout(250);
  const modernHighZoomLights = await captureCanvasSample(page);
  const boostOnUrban = await samplePointGroup(page, URBAN_SAMPLE_POINTS, 24);
  const boostOnRural = await samplePointGroup(page, RURAL_SAMPLE_POINTS, 24);
  await waitForBootOverlayHidden(page);
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
  await page.waitForTimeout(250);

  await configureCityLights(page, 'historical_1930s', true);
  await page.waitForTimeout(250);
  const historicalLights = await captureCanvasSample(page);

  const offToModernChanged = countChangedPixels(lightsOff.pixels, modernLights.pixels, 10);
  const offToHistoricalChanged = countChangedPixels(lightsOff.pixels, historicalLights.pixels, 10);
  const offToModernLuminance = computeLuminanceDelta(lightsOff.pixels, modernLights.pixels);
  const offToHistoricalLuminance = computeLuminanceDelta(lightsOff.pixels, historicalLights.pixels);
  const highZoomOffToModernChanged = countChangedPixels(highZoomLightsOff.pixels, modernHighZoomLights.pixels, 10);
  const highZoomOffToModernLuminance = computeLuminanceDelta(highZoomLightsOff.pixels, modernHighZoomLights.pixels);
  const boostChanged = countChangedPixels(modernHighZoomNoBoost.pixels, modernHighZoomLights.pixels, 8);
  const boostLuminance = computeLuminanceDelta(modernHighZoomNoBoost.pixels, modernHighZoomLights.pixels);
  const modernBrightPixelRatio = computeBrightPixelRatio(modernLights.pixels);
  const historicalBrightPixelRatio = computeBrightPixelRatio(historicalLights.pixels);
  const modernMeanLuminance = computeMeanLuminance(modernLights.pixels);
  const lightsOffMeanLuminance = computeMeanLuminance(lightsOff.pixels);

  await configureCityLights(page, 'modern', true, {
    manualUtcMinutes: EASTERN_NIGHT_UTC_MINUTES,
    populationBoostEnabled: true,
  });
  await page.waitForTimeout(250);
  const easternUrban = await samplePointGroup(page, EASTERN_URBAN_SAMPLE_POINTS, 24);
  const easternRural = await samplePointGroup(page, EASTERN_RURAL_SAMPLE_POINTS, 24);

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: EASTERN_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  await page.waitForTimeout(250);
  const historicalCapitals = await samplePointGroup(page, HISTORICAL_CAPITAL_SAMPLE_POINTS, 18);
  const historicalEurope = await samplePointGroup(page, HISTORICAL_EUROPE_SAMPLE_POINTS, 18);
  const historicalRural = await samplePointGroup(page, EASTERN_RURAL_SAMPLE_POINTS, 18);

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: EAST_ASIA_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  await page.waitForTimeout(250);
  const historicalJapan = await samplePointGroup(page, HISTORICAL_JAPAN_SAMPLE_POINTS, 18);
  const historicalJapanRural = await samplePointGroup(page, EAST_ASIA_RURAL_SAMPLE_POINTS, 18);

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: AMERICAS_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  await page.waitForTimeout(250);
  const historicalUsEastCoast = await samplePointGroup(page, HISTORICAL_US_EAST_COAST_SAMPLE_POINTS, 18);
  const historicalUsWestCoast = await samplePointGroup(page, HISTORICAL_US_WEST_COAST_SAMPLE_POINTS, 18);
  const historicalAmericasRural = await samplePointGroup(page, AMERICAS_RURAL_SAMPLE_POINTS, 18);

  expect(offToModernChanged).toBeGreaterThan(2000);
  expect(offToModernLuminance).toBeGreaterThan(300000);
  expect(highZoomOffToModernChanged).toBeGreaterThan(8000);
  expect(highZoomOffToModernLuminance).toBeGreaterThan(1000000);
  expect(boostChanged).toBeGreaterThan(2000);
  expect(boostLuminance).toBeGreaterThan(60000);
  expect(modernBrightPixelRatio).toBeLessThan(0.02);
  expect(modernMeanLuminance).toBeGreaterThan(lightsOffMeanLuminance);
  expect(modernUrban.average).toBeGreaterThan(modernRural.average + 8);
  expect(modernUrban.maxBrightRatio).toBeLessThan(0.32);
  expect(modernRural.maxBrightRatio).toBeLessThan(0.012);
  expect(modernUrban.peak).toBeGreaterThan(modernRural.peak + 16);
  expect(boostOnUrban.average).toBeGreaterThan(boostOffUrban.average + 1.2);
  expect(boostOnUrban.maxBrightRatio).toBeLessThan(0.42);
  expect(Math.abs(boostOnRural.average - boostOffRural.average)).toBeLessThan(1.5);
  expect(easternUrban.average).toBeGreaterThan(easternRural.average + 10);
  expect(easternUrban.averageBrightRatio).toBeGreaterThan(easternRural.averageBrightRatio + 0.003);
  expect(easternUrban.maxBrightRatio).toBeLessThan(0.18);
  expect(offToHistoricalChanged).toBeGreaterThan(300);
  expect(offToHistoricalLuminance).toBeGreaterThan(45000);
  expect(historicalCapitals.peak).toBeGreaterThan(historicalRural.peak + 20);
  expect(historicalCapitals.average).toBeGreaterThan(historicalRural.average + 2);
  expect(historicalCapitals.averageBrightRatio).toBeGreaterThan(historicalRural.averageBrightRatio + 0.001);
  expect(historicalCapitals.maxBrightRatio).toBeLessThan(0.18);
  expect(historicalBrightPixelRatio).toBeLessThan(0.012);
  expect(historicalEurope.average).toBeGreaterThan(historicalRural.average + 1);
  expect(historicalEurope.peak).toBeGreaterThan(historicalRural.peak + 8);
  expect(historicalEurope.maxBrightRatio).toBeLessThan(0.14);
  expect(historicalJapan.average).toBeGreaterThan(historicalJapanRural.average + 1);
  expect(historicalJapan.peak).toBeGreaterThan(historicalJapanRural.peak + 8);
  expect(historicalJapan.maxBrightRatio).toBeLessThan(0.14);
  expect(historicalUsEastCoast.average).toBeGreaterThan(historicalAmericasRural.average + 1);
  expect(historicalUsEastCoast.peak).toBeGreaterThan(historicalAmericasRural.peak + 8);
  expect(historicalUsEastCoast.maxBrightRatio).toBeLessThan(0.14);
  expect(historicalUsWestCoast.average).toBeGreaterThan(historicalAmericasRural.average + 1);
  expect(historicalUsWestCoast.peak).toBeGreaterThan(historicalAmericasRural.peak + 8);
  expect(historicalUsWestCoast.maxBrightRatio).toBeLessThan(0.14);
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
    offToModernLuminance,
    offToHistoricalLuminance,
    highZoomOffToModernChanged,
    highZoomOffToModernLuminance,
    boostChanged,
    boostLuminance,
    modernBrightPixelRatio,
    historicalBrightPixelRatio,
    modernMeanLuminance,
    lightsOffMeanLuminance,
    modernUrban,
    modernRural,
    boostOffUrban,
    boostOffRural,
    boostOnUrban,
    boostOnRural,
    easternUrban,
    easternRural,
    historicalCapitals,
    historicalEurope,
    historicalRural,
    historicalJapan,
    historicalJapanRural,
    historicalUsEastCoast,
    historicalUsWestCoast,
    historicalAmericasRural,
    screenshot: screenshotPath,
    modernLowZoomScreenshot: modernLowZoomScreenshotPath,
    modernHighZoomScreenshot: modernHighZoomScreenshotPath,
    pageErrors,
    consoleIssues,
    networkFailures,
  }, null, 2));
});
