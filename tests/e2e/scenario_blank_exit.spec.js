const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { getAppUrl } = require("./support/playwright-app");

function resolveBaseUrl() {
  return getAppUrl();
}

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

async function waitForMapReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    const canvas = Array.from(document.querySelectorAll('canvas'))
      .find((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none');
    return !!select && select.querySelectorAll('option').length > 0 && !!canvas;
  });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return !!state.scenarioApplyInFlight;
  }), { timeout: 30000 }).toBe(false);
  await page.waitForTimeout(1500);
}

async function waitForDefaultScenario(page) {
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 30000 }).toEqual({
    activeScenarioId: 'tno_1962',
    scenarioApplyInFlight: false,
  });
  await page.waitForTimeout(1200);
}

async function ensureScenario(page, scenarioId) {
  await page.evaluate(async (targetScenarioId) => {
    const { applyScenarioById } = await import('/js/core/scenario_manager.js');
    await applyScenarioById(targetScenarioId, {
      renderNow: true,
      markDirtyReason: '',
      showToastOnComplete: false,
    });
  }, scenarioId);

  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 30000 }).toEqual({
    activeScenarioId: scenarioId,
    scenarioApplyInFlight: false,
  });
  await page.waitForTimeout(1200);
}

async function resetScenario(page) {
  await page.evaluate(async () => {
    const { resetToScenarioBaseline } = await import('/js/core/scenario_manager.js');
    resetToScenarioBaseline({ renderNow: true });
  });
  await page.waitForTimeout(1200);
}

async function clearScenario(page) {
  await page.evaluate(async () => {
    const { clearActiveScenario } = await import('/js/core/scenario_manager.js');
    clearActiveScenario({ renderNow: true });
  });
  await page.waitForTimeout(1200);
}

async function captureCanvasSample(page) {
  return page.evaluate(() => {
    const source = Array.from(document.querySelectorAll('canvas'))
      .filter((entry) => entry.width >= 200 && entry.height >= 120 && getComputedStyle(entry).display !== 'none')
      .sort((left, right) => (right.width * right.height) - (left.width * left.height))[0];
    if (!source) {
      throw new Error('No visible map canvas found');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  });
}

async function getBlankStateSnapshot(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      mapSemanticMode: String(state.mapSemanticMode || ''),
      activeSovereignCode: String(state.activeSovereignCode || ''),
      sovereigntyCount: Object.keys(state.sovereigntyByFeatureId || {}).length,
      controllerCount: Object.keys(state.scenarioControllersByFeatureId || {}).length,
      showCityPoints: !!state.showCityPoints,
      hasScenarioGeoLocalePatch: !!state.scenarioGeoLocalePatchData,
      hasScenarioCityOverrides: !!state.scenarioCityOverridesData,
    };
  });
}

test('blank_base stays empty and exiting scenarios returns to the same blank canvas', async ({ page }) => {
  const APP_URL = resolveBaseUrl();
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || error));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await waitForMapReady(page);
  await waitForDefaultScenario(page);

  await ensureScenario(page, 'blank_base');

  const blankScenarioState = await getBlankStateSnapshot(page);
  expect(blankScenarioState).toEqual({
    activeScenarioId: 'blank_base',
    mapSemanticMode: 'blank',
    activeSovereignCode: '',
    sovereigntyCount: 0,
    controllerCount: 0,
    showCityPoints: false,
    hasScenarioGeoLocalePatch: false,
    hasScenarioCityOverrides: false,
  });

  const blankScenarioPixels = await captureCanvasSample(page);

  const manualPaint = await page.evaluate(async () => {
    const { render } = await import('/js/core/map_renderer.js');
    const { state } = await import('/js/core/state.js');
    const { getFeatureOwnerCode, getFeatureId, setFeatureOwnerCode } = await import('/js/core/sovereignty_manager.js');
    const targetFeature = Array.isArray(state.landData?.features)
      ? state.landData.features.find((feature) => {
        const featureId = getFeatureId(feature);
        const countryCode = String(feature?.properties?.cntr_code || '').trim().toUpperCase();
        return !!featureId && countryCode && countryCode !== 'AQ';
      })
      : null;
    if (!targetFeature) {
      throw new Error('No editable feature found for blank map paint regression.');
    }
    const featureId = getFeatureId(targetFeature);
    const changed = setFeatureOwnerCode(featureId, 'US');
    render();
    return {
      changed,
      featureId,
      ownerCode: getFeatureOwnerCode(featureId, { skipEnsure: false }),
      sovereigntyCount: Object.keys(state.sovereigntyByFeatureId || {}).length,
      mapSemanticMode: String(state.mapSemanticMode || ''),
    };
  });
  await page.waitForTimeout(800);

  expect(manualPaint.changed).toBe(true);
  expect(manualPaint.ownerCode).toBe('US');
  expect(manualPaint.sovereigntyCount).toBe(1);
  expect(manualPaint.mapSemanticMode).toBe('blank');

  await resetScenario(page);

  const resetBlankScenarioState = await getBlankStateSnapshot(page);
  expect(resetBlankScenarioState).toEqual({
    activeScenarioId: 'blank_base',
    mapSemanticMode: 'blank',
    activeSovereignCode: '',
    sovereigntyCount: 0,
    controllerCount: 0,
    showCityPoints: false,
    hasScenarioGeoLocalePatch: false,
    hasScenarioCityOverrides: false,
  });

  await ensureScenario(page, 'tno_1962');
  await clearScenario(page);

  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      mapSemanticMode: String(state.mapSemanticMode || ''),
      activeSovereignCode: String(state.activeSovereignCode || ''),
      sovereigntyCount: Object.keys(state.sovereigntyByFeatureId || {}).length,
      controllerCount: Object.keys(state.scenarioControllersByFeatureId || {}).length,
      showCityPoints: !!state.showCityPoints,
      hasScenarioGeoLocalePatch: !!state.scenarioGeoLocalePatchData,
      hasScenarioCityOverrides: !!state.scenarioCityOverridesData,
    };
  }), { timeout: 30000 }).toEqual({
    activeScenarioId: '',
    mapSemanticMode: 'blank',
    activeSovereignCode: '',
    sovereigntyCount: 0,
    controllerCount: 0,
    showCityPoints: false,
    hasScenarioGeoLocalePatch: false,
    hasScenarioCityOverrides: false,
  });
  await page.waitForTimeout(1200);

  const clearedBlankPixels = await captureCanvasSample(page);
  const blankCanvasDelta = countChangedPixels(blankScenarioPixels, clearedBlankPixels, 10);

  expect(blankCanvasDelta).toBeLessThan(250);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
