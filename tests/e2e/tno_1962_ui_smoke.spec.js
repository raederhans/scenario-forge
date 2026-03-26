const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

test.setTimeout(120000);

async function readBathymetryRuntime(page) {
  return page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return {
      activeBathymetrySource: state.activeBathymetrySource,
      activeBands: state.activeBathymetryBandsData?.features?.length || 0,
      activeContours: state.activeBathymetryContoursData?.features?.length || 0,
      globalBands: state.globalBathymetryBandsData?.features?.length || 0,
      globalContours: state.globalBathymetryContoursData?.features?.length || 0,
      scenarioBands: state.scenarioBathymetryBandsData?.features?.length || 0,
      scenarioContours: state.scenarioBathymetryContoursData?.features?.length || 0,
      oceanPreset: state.styleConfig?.ocean?.preset || 'flat',
      oceanOpacity: state.styleConfig?.ocean?.opacity ?? null,
      oceanScale: state.styleConfig?.ocean?.scale ?? null,
      contourStrength: state.styleConfig?.ocean?.contourStrength ?? null,
    };
  });
}

async function captureCanvasSnapshot(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('map-canvas');
    const context = canvas instanceof HTMLCanvasElement
      ? canvas.getContext('2d', { willReadFrequently: true })
      : null;
    if (!canvas || !context) {
      return null;
    }
    const { width, height } = canvas;
    const step = Math.max(4, Math.round(Math.min(width, height) / 220));
    const imageData = context.getImageData(0, 0, width, height).data;
    const pixels = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        pixels.push(imageData[offset], imageData[offset + 1], imageData[offset + 2]);
      }
    }
    return { width, height, step, pixels };
  });
}

function getMeanRgbDiff(snapshotA, snapshotB) {
  if (!snapshotA || !snapshotB) {
    throw new Error('Missing canvas snapshot for RGB diff comparison.');
  }
  expect(snapshotA.width).toBe(snapshotB.width);
  expect(snapshotA.height).toBe(snapshotB.height);
  expect(snapshotA.step).toBe(snapshotB.step);
  expect(snapshotA.pixels.length).toBe(snapshotB.pixels.length);
  let diffTotal = 0;
  for (let index = 0; index < snapshotA.pixels.length; index += 1) {
    diffTotal += Math.abs(snapshotA.pixels[index] - snapshotB.pixels[index]);
  }
  return diffTotal / snapshotA.pixels.length;
}

async function resolveBaseUrl() {
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(process.env.MAPCREATOR_BASE_URL);
  pushCandidate(process.env.PLAYWRIGHT_TEST_BASE_URL);

  const metadataPaths = [
    path.join(__dirname, '..', '..', '.runtime', 'dev', 'active_server.json'),
    path.join(process.cwd(), '.runtime', 'dev', 'active_server.json'),
  ];
  for (const metadataPath of metadataPaths) {
    if (!fs.existsSync(metadataPath)) continue;
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      pushCandidate(metadata?.url);
    } catch (error) {
      console.warn('[tno-1962-ui-smoke] Unable to parse active_server.json:', error);
    }
  }

  pushCandidate('http://127.0.0.1:18080');
  pushCandidate('http://127.0.0.1:8000');

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(candidate, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok || response.status < 500) {
        return candidate;
      }
    } catch (_error) {
      // Try the next candidate.
    }
  }

  return candidates[0] || 'http://127.0.0.1:18080';
}

