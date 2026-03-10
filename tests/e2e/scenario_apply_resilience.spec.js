const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const APP_URL = 'http://127.0.0.1:18080';

test('scenario apply rollback keeps prior stable state on palette failure', async ({ page }) => {
  const pageErrors = [];
  const unhandledConsoleErrors = [];
  let forcedPaletteFailureCount = 0;
  let shouldAbortTnoPalette = false;

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || error));
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && /unhandled|uncaught|rejection/i.test(text)) {
      unhandledConsoleErrors.push(text);
    }
  });

  await page.route('**/data/palettes/tno.palette.json', async (route) => {
    if (shouldAbortTnoPalette && forcedPaletteFailureCount === 0) {
      forcedPaletteFailureCount += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector('option[value="hoi4_1939"]') && !!select.querySelector('option[value="tno_1962"]');
  });

  await page.selectOption('#scenarioSelect', 'hoi4_1939');
  const applyVisible = await page.locator('#applyScenarioBtn').isVisible();
  if (applyVisible) {
    await page.click('#applyScenarioBtn');
  }
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    if (state.palettePackCacheById && typeof state.palettePackCacheById === 'object') {
      delete state.palettePackCacheById.tno;
    }
    if (state.paletteMapCacheById && typeof state.paletteMapCacheById === 'object') {
      delete state.paletteMapCacheById.tno;
    }
  });
  shouldAbortTnoPalette = true;

  await page.selectOption('#scenarioSelect', 'tno_1962');
  await page.click('#applyScenarioBtn');
  await page.waitForTimeout(1500);
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  const stateAfterFailure = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      statusText: document.querySelector('#scenarioStatus')?.textContent || '',
    };
  });

  await page.selectOption('#scenarioSelect', 'hoi4_1939');
  const finalApplyVisible = await page.locator('#applyScenarioBtn').isVisible();
  if (finalApplyVisible) {
    await page.click('#applyScenarioBtn');
  }
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  const finalState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      statusText: document.querySelector('#scenarioStatus')?.textContent || '',
    };
  });

  expect(forcedPaletteFailureCount).toBe(1);
  expect(pageErrors).toEqual([]);
  expect(unhandledConsoleErrors).toEqual([]);
  expect(stateAfterFailure.activeScenarioId).toBe('hoi4_1939');
  expect(stateAfterFailure.manifestScenarioId).toBe('hoi4_1939');
  expect(stateAfterFailure.statusText).toContain('HOI4 1939');
  expect(finalState.activeScenarioId).toBe('hoi4_1939');
  expect(finalState.manifestScenarioId).toBe('hoi4_1939');
  expect(finalState.statusText).toContain('HOI4 1939');

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'scenario_apply_resilience.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    forcedPaletteFailureCount,
    pageErrors,
    unhandledConsoleErrors,
    stateAfterFailure,
    finalState,
    screenshot: shotPath,
  }, null, 2));
});
