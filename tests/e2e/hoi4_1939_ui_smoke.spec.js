const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoApp } = require("./support/playwright-app");

test.setTimeout(120000);
const HOI4_SMOKE_PATH = '/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=hoi4_1939';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

function readScenarioJson(...relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...relativePath), 'utf8'));
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

  await gotoApp(page, HOI4_SMOKE_PATH, { waitUntil: 'domcontentloaded' });
  await waitForScenarioUiReady(page);
  await expect.poll(() => page.locator('#scenarioSelect').inputValue(), { timeout: 20000 }).toBe('hoi4_1939');

  const selectedScenarioId = await page.locator('#scenarioSelect').inputValue();
  const scenarioStatus = await page.locator('#scenarioStatus').innerText();
  const scenarioAuditHint = await page.locator('#scenarioAuditHint').innerText();
  const viewMode = await page.locator('#scenarioViewModeSelect').inputValue();
  const countries = readScenarioJson('data', 'scenarios', 'hoi4_1939', 'countries.json').countries || {};
  const manifest = readScenarioJson('data', 'scenarios', 'hoi4_1939', 'manifest.json');
  const controllers = readScenarioJson('data', 'scenarios', 'hoi4_1939', 'controllers.by_feature.json').controllers || {};

  const ncp = countries.NCP || null;
  const rgc = countries.RGC || null;

  expect(selectedScenarioId).toBe('hoi4_1939');
  expect(viewMode).toBe('ownership');
  expect(scenarioAuditHint.toLowerCase()).toContain('split');
  expect(scenarioAuditHint).toContain(String(manifest?.summary?.owner_controller_split_feature_count || 0));

  expect(ncp).toBeTruthy();
  expect(rgc).toBeTruthy();
  expect(ncp.entry_kind).toBe('controller_only');
  expect(rgc.entry_kind).toBe('controller_only');
  expect(ncp.parent_owner_tag).toBe('JAP');
  expect(rgc.parent_owner_tag).toBe('JAP');
  expect(ncp.controller_feature_count).toBeGreaterThan(0);
  expect(rgc.controller_feature_count).toBeGreaterThan(0);

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'hoi4_1939_ui_smoke.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    scenarioStatus,
    scenarioAuditHint,
    selectedScenarioId,
    viewMode,
    ncpFeatureCount: ncp ? ncp.feature_count : null,
    rgcFeatureCount: rgc ? rgc.feature_count : null,
    ncpControllerFeatureCount: ncp ? ncp.controller_feature_count : null,
    rgcControllerFeatureCount: rgc ? rgc.controller_feature_count : null,
    controllerEntryCount: Object.keys(controllers).length,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
