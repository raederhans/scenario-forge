const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp, waitForAppInteractive } = require("./support/playwright-app");

test.setTimeout(120000);

async function waitForScenarioUiReady(page) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector('option[value="hoi4_1939"]');
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
  await waitForScenarioManagerIdle(page);
}

test('hoi4 1939 owner-sync smoke', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text() });
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

  await gotoApp(page, '/', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await waitForScenarioUiReady(page);
  await applyScenario(page, 'hoi4_1939');
  await expect(page.locator('#scenarioStatus')).toContainText('HOI4 1939', { timeout: 20000 });

  const scenarioStatus = await page.locator('#scenarioStatus').innerText();
  const scenarioAuditHint = await page.locator('#scenarioAuditHint').innerText();
  const viewMode = await page.locator('#scenarioViewModeSelect').inputValue();

  const countries = await page.evaluate(async () => {
    const payload = await fetch('data/scenarios/hoi4_1939/countries.json').then((r) => r.json());
    return payload.countries || {};
  });

  const manifest = await page.evaluate(async () => {
    return fetch('data/scenarios/hoi4_1939/manifest.json').then((r) => r.json());
  });

  const controllers = await page.evaluate(async () => {
    const payload = await fetch('data/scenarios/hoi4_1939/controllers.by_feature.json').then((r) => r.json());
    return payload.controllers || {};
  });

  const ncp = countries.NCP || null;
  const rgc = countries.RGC || null;
  const countControllerFeatures = (tag) => Object.values(controllers).filter((value) => value === tag).length;
  const ncpControllerCount = countControllerFeatures('NCP');
  const rgcControllerCount = countControllerFeatures('RGC');

  expect(scenarioStatus).toContain('HOI4 1939');
  expect(viewMode).toBe('ownership');
  expect(scenarioAuditHint.toLowerCase()).toContain('split');
  expect(scenarioAuditHint).toContain(String(manifest?.summary?.owner_controller_split_feature_count || 0));

  expect(ncp).toBeTruthy();
  expect(rgc).toBeTruthy();
  expect(ncp.entry_kind).toBe('controller_only');
  expect(rgc.entry_kind).toBe('controller_only');
  expect(ncp.parent_owner_tag).toBe('JAP');
  expect(rgc.parent_owner_tag).toBe('JAP');
  expect(ncp.feature_count).toBe(0);
  expect(rgc.feature_count).toBe(0);
  expect(ncp.controller_feature_count).toBeGreaterThan(0);
  expect(rgc.controller_feature_count).toBeGreaterThan(0);
  expect(ncp.controller_feature_count).toBe(ncpControllerCount);
  expect(rgc.controller_feature_count).toBe(rgcControllerCount);

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'hoi4_1939_ui_smoke.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    scenarioStatus,
    scenarioAuditHint,
    viewMode,
    ncpFeatureCount: ncp ? ncp.feature_count : null,
    rgcFeatureCount: rgc ? rgc.feature_count : null,
    ncpControllerFeatureCount: ncp ? ncp.controller_feature_count : null,
    rgcControllerFeatureCount: rgc ? rgc.controller_feature_count : null,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
