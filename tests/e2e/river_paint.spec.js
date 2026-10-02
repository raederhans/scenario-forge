const { test, expect } = require('@playwright/test');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('./support/playwright-app');
const fs = require('node:fs');
const path = require('node:path');

// The six repaired source-intersecting parents. Whole-pack numerical
// and geometry acceptance belongs to verify_contours.mjs, not one UI edit per cell.
const RIVER_REPRESENTATIVES = [
  ['Huang', 'CN_CITY_17275852B50201707862643'], ['Huang', 'CN_CITY_17275852B70463469741157'],
  ['Huang', 'CN_CITY_17275852B68283317499250'], ['Huang', 'CN_CITY_17275852B83584927302596'],
  ['Rhine', 'DEA1B'], ['Rhine', 'NL226'],
];
const LEGACY_REPRESENTATIVES = ['CN_CITY_17275852B1441354643708', 'DEE0D', 'FR_ARR_76003',
  'PL_POW_0264', 'RU_RAY_50074027B57358126207690'];
const reviewedRequired = true;
const reviewedIds = JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../../tools/river_partitions/selections/wave6-reviewed.json'), 'utf8')).parents;

async function activePackSummary(page) {
  return page.evaluate(async () => {
    const { state } = await import(new URL('./js/core/state.js', location.href));
    const { getRiverPaintRuntime } = await import(new URL('./js/core/river_paint/runtime.js', location.href));
    const pack = getRiverPaintRuntime(state).getActivePack();
    if (!pack) throw new Error('Pack was not loaded by the real toolbar');
    const parents = pack.parents.map(parent => ({ parentId: parent.parentId,
      cells: parent.cells.map(cell => ({ id: cell.id, area: d3.geoArea(cell.geometry) })) }));
    const smallest = parents.flatMap(parent => parent.cells.map(cell => ({ ...cell, parentId: parent.parentId })))
      .sort((a, b) => a.area - b.area)[0];
    return { packId: pack.packId, parents, smallest };
  });
}

function assertReviewedScope(summary) {
  if (!reviewedRequired) return;
  expect(summary.parents.map(parent => parent.parentId).sort()).toEqual([...reviewedIds].sort());
  expect(summary.parents.reduce((n, parent) => n + parent.cells.length, 0)).toBe(1199);
  for (const [, id] of RIVER_REPRESENTATIVES) expect(summary.parents.some(parent => parent.parentId === id), id).toBe(true);
}

