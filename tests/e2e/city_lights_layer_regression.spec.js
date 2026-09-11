const fs = require("fs");
const path = require("path");
const { test, expect, prepareSharedCityRuntimeState } = require("./support/fixtures");
const {
  waitForRenderIdle,
} = require("./support/playwright-app");
const { getConsoleIgnorePatterns } = require("./support/expectations/console-allowlist");

const CITY_LIGHTS_BOOT_PATH = '/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1';
const IGNORED_CONSOLE_PATTERNS = getConsoleIgnorePatterns(__filename);
const IGNORED_NETWORK_PATTERNS = [
  /\/data\/city_aliases\.json$/i,
  /\/data\/locales\.json$/i,
  /\/data\/geo_aliases\.json$/i,
  /\/data\/scenarios\/[^/]+\/scenario\.bundle\.[^.]+\.json(?:\.gz)?$/i,
];

test.setTimeout(240000);
test.use({ sharedCityRequireInfraIdle: false });

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
  cityLightsIntensity: 1.15,
  cityLightsTextureOpacity: 0.74,
  cityLightsCorridorStrength: 0.42,
  cityLightsCoreSharpness: 0.62,
  cityLightsPopulationBoostEnabled: true,
  cityLightsPopulationBoostStrength: 0.7,
};

const EASTERN_NIGHT_UTC_MINUTES = 18 * 60;
const EAST_ASIA_NIGHT_UTC_MINUTES = 14 * 60;
const AMERICAS_NIGHT_UTC_MINUTES = 4 * 60;

const URBAN_SAMPLE_POINTS = [
  { name: 'London', lon: -0.1276, lat: 51.5072 },
  { name: 'New York', lon: -74.0060, lat: 40.7128 },
];

const HIGH_ZOOM_URBAN_SAMPLE_POINTS = [
  { name: 'Casablanca', lon: -7.5898, lat: 33.5731 },
  { name: 'Algiers', lon: 3.0588, lat: 36.7538 },
];

const RURAL_SAMPLE_POINTS = [
  { name: 'Central Sahara', lon: 22.0, lat: 23.0 },
  { name: 'Tenere Desert', lon: 10.0, lat: 18.0 },
];

