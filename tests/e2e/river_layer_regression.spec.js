const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  getAppUrl,
  waitForAppInteractive,
  waitForShellReady,
  waitForScenarioApplyIdle,
  waitForRenderIdle,
} = require("./support/playwright-app");
const { getConsoleIgnorePatterns } = require("./support/expectations/console-allowlist");

const APP_URL = getAppUrl();
const SCENARIO_ID = "tno_1962";
const IGNORED_CONSOLE_PATTERNS = getConsoleIgnorePatterns(__filename);

// 每条河流回归按一个语义边界串行执行，最多覆盖 6 组 zoom/subset 组合。
// 当前主线程渲染与像素采样在本机稳定需要 2 分钟以上，因此每条保留 4 分钟预算，
// 继续让断言负责功能正确性，避免聚合工作量在完成前耗尽统一预算。
test.setTimeout(240000);

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
  if (scale < 5) return 'high';
  return 'detail';
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

async function setRiversVisibleForRegression(page, checked) {
  await page.evaluate(async (targetChecked) => {
    const { state } = await import('/js/core/state.js');
    const input = document.getElementById('toggleRivers');
    if (!input) {
      throw new Error('Missing checkbox: toggleRivers');
    }

    // These river zoom-gating checks replace state.riversData with a synthetic subset.
    // The toolbar change handler refreshes the full context layer, so this helper only
    // flips the render flag and keeps the injected subset as the render source.
    input.checked = !!targetChecked;
    state.showRivers = !!targetChecked;
    state.renderNowFn?.();
  }, checked);
  await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: 30_000 });
}

async function setZoomPercent(page, percent, { renderIdleTimeout = 30_000 } = {}) {
  await page.evaluate(async (targetPercent) => {
    const { setZoomPercent } = await import('/js/core/map_renderer.js');
    setZoomPercent(targetPercent);
  }, percent);
  await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: renderIdleTimeout });
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

async function readRiverDataState(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      featureCount: Array.isArray(state.riversData?.features) ? state.riversData.features.length : 0,
      showRivers: !!state.showRivers,
    };
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
    if (state.renderPerfMetrics && typeof state.renderPerfMetrics === 'object') {
      delete state.renderPerfMetrics.drawRiversLayer;
    }
    if (globalThis.__renderPerfMetrics && typeof globalThis.__renderPerfMetrics === 'object') {
      delete globalThis.__renderPerfMetrics.drawRiversLayer;
    }
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
  zoomRenderIdleTimeout = 30_000,
}) {
  await setRiversVisibleForRegression(page, false);
  await setZoomPercent(page, zoomPercent, { renderIdleTimeout: zoomRenderIdleTimeout });
  const zoomState = await readZoomState(page);
  const subsetState = await setRiverSubset(page, subsetName);
  await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: 30_000 });
  let riverDataState = await readRiverDataState(page);
  if (riverDataState.featureCount !== subsetState.total) {
    await setRiverSubset(page, subsetName);
    await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: 30_000 });
    riverDataState = await readRiverDataState(page);
  }
  expect(riverDataState.featureCount).toBe(subsetState.total);
  await setRiversVisibleForRegression(page, true);
  const firstRenderMetric = await readRiverRenderMetric(page);
  if (firstRenderMetric?.featureCount !== subsetState.total) {
    await setRiverSubset(page, subsetName);
    await setRiversVisibleForRegression(page, true);
  }
  const expectedZoomBucket = bucketForZoomPercent(zoomPercent);
  await expect.poll(async () => readRiverRenderMetric(page), {
    timeout: 8000,
  }).toMatchObject({
    featureCount: subsetState.total,
    zoomBucket: expectedZoomBucket,
    skipped: false,
  });
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

  await setRiversVisibleForRegression(page, false);
  const riversOff = await captureCanvasSample(page);

  const changedPixels = countChangedPixels(riversOff.pixels, riversOn.pixels, 12);
  const luminanceDelta = computeLuminanceDelta(riversOff.pixels, riversOn.pixels);

  return {
    subsetState,
    zoomState,
    renderMetric,
    changedPixels,
    luminanceDelta,
    screenshot: onShotPath,
    riversOn,
    riversOff,
  };
}

function attachRiverIssueTrackers(page) {
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

  return {
    consoleIssues,
    networkFailures,
    pageErrors,
  };
}

async function beginRiverRegression(page) {
  const trackers = attachRiverIssueTrackers(page);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page, { timeout: 120_000 });
  await waitForShellReady(page, { timeout: 120_000, requireCanvas: true });
  await waitForMapReady(page);
  await ensureScenario(page, SCENARIO_ID);
  await waitForScenarioApplyIdle(page, { scenarioId: SCENARIO_ID, timeout: 120_000 });
  await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: 120_000 });
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    if (typeof state.ensureContextLayerDataFn === 'function') {
      await state.ensureContextLayerDataFn('rivers', {
        reason: 'river-regression-bootstrap',
        renderNow: false,
      });
    }
  });
  await waitForRenderIdle(page, { scenarioId: SCENARIO_ID, timeout: 120_000 });
  await snapshotOriginalRivers(page);

  trackers.consoleIssues.length = 0;
  trackers.networkFailures.length = 0;
  trackers.pageErrors.length = 0;
  return trackers;
}

