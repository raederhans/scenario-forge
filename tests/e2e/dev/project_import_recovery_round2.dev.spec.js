const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('../support/playwright-app');

// One real HOI4 document: required recovery, save/reopen, then an optional-layer
// race. No replacement renderer or scenario manager is installed.
test.setTimeout(180_000);

async function mapPoint(page) {
  return page.evaluate(() => {
    const xy = globalThis.__round2.renderer.projectGeoToScreen(13.4, 52.5);
    const rect = document.querySelector('#mapContainer').getBoundingClientRect();
    return { x: rect.left + xy[0], y: rect.top + xy[1] };
  });
}

async function selectAt(page, point) {
  await page.keyboard.down('Control');
  try { await page.mouse.click(point.x, point.y); }
  finally { await page.keyboard.up('Control'); }
  return page.evaluate(() => globalThis.__round2.state.devSelectedHit?.id || '');
}

async function assertRecoveredDocument(page, featureId, color) {
  await waitForRenderIdle(page, { scenarioId: 'hoi4_1936', timeout: 45_000 });
  const observed = await page.evaluate(({ id, expectedColor }) => {
    const { state: s, renderer } = globalThis.__round2;
    const xy = renderer.projectGeoToScreen(13.4, 52.5);
    const rgb = expectedColor.slice(1).match(/../g).map(value => parseInt(value, 16));
    const sample = document.createElement('canvas');
    sample.width = sample.height = 9;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    for (const canvasId of ['map-canvas', 'map-political-patch-canvas', 'map-interaction-overlay-canvas']) {
      const canvas = document.getElementById(canvasId);
      if (!canvas || getComputedStyle(canvas).display === 'none') continue;
      const rect = canvas.getBoundingClientRect();
      const sx = xy[0] * canvas.width / rect.width;
      const sy = xy[1] * canvas.height / rect.height;
      ctx.drawImage(canvas, Math.floor(sx) - 4, Math.floor(sy) - 4, 9, 9, 0, 0, 9, 9);
    }
    const pixels = ctx.getImageData(0, 0, 9, 9).data;
    const topology = s.topologyPrimary || s.topology;
    const groups = new Map();
    for (const geom of topology?.objects?.political?.geometries || []) {
      const code = geom.properties?.cntr_code;
      if (!code) continue;
      if (!groups.has(code)) groups.set(code, []);
      groups.get(code).push(geom);
    }
    const suspiciousAdmin0 = [];
    for (const [code, geometries] of groups) {
      const merged = globalThis.topojson.merge(topology, geometries);
      const area = globalThis.d3.geoArea(merged);
      if (area > Math.PI * 2) suspiciousAdmin0.push({ code, area });
    }
    let matchingPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && rgb.every((channel, j) => Math.abs(channel - pixels[i + j]) < 18)) matchingPixels += 1;
    }
    return {
      readonly: !!s.startupReadonly,
      scenario: s.activeScenarioId,
      land: s.landData?.features?.length || 0,
      indexed: s.landIndex.has(id),
      spatial: s.spatialItems?.length || 0,
      owner: s.sovereigntyByFeatureId?.[id] || '',
      resolved: s.colors[id],
      override: s.visualOverrides[id],
      matchingPixels,
      sampleRgb: Array.from(pixels.slice(0, 12)),
      suspiciousAdmin0,
      colorCount: Object.keys(s.colors || {}).length,
      uniqueColors: new Set(Object.values(s.colors || {})).size,
      perf: Object.fromEntries(Object.entries(s.renderPerfMetrics || {}).filter(([name]) => /drawPolitical|scenarioPolitical|drawAdmin0/i.test(name))),
    };
  }, { id: featureId, expectedColor: color });
  console.log('round2 recovered observation', JSON.stringify(observed));
  expect(observed.readonly).toBe(false);
  expect(observed.scenario).toBe('hoi4_1936');
  expect(observed.land).toBeGreaterThan(0);
  expect(observed.spatial).toBeGreaterThan(0);
  expect(observed.indexed).toBe(true);
  expect(observed.owner).toBeTruthy();
  expect(observed.resolved).toBe(color);
  expect(observed.override).toBe(color);
  // Assert visible recovery before issuing any click that could trigger redraw.
  expect(observed.matchingPixels).toBeGreaterThan(0);
  expect(await selectAt(page, await mapPoint(page))).toBe(featureId);
  return observed;
}