test('tno 1962 releasable catalog smoke', async ({ page }) => {
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
    if (
      url.includes('/data/global_bathymetry.topo.json')
      || url.includes('/data/scenarios/tno_1962/bathymetry.topo.json')
    ) {
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
    if (
      url.includes('/data/global_bathymetry.topo.json')
      || url.includes('/data/scenarios/tno_1962/bathymetry.topo.json')
    ) {
      bathymetryRequests.push(url);
      return;
    }
    if (
      url.includes('/data/scenarios/tno_1962/geo_locale_patch')
      && url.endsWith('.json')
    ) {
      geoLocalePatchRequests.push(url);
    }
  });

  await page.goto(await resolveBaseUrl(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.waitForFunction(() => {
    const select = document.querySelector('#scenarioSelect');
    return !!select && !!select.querySelector('option[value="tno_1962"]');
  });
  const initialScenarioId = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    return String(state.activeScenarioId || '');
  });
  if (initialScenarioId !== 'tno_1962') {
    await page.evaluate(() => {
      const select = document.querySelector('#scenarioSelect');
      if (select instanceof HTMLSelectElement) {
        select.value = 'tno_1962';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.evaluate(async () => {
      const { applyScenarioById } = await import('/js/core/scenario_manager.js');
      await applyScenarioById('tno_1962', {
        renderNow: true,
        markDirtyReason: 'tno-ui-smoke-apply',
        showToastOnComplete: false,
      });
    });
    await page.waitForTimeout(1200);
  }
  await expect(page.locator('#scenarioStatus')).toContainText('TNO 1962', { timeout: 20000 });
  await expect.poll(() => page.locator('#scenarioSelect').inputValue(), { timeout: 20000 }).toBe('tno_1962');

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
  const readPolarRuntime = async () => page.evaluate(async () => {
    const { state } = await import('/js/core/state.js');
    const landIds = Array.isArray(state.landData?.features)
      ? state.landData.features.map((feature) => String(feature?.properties?.id || feature?.id || '')).filter(Boolean)
      : [];
    const ruPolarId = landIds.find((id) => id.startsWith('RU_ARCTIC_FB_')) || '';
    const idToKey = state.idToKey;
    const landIndex = state.landIndex;
    const spatialItemsById = state.spatialItemsById;
    return {
      ruPolarId,
      ruPolarOwner: String(state.scenarioAutoShellOwnerByFeatureId?.[ruPolarId] || ''),
      hasRuPolarLand: !!ruPolarId,
      hasRuPolarKey: !!(ruPolarId && typeof idToKey?.has === 'function' && idToKey.has(ruPolarId)),
      hasRuPolarSpatial: !!(ruPolarId && typeof spatialItemsById?.has === 'function' && spatialItemsById.has(ruPolarId)),
      hasRuPolarIndex: !!(ruPolarId && typeof landIndex?.has === 'function' && landIndex.has(ruPolarId)),
      hasAQ: landIds.includes('AQ'),
      aqOwner: String(state.sovereigntyByFeatureId?.AQ || ''),
      hasAQKey: !!(typeof idToKey?.has === 'function' && idToKey.has('AQ')),
      hasAQSpatial: !!(typeof spatialItemsById?.has === 'function' && spatialItemsById.has('AQ')),
      hasAQIndex: !!(typeof landIndex?.has === 'function' && landIndex.has('AQ')),
      hasLegacyAQSectors: landIds.some((id) => id.startsWith('AQ_')),
    };
  });
  await expect.poll(readPolarRuntime, { timeout: 20000 }).toMatchObject({
    hasRuPolarLand: true,
    hasRuPolarKey: true,
    hasRuPolarSpatial: true,
    hasRuPolarIndex: true,
    hasAQ: true,
    hasAQKey: true,
    hasAQSpatial: true,
    hasAQIndex: true,
    hasLegacyAQSectors: false,
  });
  const polarRuntime = await readPolarRuntime();

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
  expect(polarRuntime.ruPolarOwner).toBeTruthy();
  expect(polarRuntime.aqOwner).toBe('AQ');
  expect(geoLocaleRuntime.currentLanguage).toBe('en');
  expect(geoLocaleRuntime.hasScenarioGeoLocalePatch).toBeTruthy();
  expect(geoLocaleRuntime.geoLocaleEntryCount).toBeGreaterThan(0);
  expect(geoLocalePatchRequests.some((url) => url.includes('/geo_locale_patch.zh.json'))).toBeFalsy();
  expect(bathymetryRequests).toEqual([]);
  const bathymetryRequestCountBeforeAdvancedOcean = bathymetryRequests.length;

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

  await page.locator('#oceanAdvancedStylesToggle').check();
  await page.waitForTimeout(600);
  const flatCanvasSnapshot = await captureCanvasSnapshot(page);
  await page.locator('#oceanStyleSelect').selectOption('bathymetry_soft');
  await expect.poll(() => bathymetryRequests.length, { timeout: 20000 }).toBeGreaterThan(
    bathymetryRequestCountBeforeAdvancedOcean
  );
  await expect.poll(() => readBathymetryRuntime(page), { timeout: 20000 }).toMatchObject({
    activeBathymetrySource: 'merged',
  });
  const softBathymetryRuntime = await readBathymetryRuntime(page);
  expect(softBathymetryRuntime.globalBands).toBeGreaterThan(0);
  expect(softBathymetryRuntime.globalContours).toBeGreaterThan(0);
  expect(softBathymetryRuntime.scenarioBands).toBeGreaterThan(0);
  expect(softBathymetryRuntime.scenarioContours).toBeGreaterThan(0);
  expect(softBathymetryRuntime.oceanPreset).toBe('bathymetry_soft');
  expect(softBathymetryRuntime.oceanOpacity).toBeCloseTo(0.78, 2);
  expect(softBathymetryRuntime.oceanScale).toBeCloseTo(1.08, 2);
  expect(softBathymetryRuntime.contourStrength).toBeCloseTo(0.30, 2);
  expect(bathymetryResponses.some((entry) => entry.url.includes('/data/global_bathymetry.topo.json') && entry.status === 200)).toBeTruthy();
  expect(bathymetryResponses.some((entry) => entry.url.includes('/data/scenarios/tno_1962/bathymetry.topo.json') && entry.status === 200)).toBeTruthy();
  await page.waitForTimeout(600);
  const softCanvasSnapshot = await captureCanvasSnapshot(page);

  await page.locator('#oceanStyleSelect').selectOption('bathymetry_contours');
  await expect.poll(() => readBathymetryRuntime(page), { timeout: 20000 }).toMatchObject({
    activeBathymetrySource: 'merged',
    oceanPreset: 'bathymetry_contours',
  });
  const contourBathymetryRuntime = await readBathymetryRuntime(page);
  expect(contourBathymetryRuntime.oceanOpacity).toBeCloseTo(0.62, 2);
  expect(contourBathymetryRuntime.oceanScale).toBeCloseTo(0.95, 2);
  expect(contourBathymetryRuntime.contourStrength).toBeCloseTo(0.95, 2);
  await page.waitForTimeout(600);
  const contourCanvasSnapshot = await captureCanvasSnapshot(page);

  const flatToSoftMeanRgbDiff = getMeanRgbDiff(flatCanvasSnapshot, softCanvasSnapshot);
  const softToContoursMeanRgbDiff = getMeanRgbDiff(softCanvasSnapshot, contourCanvasSnapshot);
  expect(flatToSoftMeanRgbDiff).toBeGreaterThan(0.5);
  expect(softToContoursMeanRgbDiff).toBeGreaterThanOrEqual(1.0);
  expect(softToContoursMeanRgbDiff).toBeGreaterThanOrEqual(flatToSoftMeanRgbDiff * 0.3);

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
    softBathymetryRuntime,
    contourBathymetryRuntime,
    flatToSoftMeanRgbDiff,
    softToContoursMeanRgbDiff,
    geoLocalePatchRequests,
    consoleIssueCount: consoleIssues.length,
    networkFailureCount: networkFailures.length,
    consoleIssues,
    networkFailures,
    screenshot: shotPath,
  }, null, 2));
});
