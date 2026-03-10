const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test('tno 1962 releasable catalog smoke', async ({ page }) => {
  const consoleIssues = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text() });
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      networkFailures.push({ url: res.url(), status: res.status() });
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

  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector('option[value="tno_1962"]');
  });
  await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 20000 });

  const scenarioStatus = await page.locator('#scenarioStatus').innerText();
  const viewMode = await page.locator('#scenarioViewModeSelect').inputValue();

  const payload = await page.evaluate(async () => {
    const [manifest, countriesPayload, catalogPayload] = await Promise.all([
      fetch('data/scenarios/tno_1962/manifest.json').then((r) => r.json()),
      fetch('data/scenarios/tno_1962/countries.json').then((r) => r.json()),
      fetch('data/releasables/tno_1962.internal.phase1.catalog.json').then((r) => r.json()),
    ]);
    return {
      manifest,
      countries: countriesPayload.countries || {},
      catalogEntries: catalogPayload.entries || [],
    };
  });

  const catalogTags = new Set(payload.catalogEntries.map((entry) => entry.tag));
  const missingFeaturedTags = (payload.manifest.featured_tags || []).filter(
    (tag) => !payload.countries[tag] && !catalogTags.has(tag)
  );
  const retiredCountryTags = ['BEL', 'EST', 'LAT', 'LIT', 'LUX', 'NOR', 'POL'];
  const requiredControllerOnlyTags = ['POR', 'PRC', 'SIC', 'SIK', 'XSM'];
  const lingeringHoi4Owners = Object.values(payload.countries)
    .filter((entry) => entry && entry.source_type === 'hoi4_owner')
    .map((entry) => entry.tag);

  expect(scenarioStatus).toContain('TNO 1962');
  expect(viewMode).toBe('ownership');
  expect(payload.manifest.releasable_catalog_url).toBe('data/releasables/tno_1962.internal.phase1.catalog.json');
  expect(missingFeaturedTags).toEqual([]);
  expect(lingeringHoi4Owners).toEqual([]);
  retiredCountryTags.forEach((tag) => {
    expect(payload.countries[tag]).toBeFalsy();
  });
  requiredControllerOnlyTags.forEach((tag) => {
    expect(payload.countries[tag]?.entry_kind).toBe('controller_only');
  });
  expect(payload.countries.POR?.hidden_from_country_list).toBeTruthy();

  const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'tno_1962_ui_smoke.png');
  fs.mkdirSync(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath, fullPage: true });

  console.log(JSON.stringify({
    scenarioStatus,
    viewMode,
    releasableCatalogUrl: payload.manifest.releasable_catalog_url,
    catalogEntryCount: payload.catalogEntries.length,
    missingFeaturedTags,
    lingeringHoi4Owners,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