test('required import recovery restores real land ownership hit and pixels; optional work cannot overwrite a newer import', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/js/core/scenario_manager.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const signature = 'export async function completeScenarioProjectImport(prepared, isCurrent) {';
    expect(source.split(signature)).toHaveLength(2);
    // A one-shot failure at the actual required task boundary. Retry executes
    // the unchanged scenario/post-apply/renderer implementation from this file.
    const body = source.replace(signature, `${signature}
      if (globalThis.__round2FailScenarioRuntimeOnce) {
        globalThis.__round2FailScenarioRuntimeOnce = false;
        throw new Error('round2 injected scenario-runtime failure');
      }`);
    await route.fulfill({ response, body });
  });
  await gotoApp(page, '/app/?render_profile=balanced&startup_interaction=full&startup_worker=0&startup_cache=0&default_scenario=hoi4_1936', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page, { timeout: 90_000 });
  await waitForRenderIdle(page, { scenarioId: 'hoi4_1936', timeout: 60_000 });
  if (await page.locator('#scenarioGuidePopover').isVisible()) await page.locator('#scenarioGuideCloseBtn').click();
  await page.evaluate(async () => {
    const load = path => import(new URL(`./js/core/${path}`, location.href));
    const [{ state }, renderer, { FileManager }, funnel, hooks] = await Promise.all([
      load('state.js'), load('map_renderer.js'), load('file_manager.js'), load('interaction_funnel.js'), load('state/index.js'),
    ]);
    globalThis.__round2 = { state, renderer, FileManager, funnel, hooks, recoveryEvents: [] };
    globalThis.__round2.importOptions = {
      hooks: {
        refreshColorState: renderer.refreshColorState,
        onProjectImportRecoveryState: snapshot => globalThis.__round2.recoveryEvents.push(snapshot),
      },
      ui: { t: value => value, showToast() {}, showAppDialog: async () => true },
    };
  });
  const point = await mapPoint(page);
  const featureId = await selectAt(page, point);
  expect(featureId).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('before-import.png') });
  const blocked = await page.evaluate(async id => {
    const h = globalThis.__round2;
    h.payload = h.FileManager.buildProjectPayload(h.state);
    h.payload.visualOverrides = { ...h.payload.visualOverrides, [id]: '#e31ac4' };
    h.payload.activePaletteId = '';
    for (const field of ['showCityPoints', 'showStrategicResourceMarkers', 'showRivers', 'showUrban', 'showPhysical', 'showTransport']) {
      h.payload.layerVisibility[field] = false;
    }
    h.payload.layerVisibility.strategicChoroplethMetric = '';
    globalThis.__round2FailScenarioRuntimeOnce = true;
    h.first = await h.funnel.importProjectTextThroughFunnel(JSON.stringify(h.payload), h.importOptions);
    return { status: h.first.status, recovery: h.first.getRecoveryState(), readonly: h.state.startupReadonly,
      reason: h.state.startupReadonlyReason, cancelled: h.first.cancelCompletion() };
  }, featureId);
  expect(blocked.status).toBe('committed-with-warnings');
  expect(blocked.recovery.phase).toBe('blocked');
  expect(blocked.recovery.editable).toBe(false);
  expect(blocked.recovery.tasks['scenario-runtime']).toBe('failed');
  expect(blocked.recovery.tasks['ownership-index']).toBe('pending');
  expect(blocked.readonly).toBe(true);
  expect(blocked.cancelled).toBe(false);
  const recoveryDialog = page.getByRole('dialog', { name: 'Restoring project', exact: true });
  await expect(recoveryDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(recoveryDialog).toBeVisible();
  expect(await page.evaluate(async () => {
    const h = globalThis.__round2;
    return (await h.funnel.importProjectTextThroughFunnel(JSON.stringify(h.payload), h.importOptions)).reason;
  })).toBe('import-recovery-required');
  await recoveryDialog.getByRole('button', { name: 'Retry: scenario-runtime', exact: true }).click();
  await page.waitForFunction(() => globalThis.__round2.first.getRecoveryState().phase === 'complete');
  await expect(recoveryDialog).toHaveCount(0);
  const recovery = await page.evaluate(() => globalThis.__round2.first.getRecoveryState());
  expect(recovery.tasks['scenario-runtime']).toBe('complete');
  expect(recovery.tasks['ownership-index']).toBe('complete');
  const recovered = await assertRecoveredDocument(page, featureId, '#e31ac4');

  const savedText = await page.evaluate(async () => {
    const h = globalThis.__round2;
    const saved = h.FileManager.buildProjectPayload(h.state);
    const download = await h.FileManager.buildProjectDownloadPayload(saved, { format: 'json' });
    h.savedText = await download.blob.text();
    h.reopened = await h.funnel.importProjectThroughFunnel(new File([h.savedText], 'recovery.project.json', { type: 'application/json' }), h.importOptions);
    await h.reopened.completion;
    return h.savedText;
  });
  fs.writeFileSync(testInfo.outputPath('recovered.project.json'), savedText);
  expect(JSON.parse(savedText).visualOverrides[featureId]).toBe('#e31ac4');
  const reopened = await assertRecoveredDocument(page, featureId, '#e31ac4');
  expect(reopened.owner).toBe(recovered.owner);
  const semanticRoundtrip = await page.evaluate(() => {
    const h = globalThis.__round2;
    const before = JSON.parse(h.savedText);
    const after = h.FileManager.buildProjectPayload(h.state);
    const fields = ['visualOverrides', 'sovereigntyByFeatureId', 'controllerByFeatureId', 'layerVisibility'];
    const semantics = value => ({
      ...Object.fromEntries(fields.map(key => [key, value[key]])),
      scenario: { id: value.scenario.id, version: value.scenario.version, baselineHash: value.scenario.baselineHash },
    });
    return { before: semantics(before), after: semantics(after) };
  });
  expect(semanticRoundtrip.after).toEqual(semanticRoundtrip.before);

  await page.evaluate(async () => {
    const h = globalThis.__round2;
    h.originalContextLoader = h.hooks.readRegisteredRuntimeHookSource(h.state, 'ensureContextLayerDataFn');
    if (typeof h.originalContextLoader !== 'function') throw new Error('Missing real context loader');
    const held = new Promise(resolve => { h.releaseOptional = resolve; });
    h.hooks.registerRuntimeHook(h.state, 'ensureContextLayerDataFn', async (layer, options) => {
      if (layer === 'rivers' && options.reason === 'project-import') {
        h.optionalStarted = true;
        await held;
        h.lateCurrent = options.isCurrent();
        h.lateAborted = options.signal.aborted;
        const riversBeforeCall = h.state.riversData;
        try { return await h.originalContextLoader(layer, options); }
        finally { h.lateLoaderPreservedRivers = h.state.riversData === riversBeforeCall; h.lateSettled = true; }
      }
      return h.originalContextLoader(layer, options);
    });
    const payload = JSON.parse(h.savedText);
    payload.layerVisibility.showRivers = true;
    h.old = await h.funnel.importProjectTextThroughFunnel(JSON.stringify(payload), h.importOptions);
  });
  await page.waitForFunction(() => globalThis.__round2.optionalStarted === true);
  expect(await page.evaluate(() => globalThis.__round2.old.getRecoveryState().editable)).toBe(true);
  expect(await page.evaluate(() => globalThis.__round2.old.getRecoveryState().tasks.rivers)).toBe('running');
  const newer = await page.evaluate(async id => {
    const h = globalThis.__round2;
    h.hooks.registerRuntimeHook(h.state, 'ensureContextLayerDataFn', h.originalContextLoader);
    const payload = JSON.parse(h.savedText);
    payload.visualOverrides[id] = '#16b8da';
    h.newer = await h.funnel.importProjectTextThroughFunnel(JSON.stringify(payload), h.importOptions);
    await h.newer.completion;
    return { status: h.newer.status, oldPhase: h.old.getRecoveryState().phase };
  }, featureId);
  expect(newer.status).toBe('committed');
  expect(newer.oldPhase).toBe('cancelled');
  await waitForRenderIdle(page, { scenarioId: 'hoi4_1936', timeout: 45_000 });
  await page.evaluate(() => {
    const h = globalThis.__round2;
    h.beforeLate = JSON.stringify(h.FileManager.buildProjectPayload(h.state));
    h.riversBeforeLate = h.state.riversData;
    h.releaseOptional();
  });
  await page.waitForFunction(() => globalThis.__round2.lateSettled === true);
  const late = await page.evaluate(() => {
    const h = globalThis.__round2;
    return { current: h.lateCurrent, aborted: h.lateAborted,
      loaderPreservedRivers: h.lateLoaderPreservedRivers,
      riversSame: h.state.riversData === h.riversBeforeLate,
      before: JSON.parse(h.beforeLate), after: h.FileManager.buildProjectPayload(h.state) };
  });
  expect(late.current).toBe(false);
  expect(late.aborted).toBe(true);
  expect(late.loaderPreservedRivers).toBe(true);
  expect(late.riversSame).toBe(true);
  // Export timestamps reflect wall time; compare every other serialized field.
  delete late.before.timestamp;
  delete late.after.timestamp;
  delete late.before.exportHandoff.generatedAt;
  delete late.after.exportHandoff.generatedAt;
  delete late.before.exportHandoff.project.timestamp;
  delete late.after.exportHandoff.project.timestamp;
  expect(late.after).toEqual(late.before);
  await assertRecoveredDocument(page, featureId, '#16b8da');
});
