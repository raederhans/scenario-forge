const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  waitForScenarioReadyGate,
  readSmokeFailureSnapshot,
} = require("./support/playwright-app");

test.setTimeout(120000);
const SCENARIO_ID = 'tno_1962';
const BATHYMETRY_URL_SEGMENTS = [
  '/data/global_bathymetry.topo.json',
  '/data/scenarios/tno_1962/bathymetry.topo.json',
];

function isBathymetryRequest(url) {
  return BATHYMETRY_URL_SEGMENTS.some((segment) => url.includes(segment));
}

async function readScenarioShellRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeScenarioId: String(state.activeScenarioId || ''),
      shellOwnerFeatureCount: Object.keys(state.scenarioAutoShellOwnerByFeatureId || {}).length,
      shellControllerFeatureCount: Object.keys(state.scenarioAutoShellControllerByFeatureId || {}).length,
    };
  });
}

test('tno 1962 releasable catalog smoke', async ({ page }, testInfo) => {
  const consoleIssues = [];
  const networkFailures = [];
  const bathymetryRequests = [];
  const bathymetryResponses = [];
  const geoLocalePatchRequests = [];

  await page.addInitScript(() => {
    try {
      localStorage.setItem('map_lang', 'en');
    } catch (_error) {
      // Ignore localStorage failures in constrained environments.
    }
  });

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push({ type, text: msg.text() });
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (isBathymetryRequest(url)) {
      bathymetryResponses.push({ url, status: res.status() });
    }
    if (res.status() >= 400) {
      networkFailures.push({ url, status: res.status() });
    }
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({
      url: req.url(),
      status: 'failed',
      errorText: req.failure() ? req.failure().errorText : 'requestfailed',
    });
  });

  page.on('request', (req) => {
    const url = req.url();
    if (isBathymetryRequest(url)) {
      bathymetryRequests.push(url);
      return;
    }
    if (
      url.includes(`/data/scenarios/${SCENARIO_ID}/geo_locale_patch`)
      && url.endsWith('.json')
    ) {
      geoLocalePatchRequests.push(url);
    }
  });

  try {
    await gotoApp(page, "/", { waitUntil: 'domcontentloaded' });
    const initialScenarioId = await page.evaluate(async () => {
      const { state } = await import('/js/core/state.js');
      return String(state.activeScenarioId || '');
    });
    await waitForScenarioReadyGate(page, {
      scenarioId: SCENARIO_ID,
      timeout: 120_000,
    });
    await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 20000 });
    await expect.poll(() => page.locator('#scenarioSelect').inputValue(), { timeout: 20000 }).toBe(SCENARIO_ID);

    const scenarioStatus = ((await page.locator('#scenarioStatus').textContent()) || '').trim();
    const viewMode = await page.locator('#scenarioViewModeSelect').inputValue();
    const selectedScenarioId = await page.locator('#scenarioSelect').inputValue();

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
    const geoLocaleRuntime = await page.evaluate(async () => {
      const { state } = await import('/js/core/state.js');
      return {
        currentLanguage: state.currentLanguage,
        hasScenarioGeoLocalePatch: !!state.scenarioGeoLocalePatchData?.geo,
        geoLocaleEntryCount: Object.keys(state.scenarioGeoLocalePatchData?.geo || {}).length,
      };
    });
    await expect.poll(() => readScenarioShellRuntime(page), { timeout: 20000 }).toMatchObject({
      activeScenarioId: SCENARIO_ID,
    });
    const scenarioShellRuntime = await readScenarioShellRuntime(page);

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
    expect(selectedScenarioId).toBe('tno_1962');
    expect(viewMode).toBe('ownership');
    expect(payload.manifest.releasable_catalog_url).toBe('data/releasables/tno_1962.internal.phase1.catalog.json');
    expect(payload.manifest.geo_locale_patch_url_en).toBe('data/scenarios/tno_1962/geo_locale_patch.en.json');
    expect(payload.manifest.geo_locale_patch_url_zh).toBe('data/scenarios/tno_1962/geo_locale_patch.zh.json');
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
    expect(payload.countries.AQ?.display_name).toBe('Antarctica');
    expect(payload.countries.RKM?.inspector_group_id).toBeFalsy();
    expect(payload.countries.MAN?.inspector_group_id).toBeFalsy();
    expect(scenarioShellRuntime.activeScenarioId).toBe(SCENARIO_ID);
    expect(geoLocaleRuntime.currentLanguage).toBe('en');
    expect(geoLocaleRuntime.hasScenarioGeoLocalePatch).toBeTruthy();
    expect(geoLocaleRuntime.geoLocaleEntryCount).toBeGreaterThan(0);
    expect(geoLocalePatchRequests.some((url) => url.includes('/geo_locale_patch.zh.json'))).toBeFalsy();
    expect(bathymetryRequests).toEqual([]);

    await expect(page.locator('#countrySearch')).toBeVisible();

    const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'tno_1962_ui_smoke.png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });

    console.log(JSON.stringify({
      initialScenarioId,
      scenarioStatus,
      selectedScenarioId,
      viewMode,
      releasableCatalogUrl: payload.manifest.releasable_catalog_url,
      catalogEntryCount: payload.catalogEntries.length,
      missingFeaturedTags,
      lingeringHoi4Owners,
      bathymetryRequests,
      bathymetryResponses,
      geoLocaleRuntime,
      scenarioShellRuntime,
      geoLocalePatchRequests,
      consoleIssueCount: consoleIssues.length,
      networkFailureCount: networkFailures.length,
      consoleIssues,
      networkFailures,
      screenshot: shotPath,
    }, null, 2));
  } catch (error) {
    const smokeFailureSnapshot = await readSmokeFailureSnapshot(page, [
      "#bootOverlay",
      "#scenarioSelect",
      "#scenarioStatus",
      "#scenarioViewModeSelect",
      "#countrySearch",
    ]);
    await testInfo.attach("smoke-failure-snapshot", {
      body: JSON.stringify(smokeFailureSnapshot, null, 2),
      contentType: "application/json",
    });
    throw error;
  }
});
