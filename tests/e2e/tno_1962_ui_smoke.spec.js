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
  expect(payload.countries.SOV?.inspector_group_id).toBe('scenario_group_russia_region');
  expect(payload.countries.WRS?.inspector_group_id).toBe('scenario_group_russia_region');
  expect(payload.countries.CHI?.inspector_group_id).toBe('scenario_group_china_region');
  expect(payload.countries.PRC?.inspector_group_id).toBe('scenario_group_china_region');
  expect(payload.countries.MEN?.inspector_group_id).toBe('scenario_group_china_region');
  expect(payload.countries.RKM?.inspector_group_id).toBeFalsy();
  expect(payload.countries.MAN?.inspector_group_id).toBeFalsy();

  await expect.poll(async () => {
    const headers = await page.locator('#countryList .country-explorer-header').allTextContents();
    return headers.map((text) => text.trim()).join('|');
  }, { timeout: 20000 }).toContain('China Region');
  await expect.poll(async () => {
    const headers = await page.locator('#countryList .country-explorer-header').allTextContents();
    return headers.map((text) => text.trim()).join('|');
  }, { timeout: 20000 }).toContain('Russia Region');
  const stableTopLevelHeaders = await page.locator('#countryList .country-explorer-header').allTextContents();
  const chinaHeaderIndex = stableTopLevelHeaders.findIndex((text) => text.includes('China Region'));
  const asiaHeaderIndex = stableTopLevelHeaders.findIndex((text) => text.includes('Asia'));
  const russiaHeaderIndex = stableTopLevelHeaders.findIndex((text) => text.includes('Russia Region'));
  const europeHeaderIndex = stableTopLevelHeaders.findIndex((text) => text.includes('Europe'));

  expect(chinaHeaderIndex).toBeGreaterThanOrEqual(0);
  expect(asiaHeaderIndex).toBeGreaterThanOrEqual(0);
  expect(russiaHeaderIndex).toBeGreaterThanOrEqual(0);
  expect(europeHeaderIndex).toBeGreaterThanOrEqual(0);
  expect(chinaHeaderIndex).toBeLessThan(asiaHeaderIndex);
  expect(russiaHeaderIndex).toBeLessThan(europeHeaderIndex);

  const getGroup = (label) =>
    page.locator('#countryList .country-explorer-group').filter({
      has: page.locator('.country-explorer-header').filter({ hasText: new RegExp(`^${label}\\s*\\(`) }),
    }).first();

  const ensureGroupOpen = async (label) => {
    const group = getGroup(label);
    await expect(group).toBeVisible();
    const header = group.locator('.country-explorer-header').first();
    if ((await header.getAttribute('aria-expanded')) !== 'true') {
      await header.click();
    }
  };

  await ensureGroupOpen('China Region');
  await expect(getGroup('China Region').locator('.country-select-main-btn').filter({ hasText: /Republic of China \(CHI\)/ })).toBeVisible();
  await expect(getGroup('China Region').locator('.country-select-main-btn').filter({ hasText: /Communist China \(PRC\)/ })).toBeVisible();
  await expect(getGroup('China Region').locator('.country-select-main-btn').filter({ hasText: /Mengjiang \(MEN\)/ })).toBeVisible();

  await ensureGroupOpen('Asia');
  await expect(getGroup('Asia').locator('.country-select-main-btn').filter({ hasText: /Japan \(JAP\)/ })).toBeVisible();

  await ensureGroupOpen('Russia Region');
  await expect(getGroup('Russia Region').locator('.country-select-main-btn').filter({ hasText: /Soviet Union \(SOV\)/ })).toBeVisible();
  await expect(getGroup('Russia Region').locator('.country-select-main-btn').filter({ hasText: /West Russian Revolutionary Front \(WRS\)/ })).toBeVisible();

  await ensureGroupOpen('Europe');
  await expect(getGroup('Europe').locator('.country-select-main-btn').filter({ hasText: /Reichskommissariat Moskowien \(RKM\)/ })).toBeVisible();

  await page.locator('#countrySearch').fill('RKM');
  await expect(page.locator('#countryList').getByRole('button', { name: /Reichskommissariat Moskowien \(RKM\)/ })).toBeVisible();
  await page.locator('#countryList').getByRole('button', { name: /Reichskommissariat Moskowien \(RKM\)/ }).click();
  await expect(page.locator('#countryInspectorColorSwatch')).toHaveAttribute('aria-label', /Reichskommissariat Moskowien/);

  await page.locator('#countrySearch').fill('CHI');
  await expect(page.locator('#countryList').getByRole('button', { name: /Republic of China \(CHI\)/ })).toBeVisible();
  await page.locator('#countryList').getByRole('button', { name: /Republic of China \(CHI\)/ }).click();
  await expect(page.locator('#countryInspectorColorSwatch')).toHaveAttribute('aria-label', /Republic of China/);

  await page.locator('#countrySearch').fill('SOV');
  await expect(page.locator('#countryList').getByRole('button', { name: /Soviet Union \(SOV\)/ })).toBeVisible();
  await page.locator('#countryList').getByRole('button', { name: /Soviet Union \(SOV\)/ }).click();
  await expect(page.locator('#countryInspectorColorSwatch')).toHaveAttribute('aria-label', /Soviet Union/);

  await page.locator('#countrySearch').fill('');

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
