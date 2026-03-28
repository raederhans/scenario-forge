const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

async function waitForScenarioUiReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select
      && !!select.querySelector('option[value="hoi4_1939"]')
      && !!select.querySelector('option[value="tno_1962"]');
  });
  await page.evaluate(() => {
    const details = document.querySelector("details[aria-labelledby='lblScenario']");
    if (details && !details.open) {
      details.open = true;
    }
  });
  await expect(page.locator('#scenarioSelect')).toBeVisible();
}

async function waitForScenarioManagerIdle(page) {
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.js');
    return !state.scenarioApplyInFlight;
  });
}

async function applyScenario(page, scenarioId) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate((expectedScenarioId) => {
    const select = document.querySelector('#scenarioSelect');
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, scenarioId);
  const result = await page.evaluate(async (expectedScenarioId) => {
    const { applyScenarioByIdCommand } = await import('/js/core/scenario_dispatcher.js');
    try {
      await applyScenarioByIdCommand(expectedScenarioId, {
        renderMode: 'none',
        markDirtyReason: '',
        showToastOnComplete: false,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || ''),
      };
    }
  }, scenarioId);
  expect(result).toEqual({ ok: true });
  await page.waitForFunction(async (expectedScenarioId) => {
    const { state } = await import('/js/core/state.js');
    return state.activeScenarioId === expectedScenarioId;
  }, scenarioId);
}

async function applyScenarioAllowFailure(page, scenarioId) {
  await waitForScenarioManagerIdle(page);
  await page.evaluate((expectedScenarioId) => {
    const select = document.querySelector('#scenarioSelect');
    if (select instanceof HTMLSelectElement) {
      select.value = expectedScenarioId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, scenarioId);
  const result = await page.evaluate(async (expectedScenarioId) => {
    const { applyScenarioByIdCommand } = await import('/js/core/scenario_dispatcher.js');
    try {
      await applyScenarioByIdCommand(expectedScenarioId, {
        renderMode: 'none',
        markDirtyReason: '',
        showToastOnComplete: false,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || ''),
      };
    }
  }, scenarioId);
  await page.waitForTimeout(1500);
  return result;
}

async function injectScenarioTestHook(page, hookName) {
  await page.evaluate((name) => {
    globalThis.__scenarioTestHooks = {
      ...(globalThis.__scenarioTestHooks || {}),
      [name]: true,
    };
  }, hookName);
}

async function readScenarioResilienceState(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      statusText: document.querySelector('#scenarioStatus')?.textContent || '',
      fatalRecovery: state.scenarioFatalRecovery
        ? {
            phase: String(state.scenarioFatalRecovery.phase || ''),
            message: String(state.scenarioFatalRecovery.message || ''),
            problems: Array.isArray(state.scenarioFatalRecovery.problems)
              ? [...state.scenarioFatalRecovery.problems]
              : [],
          }
        : null,
      controls: {
        scenarioSelectDisabled: !!document.querySelector('#scenarioSelect')?.disabled,
        applyDisabled: !!document.querySelector('#applyScenarioBtn')?.disabled,
        resetDisabled: !!document.querySelector('#resetScenarioBtn')?.disabled,
        clearDisabled: !!document.querySelector('#clearScenarioBtn')?.disabled,
        viewModeDisabled: !!document.querySelector('#scenarioViewModeSelect')?.disabled,
      },
    };
  });
}

async function attemptLockedScenarioAction(page) {
  return page.evaluate(async () => {
    const mod = await import('/js/core/scenario_dispatcher.js');
    try {
      await mod.applyScenarioByIdCommand('hoi4_1939', {
        renderMode: 'none',
        markDirtyReason: '',
        showToastOnComplete: false,
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: String(error?.code || ''),
        message: String(error?.message || ''),
      };
    }
  });
}

test('scenario apply rollback keeps prior stable state on palette failure', async ({ page }) => {
  test.setTimeout(120000);
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

  await gotoApp(page, '/', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, 'hoi4_1939');
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

  const failedApply = await applyScenarioAllowFailure(page, 'tno_1962');
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  const stateAfterFailure = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: state.activeScenarioId,
      manifestScenarioId: String(state.activeScenarioManifest?.scenario_id || ''),
      statusText: document.querySelector('#scenarioStatus')?.textContent || '',
    };
  });

  expect(failedApply.ok).toBe(false);
  await applyScenario(page, 'hoi4_1939');
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
  await page.screenshot({ path: shotPath });

  console.log(JSON.stringify({
    forcedPaletteFailureCount,
    pageErrors,
    unhandledConsoleErrors,
    stateAfterFailure,
    finalState,
    screenshot: shotPath,
  }, null, 2));
});