async function restoreRiverRegressionState(page, { captureFinalScreenshot = false } = {}) {
  const finalRiverState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      showRivers: !!state.showRivers,
      riverCount: Array.isArray(state.riversData?.features) ? state.riversData.features.length : 0,
      zoomPercent: Math.round(Math.max(0.01, Number(state.zoomTransform?.k) || 1) * 100),
    };
  });

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const source = window.__riverRegressionOriginalRiversData || state.riversData;
    state.riversData = source;
    state.topologyRevision = Number(state.topologyRevision || 0) + 1;
    state.renderNowFn?.();
  });
  await setRiversVisibleForRegression(page, true);
  const restoredRiverState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const original = window.__riverRegressionOriginalRiversData || state.riversData;
    return {
      showRivers: !!state.showRivers,
      riverCount: Array.isArray(state.riversData?.features) ? state.riversData.features.length : 0,
      originalCount: Array.isArray(original?.features) ? original.features.length : 0,
    };
  });

  let finalScreenshotPath = '';
  if (captureFinalScreenshot) {
    finalScreenshotPath = path.join(
      '.runtime',
      'browser',
      'mcp-artifacts',
      'screenshots',
      'river_layer_regression_final.png'
    );
    fs.mkdirSync(path.dirname(finalScreenshotPath), { recursive: true });
    await page.screenshot({ path: finalScreenshotPath, fullPage: true });
  }

  expect(finalRiverState.showRivers).toBe(false);
  expect(finalRiverState.riverCount).toBeGreaterThan(0);
  expect(restoredRiverState.showRivers).toBe(true);
  expect(restoredRiverState.riverCount).toBe(restoredRiverState.originalCount);
  return {
    finalRiverState,
    restoredRiverState,
    finalScreenshotPath,
  };
}

function expectNoRiverRuntimeIssues(trackers) {
  expect(trackers.pageErrors).toEqual([]);
  expect(trackers.consoleIssues).toEqual([]);
  expect(trackers.networkFailures).toEqual([]);
}

test('river layer major zoom gating regression', async ({ page }) => {
  const trackers = await beginRiverRegression(page);

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
    zoomRenderIdleTimeout: 45_000,
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
  expect(riverMajorLow.renderMetric.coreWidthFactor).toBeCloseTo(1.3, 4);
  expect(riverMajorMid.renderMetric.coreWidthFactor).toBeCloseTo(1.2, 4);
  expect(riverMajorHigh.renderMetric.coreWidthFactor).toBeCloseTo(1.2, 4);
  expect(riverMajorLow.renderMetric.outlineWidthFactor).toBeCloseTo(0.55, 4);
  expect(riverMajorMid.renderMetric.outlineWidthFactor).toBeCloseTo(0.5, 4);
  expect(riverMajorHigh.renderMetric.outlineWidthFactor).toBeCloseTo(0.4, 4);
  expect(riverMajorLow.renderMetric.outlineAlphaFactor).toBeCloseTo(0.38, 4);
  expect(riverMajorMid.renderMetric.outlineAlphaFactor).toBeCloseTo(0.42, 4);
  expect(riverMajorHigh.renderMetric.outlineAlphaFactor).toBeCloseTo(0.35, 4);

  const { finalRiverState } = await restoreRiverRegressionState(page);
  expectNoRiverRuntimeIssues(trackers);

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
    finalRiverState,
  }, null, 2));
});

