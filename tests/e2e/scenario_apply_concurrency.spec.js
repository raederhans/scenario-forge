const { test, expect } = require("@playwright/test");
const { getAppUrl, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(90_000);

const APP_URL = getAppUrl();

async function waitForScenarioControlsReady(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const select = document.querySelector("#scenarioSelect");
    const applyButton = document.querySelector("#applyScenarioBtn");
    return !!select
      && !!applyButton
      && select.querySelectorAll("option").length > 0;
  }, { timeout: 60_000 });
  await waitForAppInteractive(page, { timeout: 60_000 });
  await page.evaluate(() => {
    document.querySelector("#scenarioSelect")?.closest("details")?.setAttribute("open", "");
  });
  await expect(page.locator("#scenarioSelect")).toBeVisible();
}

test('scenario apply is single-flight and english ui uses entry.en overrides', async ({ page }) => {
  const pageErrors = [];
  const unhandledConsoleErrors = [];

  page.on('pageerror', (error) => {
    pageErrors.push(String(error?.message || error));
  });

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && /unhandled|uncaught|rejection/i.test(text)) {
      unhandledConsoleErrors.push(text);
    }
  });

  await waitForScenarioControlsReady(page);

  await page.evaluate(async () => {
    const { applyScenarioByIdCommand } = await import('/js/core/scenario_dispatcher.js');
    await applyScenarioByIdCommand('hoi4_1939', {
      renderMode: 'request',
      markDirtyReason: '',
      showToastOnComplete: false,
    });
  });
  await expect.poll(async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      scenarioApplyInFlight: !!state.scenarioApplyInFlight,
    };
  }), { timeout: 45_000 }).toEqual({
    activeScenarioId: 'hoi4_1939',
    scenarioApplyInFlight: false,
  });
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  await page.evaluate(() => {
    document.querySelector('#scenarioSelect')?.closest('details')?.setAttribute('open', '');
    const select = document.querySelector('#scenarioSelect');
    if (select instanceof HTMLSelectElement) {
      select.value = 'tno_1962';
    }
  });
  const manualInFlightButtonState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    state.scenarioApplyInFlight = true;
    if (typeof state.updateScenarioUIFn === 'function') {
      state.updateScenarioUIFn();
    }
    const snapshot = {
      applyDisabled: !!document.querySelector('#applyScenarioBtn')?.disabled,
      resetDisabled: !!document.querySelector('#resetScenarioBtn')?.disabled,
      clearDisabled: !!document.querySelector('#clearScenarioBtn')?.disabled,
    };
    state.scenarioApplyInFlight = false;
    if (typeof state.updateScenarioUIFn === 'function') {
      state.updateScenarioUIFn();
    }
    return snapshot;
  });
  expect(manualInFlightButtonState).toEqual({
    applyDisabled: true,
    resetDisabled: true,
    clearDisabled: true,
  });

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    if (state.scenarioBundleCacheById && typeof state.scenarioBundleCacheById === 'object') {
      delete state.scenarioBundleCacheById.tno_1962;
    }
  });

  await page.evaluate(() => {
    if (globalThis.__scenarioTestJsonWrapperInstalled) return;
    const originalJson = globalThis.d3?.json?.bind(globalThis.d3);
    if (typeof originalJson !== 'function') {
      throw new Error('d3.json is not available for scenario test instrumentation.');
    }
    globalThis.__scenarioTestJsonCounters = {
      manifest: 0,
    };
    globalThis.d3.json = async (...args) => {
      const url = String(args[0] || '');
      if (url.includes('data/scenarios/tno_1962/manifest.json')) {
        globalThis.__scenarioTestJsonCounters.manifest += 1;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      return originalJson(...args);
    };
    globalThis.__scenarioTestJsonWrapperInstalled = true;
  });
  await page.evaluate(() => {
    const button = document.querySelector('#applyScenarioBtn');
    if (!button) return;
    const eventOptions = { bubbles: true, cancelable: true };
    button.dispatchEvent(new MouseEvent('click', eventOptions));
    button.dispatchEvent(new MouseEvent('click', eventOptions));
  });

  await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 30000 });

  const scenarioState = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      scenarioApplyInFlight: state.scenarioApplyInFlight,
      applyDisabled: !!document.querySelector('#applyScenarioBtn')?.disabled,
      resetDisabled: !!document.querySelector('#resetScenarioBtn')?.disabled,
      clearDisabled: !!document.querySelector('#clearScenarioBtn')?.disabled,
    };
  });
  const requestCounters = await page.evaluate(() => ({ ...(globalThis.__scenarioTestJsonCounters || {}) }));

  const englishOverride = await page.evaluate(async () => {
    const { t } = await import('/js/ui/i18n.js');
    return {
      setActive: t('Set Active', 'ui'),
      scenarioGuide: t(
        'Scenario loaded. 1) Select a country 2) Set Active 3) Apply Core/Presets.',
        'ui'
      ),
    };
  });

  // Bundle caching may satisfy the second scenario switch without a manifest round-trip.
  expect(Number(requestCounters.manifest || 0)).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
  expect(unhandledConsoleErrors).toEqual([]);
  expect(scenarioState.activeScenarioId).toBe('tno_1962');
  expect(scenarioState.manifestScenarioId).toBe('tno_1962');
  expect(scenarioState.scenarioApplyInFlight).toBe(false);
  expect(scenarioState.resetDisabled).toBe(false);
  expect(scenarioState.clearDisabled).toBe(false);
  expect(englishOverride.setActive).toBe('Use as Active Owner');
  expect(englishOverride.scenarioGuide).toBe(
    'Scenario loaded. 1) Select a country 2) Choose an active owner 3) Use Activate or Scenario Actions.'
  );
});