test('scenario apply fatal recovery locks controls when rollback restore fails', async ({ page }) => {
  test.setTimeout(120000);
  let forcedPaletteFailureCount = 0;
  let shouldAbortTnoPalette = false;

  await page.route('**/data/palettes/tno.palette.json', async (route) => {
    if (shouldAbortTnoPalette && forcedPaletteFailureCount === 0) {
      forcedPaletteFailureCount += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await gotoApp(page, '/', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, 'hoi4_1939');

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    if (state.palettePackCacheById && typeof state.palettePackCacheById === 'object') {
      delete state.palettePackCacheById.tno;
    }
    if (state.paletteMapCacheById && typeof state.paletteMapCacheById === 'object') {
      delete state.paletteMapCacheById.tno;
    }
  });
  await injectScenarioTestHook(page, 'failRollbackRestoreOnce');
  shouldAbortTnoPalette = true;

  const failedApply = await applyScenarioAllowFailure(page, 'tno_1962');

  const runtimeState = await readScenarioResilienceState(page);
  const blockedAction = await attemptLockedScenarioAction(page);

  expect(forcedPaletteFailureCount).toBe(1);
  expect(failedApply.ok).toBe(false);
  expect(runtimeState.fatalRecovery).not.toBeNull();
  expect(runtimeState.statusText).toMatch(/reload|inconsistent/i);
  expect(runtimeState.controls).toEqual({
    scenarioSelectDisabled: true,
    applyDisabled: true,
    resetDisabled: true,
    clearDisabled: true,
    viewModeDisabled: true,
  });
  expect(blockedAction.ok).toBe(false);
  expect(blockedAction.code).toBe('SCENARIO_FATAL_RECOVERY');

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'scenario_apply_fatal_restore_failure.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
});

test('scenario apply fatal recovery locks controls when rollback consistency fails', async ({ page }) => {
  test.setTimeout(120000);
  let forcedPaletteFailureCount = 0;
  let shouldAbortTnoPalette = false;

  await page.route('**/data/palettes/tno.palette.json', async (route) => {
    if (shouldAbortTnoPalette && forcedPaletteFailureCount === 0) {
      forcedPaletteFailureCount += 1;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await gotoApp(page, '/', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, 'hoi4_1939');

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    if (state.palettePackCacheById && typeof state.palettePackCacheById === 'object') {
      delete state.palettePackCacheById.tno;
    }
    if (state.paletteMapCacheById && typeof state.paletteMapCacheById === 'object') {
      delete state.paletteMapCacheById.tno;
    }
  });
  await injectScenarioTestHook(page, 'forceRollbackConsistencyFailureOnce');
  shouldAbortTnoPalette = true;

  const failedApply = await applyScenarioAllowFailure(page, 'tno_1962');

  const runtimeState = await readScenarioResilienceState(page);
  const blockedAction = await attemptLockedScenarioAction(page);

  expect(forcedPaletteFailureCount).toBe(1);
  expect(failedApply.ok).toBe(false);
  expect(runtimeState.fatalRecovery).not.toBeNull();
  expect(runtimeState.fatalRecovery.problems.join(' ')).toMatch(/Injected rollback consistency failure/i);
  expect(runtimeState.statusText).toMatch(/reload|inconsistent/i);
  expect(runtimeState.controls).toEqual({
    scenarioSelectDisabled: true,
    applyDisabled: true,
    resetDisabled: true,
    clearDisabled: true,
    viewModeDisabled: true,
  });
  expect(blockedAction.ok).toBe(false);
  expect(blockedAction.code).toBe('SCENARIO_FATAL_RECOVERY');

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'scenario_apply_fatal_consistency_failure.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
});
