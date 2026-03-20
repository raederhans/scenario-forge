const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_URL = process.env.MAPCREATOR_APP_URL || 'http://127.0.0.1:18080';
const IGNORED_CONSOLE_PATTERNS = [
  /\[map_renderer\] Scenario political background merge fallback engaged:/i,
];

test.setTimeout(120000);

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

function bucketForZoomPercent(percent) {
  const scale = Number(percent) / 100;
  if (scale < 1.4) return 'low';
  if (scale < 2.5) return 'mid';
  return 'high';
}

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    const canvas = Array.from(document.querySelectorAll('canvas'))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none');
    return !!select && select.querySelectorAll('option').length > 0 && !!canvas;
  });
  await page.waitForTimeout(1400);
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

async function setZoomPercent(page, percent) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import('/js/core/map_renderer.js');
    setZoomPercent(targetPercent);
  }, percent);
  await page.waitForTimeout(500);
}

async function readZoomState(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const scale = Math.max(0.01, Number(state.zoomTransform?.k) || 1);
    return {
      scale,
      percent: Math.round(scale * 100),
      showRivers: !!state.showRivers,
    };
  });
}

async function readRiverRenderMetric(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const direct = state.renderPerfMetrics?.drawRiversLayer || globalThis.__renderPerfMetrics?.drawRiversLayer || null;
    return direct ? {
      featureCount: Number(direct.featureCount || 0),
      visibleFeatureCount: Number(direct.visibleFeatureCount || 0),
      zoomBucket: String(direct.zoomBucket || ''),
      coreWidthFactor: Number(direct.coreWidthFactor || 0),
      outlineWidthFactor: Number(direct.outlineWidthFactor || 0),
      outlineAlphaFactor: Number(direct.outlineAlphaFactor || 0),
      skipped: !!direct.skipped,
      reason: String(direct.reason || ''),
    } : null;
  });
}

async function snapshotOriginalRivers(page) {
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    window.__riverRegressionOriginalRiversData = state.riversData;
  });
}

async function setRiverSubset(page, subsetName) {
  return page.evaluate(async (targetSubsetName) => {
    const { state } = await import('/js/core/state.js');
    const source = window.__riverRegressionOriginalRiversData || state.riversData;
    const features = Array.isArray(source?.features) ? source.features : [];
    const normalizeClass = (feature) => String(
      feature?.properties?.featurecla
      || feature?.properties?.FEATURECLA
      || ''
    ).trim();
    const normalizeRank = (feature) => {
      const props = feature?.properties || {};
      const value = Number(props.scalerank ?? props.SCALERANK ?? 8);
      return Number.isFinite(value) ? value : 8;
    };
    const normalizeMinZoom = (feature) => {
      const props = feature?.properties || {};
      const value = Number(props.min_zoom ?? props.minZoom);
      return Number.isFinite(value) ? value : Infinity;
    };
    const subset = features.filter((feature) => {
      const featureClass = normalizeClass(feature);
      const scalerank = normalizeRank(feature);
      const minZoom = normalizeMinZoom(feature);
      switch (targetSubsetName) {
        case 'river-major':
          return featureClass === 'River' && scalerank <= 5;
        case 'river-mid-tier':
          return featureClass === 'River' && scalerank >= 6 && scalerank <= 7;
        case 'river-all':
          return featureClass === 'River';
        case 'lake-centerline':
          return featureClass === 'Lake Centerline';
        case 'river-intermittent':
          return featureClass === 'River (Intermittent)';
        case 'canal':
          return featureClass === 'Canal';
        default:
          return featureClass === 'River' && scalerank <= 5 && minZoom <= 7.2;
      }
    });

    state.riversData = {
      type: 'FeatureCollection',
      features: subset,
    };
    state.topologyRevision = Number(state.topologyRevision || 0) + 1;
    state.renderNowFn?.();

    const counts = subset.reduce((acc, feature) => {
      const featureClass = normalizeClass(feature) || 'unknown';
      acc[featureClass] = (acc[featureClass] || 0) + 1;
      return acc;
    }, {});

    return {
      subset: targetSubsetName,
      total: subset.length,
      counts,
      sampleIds: subset.slice(0, 5).map((feature) => String(feature?.properties?.id || feature?.id || '')),
    };
  }, subsetName);
}

