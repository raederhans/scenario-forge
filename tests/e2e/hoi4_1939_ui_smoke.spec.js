const { test, expect } = require('playwright/test');

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

  await page.goto('http://127.0.0.1:18080', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.selectOption('#scenarioSelect', 'hoi4_1939');
  await page.click('#applyScenarioBtn');
  await page.waitForTimeout(3200);

  const scenarioStatus = await page.locator('#scenarioStatus').innerText();
  const scenarioAuditHint = await page.locator('#scenarioAuditHint').innerText();
  const viewMode = await page.locator('#scenarioViewModeSelect').inputValue();

  const countries = await page.evaluate(async () => {
    const payload = await fetch('data/scenarios/hoi4_1939/countries.json').then((r) => r.json());
    return payload.countries || {};
  });

  const catalog = await page.evaluate(async () => {
    const payload = await fetch('data/releasables/hoi4_vanilla.internal.phase1.catalog.json').then((r) => r.json());
    return Array.isArray(payload.entries) ? payload.entries : [];
  });

  const ncp = countries.NCP || null;
  const rgc = countries.RGC || null;
  const ncpRel = catalog.find((entry) => entry.tag === 'NCP') || null;
  const rgcRel = catalog.find((entry) => entry.tag === 'RGC') || null;

  expect(scenarioStatus).toContain('HOI4 1939');
  expect(viewMode).toBe('ownership');
  expect(scenarioAuditHint).toContain('Split');
  expect(scenarioAuditHint).toContain('0');

  expect(ncp).toBeTruthy();
  expect(rgc).toBeTruthy();
  expect(ncp.feature_count).toBe(6);
  expect(rgc.feature_count).toBe(18);

  expect(ncpRel).toBeTruthy();
  expect(rgcRel).toBeTruthy();
  expect(ncpRel.parent_owner_tag).toBe('JAP');
  expect(rgcRel.parent_owner_tag).toBe('JAP');

  const shotPath = '.mcp-artifacts/screenshots/hoi4_1939_ui_smoke.png';
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    scenarioStatus,
    scenarioAuditHint,
    viewMode,
    ncpFeatureCount: ncp ? ncp.feature_count : null,
    rgcFeatureCount: rgc ? rgc.feature_count : null,
    ncpReleasableStatus: ncpRel ? ncpRel.validation_status : null,
    rgcReleasableStatus: rgcRel ? rgcRel.validation_status : null,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});