test('river layer mid-tier zoom gating regression', async ({ page }) => {
  const trackers = await beginRiverRegression(page);

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

  expect(riverMidTierLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(riverMidTierLow.renderMetric.featureCount).toBeGreaterThan(0);
  expect(riverMidTierMid.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMidTierHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);
  expect(riverMidTierMid.changedPixels).toBeGreaterThan(20);
  expect(riverMidTierHigh.changedPixels).toBeGreaterThan(10);

  const { finalRiverState } = await restoreRiverRegressionState(page);
  expectNoRiverRuntimeIssues(trackers);

  console.log(JSON.stringify({
    riverMidTierLow: {
      renderMetric: riverMidTierLow.renderMetric,
      changedPixels: riverMidTierLow.changedPixels,
      luminanceDelta: riverMidTierLow.luminanceDelta,
    },
    riverMidTierMid: {
      renderMetric: riverMidTierMid.renderMetric,
      changedPixels: riverMidTierMid.changedPixels,
      luminanceDelta: riverMidTierMid.luminanceDelta,
    },
    riverMidTierHigh: {
      renderMetric: riverMidTierHigh.renderMetric,
      changedPixels: riverMidTierHigh.changedPixels,
      luminanceDelta: riverMidTierHigh.luminanceDelta,
    },
    finalRiverState,
  }, null, 2));
});

test('river layer lake zoom gating regression', async ({ page }) => {
  const trackers = await beginRiverRegression(page);

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
  const lakeDetail = await measureRiverInk(page, {
    zoomPercent: 500,
    subsetName: 'lake-centerline',
    label: 'river_layer_regression_lake_detail',
  });

  expect(lakeLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(lakeMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(lakeDetail.renderMetric.zoomBucket).toBe('detail');
  expect(lakeDetail.renderMetric.visibleFeatureCount).toBe(0);

  const { finalRiverState } = await restoreRiverRegressionState(page);
  expectNoRiverRuntimeIssues(trackers);

  console.log(JSON.stringify({
    lakeLow: {
      renderMetric: lakeLow.renderMetric,
      changedPixels: lakeLow.changedPixels,
      luminanceDelta: lakeLow.luminanceDelta,
    },
    lakeMid: {
      renderMetric: lakeMid.renderMetric,
      changedPixels: lakeMid.changedPixels,
      luminanceDelta: lakeMid.luminanceDelta,
    },
    lakeDetail: {
      renderMetric: lakeDetail.renderMetric,
      changedPixels: lakeDetail.changedPixels,
      luminanceDelta: lakeDetail.luminanceDelta,
    },
    finalRiverState,
  }, null, 2));
});

test('river layer intermittent zoom gating regression', async ({ page }) => {
  const trackers = await beginRiverRegression(page);

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

  expect(intermittentLow.renderMetric.visibleFeatureCount).toBe(0);
  expect(intermittentMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(intermittentHigh.renderMetric.visibleFeatureCount).toBeGreaterThan(0);

  const { finalRiverState } = await restoreRiverRegressionState(page);
  expectNoRiverRuntimeIssues(trackers);

  console.log(JSON.stringify({
    intermittentLow: {
      renderMetric: intermittentLow.renderMetric,
      changedPixels: intermittentLow.changedPixels,
      luminanceDelta: intermittentLow.luminanceDelta,
    },
    intermittentMid: {
      renderMetric: intermittentMid.renderMetric,
      changedPixels: intermittentMid.changedPixels,
      luminanceDelta: intermittentMid.luminanceDelta,
    },
    intermittentHigh: {
      renderMetric: intermittentHigh.renderMetric,
      changedPixels: intermittentHigh.changedPixels,
      luminanceDelta: intermittentHigh.luminanceDelta,
    },
    finalRiverState,
  }, null, 2));
});

test('river layer canal zoom gating regression', async ({ page }) => {
  const trackers = await beginRiverRegression(page);

  const canalMid = await measureRiverInk(page, {
    zoomPercent: 150,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_mid',
  });
  const canalHigh = await measureRiverInk(page, {
    zoomPercent: 490,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_high',
  });

  const canalDetail = await measureRiverInk(page, {
    zoomPercent: 500,
    subsetName: 'canal',
    label: 'river_layer_regression_canal_detail',
  });

  expect(canalMid.renderMetric.visibleFeatureCount).toBe(0);
  expect(canalHigh.renderMetric.visibleFeatureCount).toBe(0);
  expect(canalHigh.renderMetric.zoomBucket).toBe('high');
  expect(canalDetail.renderMetric.zoomBucket).toBe('detail');
  expect(canalDetail.renderMetric.featureCount).toBeGreaterThan(0);

  const { finalRiverState, finalScreenshotPath } = await restoreRiverRegressionState(page, {
    captureFinalScreenshot: true,
  });
  expectNoRiverRuntimeIssues(trackers);

  console.log(JSON.stringify({
    canalMid: {
      renderMetric: canalMid.renderMetric,
      changedPixels: canalMid.changedPixels,
      luminanceDelta: canalMid.luminanceDelta,
    },
    canalHigh: {
      renderMetric: canalHigh.renderMetric,
      changedPixels: canalHigh.changedPixels,
      luminanceDelta: canalHigh.luminanceDelta,
    },
    canalDetail: {
      renderMetric: canalDetail.renderMetric,
      changedPixels: canalDetail.changedPixels,
      luminanceDelta: canalDetail.luminanceDelta,
    },
    finalRiverState,
    finalScreenshot: finalScreenshotPath,
    consoleIssueCount: trackers.consoleIssues.length,
    networkFailureCount: trackers.networkFailures.length,
    pageErrors: trackers.pageErrors,
    consoleIssues: trackers.consoleIssues,
    networkFailures: trackers.networkFailures,
  }, null, 2));
});