async function measureRiverInk(page, {
  zoomPercent,
  subsetName,
  label,
  captureScreenshot = false,
}) {
  await setZoomPercent(page, zoomPercent);
  const zoomState = await readZoomState(page);
  await setRiverSubset(page, subsetName);
  await setCheckbox(page, 'toggleRivers', true);
  await page.waitForTimeout(350);
  const renderMetric = await readRiverRenderMetric(page);

  const riversOn = await captureCanvasSample(page);
  let onShotPath = '';
  if (captureScreenshot) {
    onShotPath = path.join(
      '.runtime',
      'browser',
      'mcp-artifacts',
      'screenshots',
      `${label}_${subsetName}_on.png`
    );
    fs.mkdirSync(path.dirname(onShotPath), { recursive: true });
    await page.screenshot({ path: onShotPath, fullPage: true });
  }

  await setCheckbox(page, 'toggleRivers', false);
  await page.waitForTimeout(250);
  const riversOff = await captureCanvasSample(page);

  const changedPixels = countChangedPixels(riversOff.pixels, riversOn.pixels, 12);
  const luminanceDelta = computeLuminanceDelta(riversOff.pixels, riversOn.pixels);

  return {
    zoomState,
    renderMetric,
    changedPixels,
    luminanceDelta,
    screenshot: onShotPath,
    riversOn,
    riversOff,
  };
}