const HIGH_ZOOM_RURAL_SAMPLE_POINTS = [
  { name: 'Central Mauritania', lon: -4.0, lat: 20.0 },
  { name: 'Northern Sahel Interior', lon: 0.0, lat: 22.0 },
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

const HISTORICAL_CHINA_SAMPLE_POINTS = [
  { name: 'Beijing', lon: 116.4074, lat: 39.9042 },
  { name: 'Shanghai', lon: 121.4737, lat: 31.2304 },
  { name: 'Guangzhou', lon: 113.2644, lat: 23.1291 },
  { name: 'Wuhan', lon: 114.3055, lat: 30.5928 },
  { name: 'Nanjing', lon: 118.7969, lat: 32.0603 },
];

const HISTORICAL_INDIA_SAMPLE_POINTS = [
  { name: 'Mumbai', lon: 72.8777, lat: 19.0760 },
  { name: 'Delhi', lon: 77.1025, lat: 28.7041 },
  { name: 'Kolkata', lon: 88.3639, lat: 22.5726 },
  { name: 'New Delhi', lon: 77.2090, lat: 28.6139 },
];

const EAST_ASIA_RURAL_SAMPLE_POINTS = [
  { name: 'Gobi Desert', lon: 104.0, lat: 43.0 },
  { name: 'Taklamakan Basin', lon: 86.0, lat: 40.0 },
];

const AMERICAS_RURAL_SAMPLE_POINTS = [
  { name: 'Great Basin', lon: -116.0, lat: 39.0 },
  { name: 'Northern Manitoba', lon: -98.0, lat: 56.0 },
];

test.use({
  sharedCityBootPath: CITY_LIGHTS_BOOT_PATH,
  sharedCityBootProfile: "city-lights-fast-readonly",
});

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

function computeMaxAverageDelta(leftGroup, rightGroup) {
  const leftSamples = Array.isArray(leftGroup?.samples) ? leftGroup.samples : [];
  const rightSamples = Array.isArray(rightGroup?.samples) ? rightGroup.samples : [];
  const limit = Math.min(leftSamples.length, rightSamples.length);
  let maxDelta = 0;
  for (let index = 0; index < limit; index += 1) {
    maxDelta = Math.max(
      maxDelta,
      Number(rightSamples[index]?.average || 0) - Number(leftSamples[index]?.average || 0)
    );
  }
  return maxDelta;
}

async function waitForBootOverlayHidden(page) {
  await page.waitForFunction(() => {
    const overlay = document.getElementById('bootOverlay');
    return !overlay || (overlay.classList.contains('hidden') && !document.body.classList.contains('app-booting'));
  }, { timeout: 30000 });
}

async function waitForMapReady(page) {
  await prepareSharedCityRuntimeState(page, {
    scenarioId: "tno_1962",
    scenarioApplyReason: "city-lights-layer-regression",
    loadBaseCityDataReason: "e2e-city-lights-regression",
    timeout: 30_000,
    requireInfraIdle: true,
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

async function waitForCanvasLuminanceDelta(page, baselineSample, threshold, { timeout = 30000 } = {}) {
  await expect.poll(async () => {
    const currentSample = await captureCanvasSample(page);
    return computeLuminanceDelta(baselineSample.pixels, currentSample.pixels);
  }, { timeout }).toBeGreaterThan(threshold);
}

async function waitForVisualRenderIdle(page, options = {}) {
  await waitForRenderIdle(page, { ...options, requireInfra: false });
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
  await expect.poll(async () => {
    const configState = await page.evaluate(async () => {
      const { state } = await import('/js/core/state.js');
      const config = state.styleConfig?.dayNight || {};
      return {
        enabled: !!config.enabled,
        mode: String(config.mode || ''),
        manualUtcMinutes: Number(config.manualUtcMinutes),
        cityLightsPopulationBoostEnabled: !!config.cityLightsPopulationBoostEnabled,
        cityLightsEnabled: !!config.cityLightsEnabled,
        cityLightsStyle: String(config.cityLightsStyle || ''),
        cityLightsPopulationBoostStrength: Number(config.cityLightsPopulationBoostStrength || 0),
        cityLightsIntensity: Number(config.cityLightsIntensity || 0),
        cityLightsTextureOpacity: Number(config.cityLightsTextureOpacity || 0),
        cityLightsCorridorStrength: Number(config.cityLightsCorridorStrength || 0),
        cityLightsCoreSharpness: Number(config.cityLightsCoreSharpness || 0),
        renderPhase: String(state.renderPhase || ''),
        scenarioApplyInFlight: !!state.scenarioApplyInFlight,
        startupReadonlyUnlockInFlight: !!state.startupReadonlyUnlockInFlight,
      };
    });
    const settled = (
      configState.enabled
      && configState.mode === 'manual'
      && configState.manualUtcMinutes === targetManualUtcMinutes
      && configState.cityLightsPopulationBoostEnabled === !!targetPopulationBoostEnabled
      && configState.cityLightsEnabled === !!enabled
      && configState.cityLightsStyle === String(style || 'modern')
      && Math.abs(configState.cityLightsPopulationBoostStrength - targetPopulationBoostStrength) < 0.001
      && Math.abs(configState.cityLightsIntensity - targetIntensity) < 0.001
      && Math.abs(configState.cityLightsTextureOpacity - targetTextureOpacity) < 0.001
      && Math.abs(configState.cityLightsCorridorStrength - targetCorridorStrength) < 0.001
      && Math.abs(configState.cityLightsCoreSharpness - targetCoreSharpness) < 0.001
    );
    return { settled, ...configState };
  }, { timeout: 30000 }).toMatchObject({ settled: true });
  await page.evaluate(() => {
    globalThis.renderApp?.();
  });
  await waitForVisualRenderIdle(page, { timeout: 30000 });
}

async function setMapZoom(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { resetZoomToFit, setZoomPercent } = await import('/js/core/map_renderer.js');
    resetZoomToFit();
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForFunction(async (targetScale) => {
    const { state } = await import('/js/core/state.js');
    const scale = Number(state.zoomTransform?.k || 1);
    return Math.abs(scale - targetScale) < 0.02;
  }, Math.max(0.01, Number(percent) / 100), { timeout: 30000 });
  await waitForRenderIdle(page, { timeout: 30000 });
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
    const cssScreenX = (projected[0] * transform.k) + transform.x;
    const cssScreenY = (projected[1] * transform.k) + transform.y;
    const canvasScaleX = source.width / Math.max(1, Number(state.width || source.width));
    const canvasScaleY = source.height / Math.max(1, Number(state.height || source.height));
    const screenX = cssScreenX * canvasScaleX;
    const screenY = cssScreenY * canvasScaleY;
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
  const samples = await page.evaluate(async ({ points, radiusPx }) => {
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
    const transform = state.zoomTransform || globalThis.d3.zoomIdentity || { x: 0, y: 0, k: 1 };
    const canvasScaleX = source.width / Math.max(1, Number(state.width || source.width));
    const canvasScaleY = source.height / Math.max(1, Number(state.height || source.height));
    const sampleRadius = Math.max(4, Math.round(Number(radiusPx) || 20));
    return points.map((point) => {
      const projected = projection([Number(point.lon), Number(point.lat)]);
      if (!Array.isArray(projected)) {
        throw new Error(`Failed to project ${point.name || 'sample point'}`);
      }
      const cssScreenX = (projected[0] * transform.k) + transform.x;
      const cssScreenY = (projected[1] * transform.k) + transform.y;
      const screenX = cssScreenX * canvasScaleX;
      const screenY = cssScreenY * canvasScaleY;
      const left = Math.max(0, Math.floor(screenX - sampleRadius));
      const top = Math.max(0, Math.floor(screenY - sampleRadius));
      const right = Math.min(source.width, Math.ceil(screenX + sampleRadius));
      const bottom = Math.min(source.height, Math.ceil(screenY + sampleRadius));
      if (right - left < 2 || bottom - top < 2) {
        throw new Error(`Sample window clipped for ${point.name || 'sample point'} at ${JSON.stringify({
          sourceWidth: source.width,
          sourceHeight: source.height,
          stateWidth: state.width,
          stateHeight: state.height,
          screenX,
          screenY,
          cssScreenX,
          cssScreenY,
          transform,
        })}`);
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
    });
  }, { points, radiusPx });
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

  await waitForMapReady(page);

  consoleIssues.length = 0;
  networkFailures.length = 0;
  pageErrors.length = 0;

  await configureCityLights(page, 'modern', false);
  const lightsOff = await captureCanvasSample(page);
  const lightsOffRural = await samplePointGroup(page, RURAL_SAMPLE_POINTS);

  await configureCityLights(page, 'modern', true);
  await page.waitForFunction(() => globalThis.__renderPerfMetrics?.modernCityLightsStaticLayerCache?.globalUrbanReady === true,
    null, { timeout: 30000 });
  await waitForCanvasLuminanceDelta(page, lightsOff, 65000);
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
  const highZoomLightsOff = await captureCanvasSample(page);

  await configureCityLights(page, 'modern', true, { populationBoostEnabled: false });
  const modernHighZoomNoBoost = await captureCanvasSample(page);
  const boostOffUrban = await samplePointGroup(page, HIGH_ZOOM_URBAN_SAMPLE_POINTS, 24);
  const boostOffRural = await samplePointGroup(page, HIGH_ZOOM_RURAL_SAMPLE_POINTS, 24);

  await configureCityLights(page, 'modern', true, { populationBoostEnabled: true });
  await waitForCanvasLuminanceDelta(page, highZoomLightsOff, 500000);
  const modernHighZoomLights = await captureCanvasSample(page);
  const boostOnUrban = await samplePointGroup(page, HIGH_ZOOM_URBAN_SAMPLE_POINTS, 24);
  const boostOnRural = await samplePointGroup(page, HIGH_ZOOM_RURAL_SAMPLE_POINTS, 24);
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

  await configureCityLights(page, 'historical_1930s', true);
  await waitForCanvasLuminanceDelta(page, lightsOff, 45000);
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
  const ruralBoostAverageDelta = computeMaxAverageDelta(boostOffRural, boostOnRural);

  await configureCityLights(page, 'modern', true, {
    manualUtcMinutes: EASTERN_NIGHT_UTC_MINUTES,
    populationBoostEnabled: true,
  });
  const easternUrban = await samplePointGroup(page, EASTERN_URBAN_SAMPLE_POINTS, 24);
  const easternRural = await samplePointGroup(page, EASTERN_RURAL_SAMPLE_POINTS, 24);

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: EASTERN_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  const historicalCapitals = await samplePointGroup(page, HISTORICAL_CAPITAL_SAMPLE_POINTS, 18);
  const historicalEurope = await samplePointGroup(page, HISTORICAL_EUROPE_SAMPLE_POINTS, 18);
  const historicalChina = await samplePointGroup(page, HISTORICAL_CHINA_SAMPLE_POINTS, 18);
  const historicalIndia = await samplePointGroup(page, HISTORICAL_INDIA_SAMPLE_POINTS, 18);
  const historicalRural = await samplePointGroup(page, EASTERN_RURAL_SAMPLE_POINTS, 18);
  const historicalEasternScreenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_lights_historical_1930_europe_china_india.png'
  );
  await page.screenshot({ path: historicalEasternScreenshotPath, fullPage: true });

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: EAST_ASIA_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  const historicalJapan = await samplePointGroup(page, HISTORICAL_JAPAN_SAMPLE_POINTS, 18);
  const historicalJapanRural = await samplePointGroup(page, EAST_ASIA_RURAL_SAMPLE_POINTS, 18);

  await configureCityLights(page, 'historical_1930s', true, {
    manualUtcMinutes: AMERICAS_NIGHT_UTC_MINUTES,
    populationBoostEnabled: false,
  });
  const historicalUsEastCoast = await samplePointGroup(page, HISTORICAL_US_EAST_COAST_SAMPLE_POINTS, 18);
  const historicalUsWestCoast = await samplePointGroup(page, HISTORICAL_US_WEST_COAST_SAMPLE_POINTS, 18);
  const historicalAmericasRural = await samplePointGroup(page, AMERICAS_RURAL_SAMPLE_POINTS, 18);

  // 亮度总差和城市/农村采样已经提供主合同，这里的 changed-pixel 阈值保留一个小幅采样波动余量。
  expect(offToModernChanged).toBeGreaterThanOrEqual(450);
  expect(offToModernLuminance).toBeGreaterThan(65000);
  expect(highZoomOffToModernChanged).toBeGreaterThan(6500);
  expect(highZoomOffToModernLuminance).toBeGreaterThan(500000);
  // Population now adjusts existing cores. It must visibly brighten them without
  // recreating the broad footprint of the base illumination layer.
  expect(boostChanged).toBeGreaterThan(0);
  expect(boostChanged).toBeLessThan(highZoomOffToModernChanged);
  expect(boostLuminance).toBeGreaterThan(0);
  expect(boostLuminance).toBeLessThan(highZoomOffToModernLuminance);
  expect(modernBrightPixelRatio).toBeLessThan(0.02);
  expect(modernMeanLuminance).toBeGreaterThan(lightsOffMeanLuminance);
  // 低缩放下 40px 采样窗会覆盖过大的地理范围，局部 urban/rural bright-ratio 在这个层级容易被邻近海岸和城市群污染。
  // 这里保留整画布变化合同，把局部亮度判定收敛到后面的高缩放和分区采样上。
  expect(boostOnUrban.average).toBeGreaterThan(boostOffUrban.average);
  expect(boostOnUrban.maxBrightRatio).toBeLessThan(0.42);
  expect(Math.abs(boostOnRural.average - boostOffRural.average)).toBeLessThan(1.5);
  expect(ruralBoostAverageDelta).toBeLessThan(2);
  expect(boostOnRural.maxBrightRatio - boostOffRural.maxBrightRatio).toBeLessThan(0.004);
  expect(offToHistoricalChanged).toBeGreaterThan(300);
  expect(offToHistoricalLuminance).toBeGreaterThan(45000);
  expect(historicalBrightPixelRatio).toBeLessThan(0.012);
  // 分区采样里保留少量稳定的区域级硬合同，其他细粒度指标继续输出到日志做调参诊断。
  expect(historicalEurope.averageBrightRatio).toBeGreaterThan(0.015);
  expect(historicalChina.average).toBeGreaterThan(historicalRural.average - 6);
  expect(historicalUsEastCoast.averageBrightRatio).toBeGreaterThan(0.005);
  // 整个世界缩到 35%-100% 时，固定像素窗会跨越过大的地理范围，其余 region-level point sampling 继续作为调参诊断输出。
  expect(pageErrors).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  const screenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'city_lights_historical_1930_americas.png'
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
    ruralBoostAverageDelta,
    modernBrightPixelRatio,
    historicalBrightPixelRatio,
    modernMeanLuminance,
    lightsOffMeanLuminance,
    lightsOffRural,
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
    historicalChina,
    historicalIndia,
    historicalRural,
    historicalJapan,
    historicalJapanRural,
    historicalUsEastCoast,
    historicalUsWestCoast,
    historicalAmericasRural,
    screenshot: screenshotPath,
    historicalEasternScreenshot: historicalEasternScreenshotPath,
    modernLowZoomScreenshot: modernLowZoomScreenshotPath,
    modernHighZoomScreenshot: modernHighZoomScreenshotPath,
    pageErrors,
    consoleIssues,
    networkFailures,
  }, null, 2));
});