test('river pilot UI, real click transaction, undo, file roundtrip and export share cell paint', async ({ page }, testInfo) => {
  // JUSTIFY: Full Modern World startup plus authenticated import/render work; bounded river-only UI scope.
  test.setTimeout(120_000);
  const startedAt = Date.now(); const timings = {};
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, '/?default_scenario=modern_world&startup_interaction=full&startup_worker=0&startup_cache=0', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page); timings.interactiveMs = Date.now() - startedAt;
  // No map pixels or geometry are read before enabling the toolbar. Avoid a
  // redundant full-world settle here; the unchanged readiness gate below
  // proves the final composed surface after the partition activation.
  await expect(page.locator('#riverPaintToggleBtn')).toBeEnabled();
  await page.locator('#riverPaintToggleBtn').click();
  // Activation rebuilds full-map geometry before controls publish readiness.
  await waitForRenderIdle(page);
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
  await waitForRenderIdle(page); timings.partitionReadyMs = Date.now() - startedAt;
  assertReviewedScope(await activePackSummary(page));
  const readiness = await page.evaluate(async () => {
    const { state } = await import(new URL('./js/core/state.js', location.href));
    const { getRiverPaintRuntime } = await import(new URL('./js/core/river_paint/runtime.js', location.href));
    const { sameRiverParentGeometry } = await import(new URL('./js/core/river_paint/geometry_identity.js', location.href));
    const pack = getRiverPaintRuntime(state).getActivePack();
    return pack.support.filter(s => !sameRiverParentGeometry(state.landIndex.get(s.parentId)?.geometry, s.geometry)).map(s => {
      const full = state.landDataFull?.features.find(f => (f.properties?.id || f.id) === s.parentId);
      const live = state.landIndex.get(s.parentId);
      return { id: s.parentId, indexed: !!live, full: !!full, properties: full?.properties, liveProperties: live?.properties,
        fullMatches: sameRiverParentGeometry(full?.geometry,s.geometry), shellOwner: state.scenarioAutoShellOwnerByFeatureId?.[s.parentId] };
    });
  });
  await testInfo.attach('river-support-readiness.json', { body: JSON.stringify(readiness,null,2), contentType: 'application/json' });
  expect(readiness).toEqual([]);
  const result = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { state } = await load('./js/core/state.js');
    const renderer = await load('./js/core/map_renderer.js');
    const history = await load('./js/core/history_manager.js');
    const { FileManager } = await load('./js/core/file_manager.js');
    const { getRiverPaintRuntime } = await load('./js/core/river_paint/runtime.js');
    const { getMapDataBoundary } = await load('./js/core/map_data_boundary.js');
    const { setClickSelectedColorState } = await load('./js/core/state/actions/renderer_interaction_actions.js');
    const { restoreProjectImportFields } = await load('./js/core/state/actions/scenario_presentation_actions.js');
    const runtime = getRiverPaintRuntime(state); const pack = runtime.getActivePack();
    if (!pack) throw new Error('Pilot not installed by the actual toolbar');
    runtime.assertReadyForExport();
    const parent = pack.parents.find(p => p.parentId === 'RU_RAY_50074027B57358126207690');
    if (parent?.cells.length !== 2) throw new Error('Stable two-bank reference parent changed');
    const { APPROVED_RIVER_PACKS } = await load('./js/core/river_paint/pilot_manifest.js');
    const approved = APPROVED_RIVER_PACKS.find(entry => entry.packId === pack.packId);
    const referenceBefore = JSON.stringify(getMapDataBoundary(state).reference.getScenarioAssignments());
    const sourceIds = [...state.landIndex.keys()];
    const innerPoint = cell => {
      const f = { type: 'Feature', geometry: cell.geometry };
      const centroid = d3.geoCentroid(f);
      if (d3.geoContains(f, centroid)) return centroid;
      const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
      for (let y = 1; y < 30; y++) for (let x = 1; x < 30; x++) {
        const p = [x0 + (x1 - x0) * x / 30, y0 + (y1 - y0) * y / 30];
        if (d3.geoContains(f, p)) return p;
      }
      throw new Error('No interior test point');
    };
    document.getElementById('toolFillBtn').click();
    restoreProjectImportFields(state, { interactionGranularity: 'subdivision' });
    state.brushModeEnabled = false; history.clearHistory();
    const interaction = d3.select('rect.interaction-layer');
    const svg = interaction.node().ownerSVGElement;
    const clickEvidence = [];
    const colors = ['#12ab34', '#bd24ce'];
    for (let i = 0; i < parent.cells.length; i++) {
      const lonLat = innerPoint(parent.cells[i]);
      const point = renderer.projectGeoToScreen(...lonLat);
      // The container has layout/border offsets. Use the actual SVG transform,
      // exactly inverse to d3.pointer, rather than assuming matching origins.
      const svgPoint = svg.createSVGPoint(); svgPoint.x = point[0]; svgPoint.y = point[1];
      const screenPoint = svgPoint.matrixTransform(svg.getScreenCTM());
      setClickSelectedColorState(state, colors[i]);
      await interaction.on('click').call(interaction.node(), {
        clientX: screenPoint.x, clientY: screenPoint.y, detail: 1,
        timeStamp: performance.now(), preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      });
      clickEvidence.push({ expected: parent.cells[i].id, lonLat, screen: [screenPoint.x, screenPoint.y],
        actualOverrides: { ...state.riverPaint.overrides }, history: state.historyPast.at(-1) });
    }
    const painted = parent.cells.every((c, i) => state.riverPaint.overrides[c.id] === colors[i]);
    const historyCount = state.historyPast.length;
    history.undoHistory(); const undone = !Object.hasOwn(state.riverPaint.overrides, parent.cells[1].id);
    history.redoHistory(); const redone = state.riverPaint.overrides[parent.cells[1].id] === colors[1];
    await renderer.ensurePaintContoursReady();
    const graph = renderer.getPaintContourDiagnostics();
    const exportedCanvas = renderer.renderExportPassesToCanvas(['political', 'borders'], { pixelRatio: 1 });
    const payload = FileManager.buildProjectPayload(state);
    const funnel = await load('./js/core/interaction_funnel.js');
    const imported = await funnel.importProjectTextThroughFunnel(JSON.stringify(payload), { fileName: 'river-pilot.json' });
    getRiverPaintRuntime(state).assertReadyForExport();
    return { parentCount: pack.parents.length, cellCount: pack.parents.reduce((n, p) => n + p.cells.length, 0),
      painted, clickEvidence, historyCount, undone, redone, schema: payload.schemaVersion,
      approvedParentCount: approved?.parentCount, approvedCellCount: approved?.cellCount,
      noChildLandIds: sourceIds.every(id => !id.startsWith('river:')), graph,
      referenceUnchanged: referenceBefore === JSON.stringify(getMapDataBoundary(state).reference.getScenarioAssignments()),
      exportedCanvas: !!exportedCanvas?.width, importStatus: imported?.status,
      reloadedPaint: parent.cells.every((c, i) => state.riverPaint.overrides[c.id] === colors[i]),
    };
  });
  timings.roundtripMs = Date.now() - startedAt;
  await testInfo.attach('river-phase-timings.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  await testInfo.attach('river-map-roundtrip.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.parentCount).toBe(result.approvedParentCount); expect(result.cellCount).toBe(result.approvedCellCount);
  expect(result.historyCount).toBe(2); expect(result.schema).toBe(23);
  for (const key of ['painted', 'undone', 'redone', 'noChildLandIds', 'referenceUnchanged', 'exportedCanvas', 'reloadedPaint']) expect(result[key], key).toBe(true);
  expect(['committed', 'committed-with-warnings']).toContain(result.importStatus);
  await page.locator('#riverPaintToggleBtn').click();
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('river-pilot-map.png') });
});