test('river layer zoom and class gating regression', async ({ page }) => {
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
  await snapshotOriginalRivers(page);

  consoleIssues.length = 0;
  networkFailures.length = 0;
  pageErrors.length = 0;

  const riverMajorLow = await measureRiverInk(page, {
    zoomPercent: 100,
    subsetName: 'river-major',
    label: 'river_layer_regression_low',
    captureScreenshot: true,
  });

  const riverToggleState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return { showRivers: !!state.showRivers };
  });
  expect(riverToggleState.showRivers).toBe(false);
  await setCheckbox(page, 'toggleRivers', true);
  await page.waitForTimeout(300);
  const riverToggleOnState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return { showRivers: !!state.showRivers };
  });
  expect(riverToggleOnState.showRivers).toBe(true);

  const riverMajorMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'river-major',
    label: 'river_layer_regression_mid',
    captureScreenshot: true,
  });
  const riverMajorHigh = await measureRiverInk(page, {
    zoomPercent: 260,
    subsetName: 'river-major',
    label: 'river_layer_regression_high',
    captureScreenshot: true,
  });
  const riverMidTierLow = await measureRiverInk(page, {
    zoomPercent: 100,
    subsetName: 'river-mid-tier',
    label: 'river_layer_regression_mid_tier_low',
  });
  const riverMidTierMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'river-mid-tier',
    label: 'river_layer_regression_mid_tier_mid',
  });
  const riverMidTierHigh = await measureRiverInk(page, {
    zoomPercent: 260,
    subsetName: 'river-mid-tier',
    label: 'river_layer_regression_mid_tier_high',
  });

  expect(riverMajorLow.zoomState.scale).toBeCloseTo(1.0, 2);
  expect(riverMajorMid.zoomState.scale).toBeCloseTo(1.5, 2);
  expect(riverMajorHigh.zoomState.scale).toBeCloseTo(2.6, 2);
  expect(bucketForZoomPercent(100)).toBe('low');
  expect(bucketForZoomPercent(150)).toBe('mid');
  expect(bucketForZoomPercent(260)).toBe('high');

  expect(riverMajorLow.changedPixels).toBeGreaterThan(0);
  expect(riverMajorMid.changedPixels).toBeGreaterThan(0);
  expect(riverMajorHigh.changedPixels).toBeGreaterThan(0);
  expect(riverMajorLow.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMajorMid.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMajorHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMajorLow.renderMetric.zoomBucket).toBe('low');
  expect(riverMajorMid.renderMetric.zoomBucket).toBe('mid');
  expect(riverMajorHigh.renderMetric.zoomBucket).toBe('high');
  expect(riverMajorLow.renderMetric.coreWidthFactor).toBeCloseTo(1.2, 4);
  expect(riverMajorMid.renderMetric.coreWidthFactor).toBeCloseTo(1.0, 4);
  expect(riverMajorHigh.renderMetric.coreWidthFactor).toBeCloseTo(0.75, 4);
  expect(riverMajorLow.renderMetric.outlineWidthFactor).toBeCloseTo(0.85, 4);
  expect(riverMajorMid.renderMetric.outlineWidthFactor).toBeCloseTo(0.7, 4);
  expect(riverMajorHigh.renderMetric.outlineWidthFactor).toBeCloseTo(0.35, 4);
  expect(riverMajorLow.renderMetric.outlineAlphaFactor).toBeCloseTo(0.6, 4);
  expect(riverMajorMid.renderMetric.outlineAlphaFactor).toBeCloseTo(0.7, 4);
  expect(riverMajorHigh.renderMetric.outlineAlphaFactor).toBeCloseTo(0.45, 4);

  expect(riverMidTierLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(riverMidTierMid.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMidTierHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMidTierLow.changedPixels).toBeLessThan(12);
  expect(riverMidTierMid.changedPixels).toBeGreaterThan(20);
  expect(riverMidTierHigh.changedPixels).toBeGreaterThan(10);

  const lakeLow = await measureRiverInk(page, {
    zoomPercent: 100,
    subsetName: 'lake-centerline',
    label: 'river_layer_regression_lake_low',
  });
  const lakeMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'lake-centerline',
    label: 'river_layer_regression_lake_mid',
  });
  const lakeHigh = await measureRiverInk(page, {
    zoomPercent: 260,
    subsetName: 'lake-centerline',
    label: 'river_layer_regression_lake_high',
  });

  const intermittentLow = await measureRiverInk(page, {
    zoomPercent: 100,
    subsetName: 'river-intermittent',
    label: 'river_layer_regression_intermittent_low',
  });
  const intermittentMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'river-intermittent',
    label: 'river_layer_regression_intermittent_mid',
  });
  const intermittentHigh = await measureRiverInk(page, {
    zoomPercent: 260,
    subsetName: 'river-intermittent',
    label: 'river_layer_regression_intermittent_high',
  });

  const canalLow = await measureRiverInk(page, {
    zoomPercent: 100,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_low',
  });
  const canalMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_mid',
  });
  const canalHigh = await measureRiverInk(page, {
    zoomPercent: 260,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_high',
  });

  expect(lakeLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(lakeMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(lakeHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);

  expect(intermittentLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(intermittentMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(intermittentHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);

  expect(canalLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(canalMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(canalHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);

  const finalRiverState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      showRivers: !!state.showRivers,
      riverCount: Array.isArray(state.riversData?.features) ? state.riversData.features.length : 0,
      zoomPercent: Math.round(Math.max(0.01, Number(state.zoomTransform?.k) || 1) * 100),
    };
  });

  expect(finalRiverState.showRivers).toBe(false);
  expect(finalRiverState.riverCount).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const source = window.__riverRegressionOriginalRiversData || state.riversData;
    state.riversData = source;
    state.topologyRevision = Number(state.topologyRevision || 0) + 1;
    state.renderNowFn?.();
  });
  await setCheckbox(page, 'toggleRivers', true);
  await page.waitForTimeout(700);

  const finalScreenshotPath = path.join(
    '.runtime',
    'browser',
    'mcp-artifacts',
    'screenshots',
    'river_layer_regression_final.png'
  );
  fs.mkdirSync(path.dirname(finalScreenshotPath), { recursive: true });
  await page.screenshot({ path: finalScreenshotPath, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(consoleIssues).toEqual([]);
  expect(networkFailures).toEqual([]);

  console.log(JSON.stringify({
    riverMajorLow: {
      zoomState: riverMajorLow.zoomState,
      renderMetric: riverMajorLow.renderMetric,
      changedPixels: riverMajorLow.changedPixels,
      luminanceDelta: riverMajorLow.luminanceDelta,
      screenshot: riverMajorLow.screenshot,
    },
    riverMajorMid: {
      zoomState: riverMajorMid.zoomState,
      renderMetric: riverMajorMid.renderMetric,
      changedPixels: riverMajorMid.changedPixels,
      luminanceDelta: riverMajorMid.luminanceDelta,
      screenshot: riverMajorMid.screenshot,
    },
    riverMajorHigh: {
      zoomState: riverMajorHigh.zoomState,
      renderMetric: riverMajorHigh.renderMetric,
      changedPixels: riverMajorHigh.changedPixels,
      luminanceDelta: riverMajorHigh.luminanceDelta,
      screenshot: riverMajorHigh.screenshot,
    },
    riverMidTierLow: {
      renderMetric: riverMidTierLow.renderMetric,
      changedPixels: riverMidTierLow.changedPixels,
      luminanceDelta: riverMidTierLow.luminanceDelta,
      screenshot: riverMidTierLow.screenshot,
    },
    riverMidTierMid: {
      renderMetric: riverMidTierMid.renderMetric,
      changedPixels: riverMidTierMid.changedPixels,
      luminanceDelta: riverMidTierMid.luminanceDelta,
      screenshot: riverMidTierMid.screenshot,
    },
    riverMidTierHigh: {
      renderMetric: riverMidTierHigh.renderMetric,
      changedPixels: riverMidTierHigh.changedPixels,
      luminanceDelta: riverMidTierHigh.luminanceDelta,
      screenshot: riverMidTierHigh.screenshot,
    },
    lakeLow: {
      renderMetric: lakeLow.renderMetric,
      changedPixels: lakeLow.changedPixels,
      luminanceDelta: lakeLow.luminanceDelta,
      screenshot: lakeLow.screenshot,
    },
    lakeMid: {
      renderMetric: lakeMid.renderMetric,
      changedPixels: lakeMid.changedPixels,
      luminanceDelta: lakeMid.luminanceDelta,
      screenshot: lakeMid.screenshot,
    },
    lakeHigh: {
      renderMetric: lakeHigh.renderMetric,
      changedPixels: lakeHigh.changedPixels,
      luminanceDelta: lakeHigh.luminanceDelta,
      screenshot: lakeHigh.screenshot,
    },
    intermittentLow: {
      renderMetric: intermittentLow.renderMetric,
      changedPixels: intermittentLow.changedPixels,
      luminanceDelta: intermittentLow.luminanceDelta,
      screenshot: intermittentLow.screenshot,
    },
    intermittentMid: {
      renderMetric: intermittentMid.renderMetric,
      changedPixels: intermittentMid.changedPixels,
      luminanceDelta: intermittentMid.luminanceDelta,
      screenshot: intermittentMid.screenshot,
    },
    intermittentHigh: {
      renderMetric: intermittentHigh.renderMetric,
      changedPixels: intermittentHigh.changedPixels,
      luminanceDelta: intermittentHigh.luminanceDelta,
      screenshot: intermittentHigh.screenshot,
    },
    canalLow: {
      renderMetric: canalLow.renderMetric,
      changedPixels: canalLow.changedPixels,
      luminanceDelta: canalLow.luminanceDelta,
      screenshot: canalLow.screenshot,
    },
    canalMid: {
      renderMetric: canalMid.renderMetric,
      changedPixels: canalMid.changedPixels,
      luminanceDelta: canalMid.luminanceDelta,
      screenshot: canalMid.screenshot,
    },
    canalHigh: {
      renderMetric: canalHigh.renderMetric,
      changedPixels: canalHigh.changedPixels,
      luminanceDelta: canalHigh.luminanceDelta,
      screenshot: canalHigh.screenshot,
    },
    finalRiverState,
    finalScreenshot: finalScreenshotPath,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    pageErrors,
    consoleIssues,
    networkFailures,
  }, null, 2));
});