test('representative river picker and smallest fragment preserve toolbar undo/redo transactions', async ({ page }, testInfo) => {
  // Bound UI work to two banks per representative plus the smallest fragment.
  // The timeout covers startup, not an unbounded loop over expanded pack cells.
  // JUSTIFY: Full Modern World startup plus authenticated import/render work; bounded river-only UI scope.
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, '/?default_scenario=modern_world&startup_interaction=full&startup_worker=0&startup_cache=0', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await page.locator('#riverPaintToggleBtn').click();
  // Activation rebuilds full-map geometry before controls publish readiness.
  await waitForRenderIdle(page);
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
  await waitForRenderIdle(page);
  await page.locator('#toolFillBtn').click();
  const summary = await activePackSummary(page);
  assertReviewedScope(summary);
  const available = await page.locator('#riverPaintLocationSelect option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
  expect(available.sort()).toEqual(summary.parents.map(parent => parent.parentId).sort());
  const expanded = RIVER_REPRESENTATIVES.every(([, id]) => available.includes(id));
  const parents = expanded ? RIVER_REPRESENTATIVES.map(([, id]) => id) : LEGACY_REPRESENTATIVES.filter(id => available.includes(id));
  expect(parents.length).toBeGreaterThan(0);
  if (reviewedRequired) expect(parents).toHaveLength(RIVER_REPRESENTATIVES.length);
  if (!parents.includes(summary.smallest.parentId)) parents.push(summary.smallest.parentId);
  const readPaint = () => page.evaluate(async () => {
    const { state } = await import(new URL('./js/core/state.js', location.href));
    return { ...state.riverPaint.overrides };
  });
  // Search and filter the real authenticated pack; empty results must not retain
  // a navigable stale parent. Clear both before checking the complete scope.
  const search = page.locator('#riverPaintSearchInput');
  const riverFilter = page.locator('#riverPaintRiverSelect');
  await search.fill('no-such-river-parent-000');
  await expect(page.locator('#riverPaintLocationSelect')).toBeDisabled();
  await expect(page.locator('#riverPaintLocationGoBtn')).toBeDisabled();
  await search.fill('');
  if (reviewedRequired) {
    for (const [river, id] of RIVER_REPRESENTATIVES) {
      await riverFilter.selectOption(river);
      await search.fill(id);
      const ids = await page.locator('#riverPaintLocationSelect option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
      expect(ids, river).toEqual([id]);
      await search.fill('');
    }
  }
  await riverFilter.selectOption('');
  const painted = [];
  for (const parent of parents) {
    await page.locator('#riverPaintLocationSelect').selectOption(parent);
    await expect(page.locator('#riverPaintLocationSelect')).toHaveValue(parent);
    await page.locator('#riverPaintLocationGoBtn').click();
    await expect(page.locator('#riverCellPicker')).toBeVisible();
    const cells = await page.locator('#riverCellSelect option').evaluateAll(options => options.map(o => o.value));
    const expected = summary.parents.find(entry => entry.parentId === parent).cells;
    expect(cells.sort()).toEqual(expected.map(cell => cell.id).sort());
    const chosen = [expected[0].id, expected[1].id];
    if (summary.smallest.parentId === parent && !chosen.includes(summary.smallest.id)) chosen.push(summary.smallest.id);
    for (const cell of chosen) {
      await page.locator('#riverCellSelect').selectOption(cell);
      await expect(page.locator('#riverCellSelect')).toHaveValue(cell);
      await expect(page.locator('#riverCellApplyBtn')).toBeEnabled();
      const previewPaths = await page.locator('#riverCellPicker svg path').evaluateAll(paths => paths.map(p => p.getAttribute('d')));
      expect(previewPaths.length).toBeGreaterThan(0);
      expect(previewPaths.every(d => d && !/NaN|Infinity/.test(d)), cell).toBe(true);
      expect(Object.keys(await readPaint())).toHaveLength(painted.length);
      await page.evaluate(async color => {
        const { state } = await import(new URL('./js/core/state.js', location.href));
        const { setClickSelectedColorState } = await import(new URL('./js/core/state/actions/renderer_interaction_actions.js', location.href));
        setClickSelectedColorState(state, color);
      }, painted.length % 2 ? '#bd24ce' : '#12ab34');
      await page.locator('#riverCellApplyBtn').click();
      painted.push(cell);
      expect(Object.keys(await readPaint()).sort()).toEqual([...painted].sort());
      expect((await readPaint())[cell]).toBe(painted.length % 2 ? '#12ab34' : '#bd24ce');
    }
  }
  expect(painted).toContain(summary.smallest.id);
  await testInfo.attach('river-picker-sample.json', { body: JSON.stringify({ packId: summary.packId,
    representatives: expanded ? RIVER_REPRESENTATIVES : parents, smallest: summary.smallest, painted }, null, 2), contentType: 'application/json' });
  const saved = await readPaint();
  await page.screenshot({ path: testInfo.outputPath('river-smallest-picker.png') });
  for (let count = painted.length - 1; count >= 0; count--) {
    await page.locator('#undoBtn').click();
    expect(Object.keys(await readPaint())).toHaveLength(count);
  }
  for (let count = 1; count <= painted.length; count++) {
    await page.locator('#redoBtn').click();
    expect(Object.keys(await readPaint())).toHaveLength(count);
  }
  expect(await readPaint()).toEqual(saved);
  await page.locator('#riverPaintToggleBtn').click();
  await expect(page.locator('#riverCellPicker')).toBeHidden();
  expect(await readPaint()).toEqual(saved);
  expect(errors).toEqual([]);
});

test('native canvas representative pixels follow state after tool and river display are hidden', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await gotoApp(page, '/?ui_shell=1', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async ({ representatives, requireReviewed }) => {
    const load = path => import(new URL(path, location.href).href);
    const { loadRiverPaintPilot } = await load('./js/core/river_paint/pilot_loader.js');
    const { RIVER_PAINT_PILOT } = await load('./js/core/river_paint/pilot_manifest.js');
    const { normalizeRiverPaintState } = await load('./js/core/river_paint/partition_model.js');
    const { createRiverPaintRenderOwner } = await load('./js/core/river_paint/render_owner.js');
    const pack = await loadRiverPaintPilot({});
    if (requireReviewed && representatives.some(id => !pack.parents.some(parent => parent.parentId === id))) {
      throw new Error('Wave3 representative parents are missing from the authenticated default pack');
    }
    const selected = pack.parents.filter(parent => representatives.includes(parent.parentId));
    const smallest = pack.parents.flatMap(parent => parent.cells.map(cell => ({ parent, area: d3.geoArea(cell.geometry) })))
      .sort((a, b) => a.area - b.area)[0].parent;
    if (!selected.includes(smallest)) selected.push(smallest);
    return selected.map(parent => {
      const feature = { type: 'Feature', id: parent.parentId, properties: { id: parent.parentId, cntr_code: 'FR' }, geometry: parent.parentGeometry };
      const state = { activeScenarioId: pack.sceneId, scenarioBaselineHash: pack.source.baselineHash,
        activeScenarioManifest: { version: RIVER_PAINT_PILOT.scenarioVersion, generated_at: RIVER_PAINT_PILOT.scenarioGeneratedAt },
        riverPaint: normalizeRiverPaintState({ schemaVersion: 1, pack, editMode: true, overrides: {} }),
        landData: { features: [feature] }, landIndex: new Map([[feature.id, feature]]), sovereignBaseColors: { FR: '#ff0000' }, visualOverrides: {} };
      const palette = ['#12ab34', '#bd24ce', '#2358ab', '#df8021', '#16a5b9', '#ab344f', '#8b751d', '#753fce', '#3c6855'];
      const colors = parent.cells.map((_, i) => palette[i % palette.length]);
      const sampledCells = [...parent.cells].sort((a, b) => d3.geoArea(b.geometry) - d3.geoArea(a.geometry)).slice(0, 2);
      parent.cells.forEach((c, i) => { state.riverPaint.overrides[c.id] = colors[i]; });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 600;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const projection = d3.geoMercator().fitExtent([[20, 20], [580, 580]], feature);
      const path = d3.geoPath(projection, ctx);
      const owner = createRiverPaintRenderOwner({ state, getContext: () => ctx, getPath: () => path, getProjectionKey: () => projection.scale() + ':' + projection.translate().join(',') });
      const sample = c => {
        const f = { type: 'Feature', geometry: c.geometry };
        const [[x0, y0], [x1, y1]] = d3.geoBounds(f);
        for (let y = 1; y < 50; y++) for (let x = 1; x < 50; x++) {
          const point = [x0 + (x1 - x0) * x / 50, y0 + (y1 - y0) * y / 50];
          if (!d3.geoContains(f, point)) continue;
          const p = projection(point), pixel = ctx.getImageData(Math.floor(p[0]), Math.floor(p[1]), 1, 1).data;
          const hex = '#' + [...pixel.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
          if (hex === state.riverPaint.overrides[c.id] && pixel[3] === 255) return hex;
        }
        return null;
      };
      // Fit each cell for the pixel assertion: several valid river slivers are
      // smaller than a full opaque pixel at a parent-wide overview.
      const initial = sampledCells.map(cell => {
        projection.fitExtent([[20, 20], [580, 580]], { type: 'Feature', geometry: cell.geometry });
        ctx.clearRect(0, 0, 600, 600); owner.draw(1);
        return sample(cell);
      });
      projection.fitExtent([[20, 20], [580, 580]], feature);
      ctx.clearRect(0, 0, 600, 600); owner.draw(1); const png = canvas.toDataURL('image/png');
      const builds = owner.diagnostics().builds;
      state.riverPaint.editMode = false; state.showRivers = false; ctx.clearRect(0, 0, 600, 600); owner.draw(1);
      return { parentId: parent.parentId, cellIds: sampledCells.map(cell => cell.id), initial,
        colors: sampledCells.map(cell => state.riverPaint.overrides[cell.id]),
        samePng: canvas.toDataURL('image/png') === png, noReproject: owner.diagnostics().builds === builds, png };
    });
  }, { representatives: [...RIVER_REPRESENTATIVES.map(([, id]) => id), ...(reviewedRequired ? [] : LEGACY_REPRESENTATIVES)], requireReviewed: reviewedRequired });
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThanOrEqual(RIVER_REPRESENTATIVES.length + LEGACY_REPRESENTATIVES.length + 1);
  for (const parent of result) {
    expect(parent.initial, parent.parentId).toEqual(parent.colors);
    expect(parent.samePng, parent.parentId).toBe(true);
    expect(parent.noReproject, parent.parentId).toBe(true);
    if (result.indexOf(parent) < 3) {
      await testInfo.attach(`${parent.parentId}-bank-pixels.png`, { body: Buffer.from(parent.png.split(',')[1], 'base64'), contentType: 'image/png' });
    }
  }
  await testInfo.attach('river-pixel-sample.json', { body: JSON.stringify(result.map(({ png, ...evidence }) => evidence), null, 2), contentType: 'application/json' });
});

for (const [label, legacyPacks] of [
  ['pilot and wave2', [['modern_world_pilot.json', 6, 31], ['modern_world_wave2.json', 12, 43]]],
  ['wave3', [['modern_world_wave3.json', 302, 905]]],
  ['wave5', [['modern_world_wave5.transport.json', 376, 1164]]],
])
test(`historical ${label} saved projects keep their authenticated scope through toolbar and reload`, async ({ page }, testInfo) => {
  // JUSTIFY: Full Modern World startup plus authenticated import/render work; bounded river-only UI scope.
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await gotoApp(page, '/?default_scenario=modern_world&startup_interaction=full&startup_worker=0&startup_cache=0', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await page.locator('#riverPaintToggleBtn').click();
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
  const defaultPack = await activePackSummary(page); assertReviewedScope(defaultPack);
  const legacyEvidence = [];
  for (const [asset, parentCount, cellCount] of legacyPacks) {
    // FileManager and the real import funnel authenticate each embedded pack.
    // No loader stubbing, whitelist mutation or unsigned candidate injection.
    const result = await page.evaluate(async asset => {
      const load = path => import(new URL(path, location.href).href);
      const { state } = await load('./js/core/state.js');
      const { FileManager } = await load('./js/core/file_manager.js');
      const { getRiverPaintRuntime } = await load('./js/core/river_paint/runtime.js');
      const { importProjectTextThroughFunnel } = await load('./js/core/interaction_funnel.js');
      const { decodeRiverPartitionTransport } = await load('./js/core/river_paint/pack_transport.js');
      const pack = decodeRiverPartitionTransport(await (await fetch(new URL(`data/river_partitions/${asset}`, location.href))).json());
      const cellId = pack.parents[0].cells[0].id;
      const payload = FileManager.buildProjectPayload(state);
      payload.riverPaint = { schemaVersion: 1, pack, editMode: true, overrides: { [cellId]: '#12ab34' } };
      const imported = await importProjectTextThroughFunnel(JSON.stringify(payload), { fileName: asset });
      getRiverPaintRuntime(state).assertReadyForExport();
      const installed = getRiverPaintRuntime(state).getActivePack();
      return { status: imported.status, expectedPackId: pack.packId, actualPackId: installed.packId,
        cellId, overrides: { ...state.riverPaint.overrides },
        parents: installed.parents.map(parent => parent.parentId),
        cellCount: installed.parents.reduce((n, parent) => n + parent.cells.length, 0) };
    }, asset);
    expect(['committed', 'committed-with-warnings']).toContain(result.status);
    expect(result.actualPackId).toBe(result.expectedPackId);
    expect(result.parents).toHaveLength(parentCount); expect(result.cellCount).toBe(cellCount);
    expect(result.overrides).toEqual({ [result.cellId]: '#12ab34' });
    await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#riverPaintLocationSelect option')).toHaveCount(parentCount + 1);
    const options = await page.locator('#riverPaintLocationSelect option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
    expect(options.sort()).toEqual([...result.parents].sort());
    const newlyAvailable = defaultPack.parents.find(parent => !result.parents.includes(parent.parentId));
    expect(newlyAvailable).toBeTruthy();
    await page.locator('#riverPaintSearchInput').fill(newlyAvailable.parentId);
    await expect(page.locator('#riverPaintLocationSelect')).toBeDisabled();
    await page.locator('#riverPaintSearchInput').fill(result.parents[0]);
    const searched = await page.locator('#riverPaintLocationSelect option').evaluateAll(options => options.map(o => o.value).filter(Boolean));
    expect(searched).toEqual([result.parents[0]]);
    await page.locator('#riverPaintSearchInput').fill('');
    await page.locator('#riverPaintToggleBtn').click();
    await page.locator('#riverPaintToggleBtn').click();
    expect((await activePackSummary(page)).packId).toBe(result.expectedPackId);
    const reload = await page.evaluate(async () => {
      const { state } = await import(new URL('./js/core/state.js', location.href));
      const { FileManager } = await import(new URL('./js/core/file_manager.js', location.href));
      const { importProjectTextThroughFunnel } = await import(new URL('./js/core/interaction_funnel.js', location.href));
      const payload = FileManager.buildProjectPayload(state);
      const result = await importProjectTextThroughFunnel(JSON.stringify(payload), { fileName: 'legacy-river-roundtrip.json' });
      return { status: result.status, packId: state.riverPaint.pack.packId, overrides: { ...state.riverPaint.overrides } };
    });
    expect(['committed', 'committed-with-warnings']).toContain(reload.status);
    expect(reload.packId).toBe(result.expectedPackId); expect(reload.overrides).toEqual(result.overrides);
    legacyEvidence.push({ asset, ...result, reload });
  }
  await testInfo.attach('river-legacy-scope.json', { body: JSON.stringify(legacyEvidence, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
