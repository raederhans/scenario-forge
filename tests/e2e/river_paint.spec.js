const { test, expect } = require('@playwright/test');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('./support/playwright-app');

test('river pilot UI, real click transaction, undo, file roundtrip and export share cell paint', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
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
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
  await waitForRenderIdle(page); timings.partitionReadyMs = Date.now() - startedAt;
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
      noChildLandIds: sourceIds.every(id => !id.startsWith('river:')), graph,
      referenceUnchanged: referenceBefore === JSON.stringify(getMapDataBoundary(state).reference.getScenarioAssignments()),
      exportedCanvas: !!exportedCanvas?.width, importStatus: imported?.status,
      reloadedPaint: parent.cells.every((c, i) => state.riverPaint.overrides[c.id] === colors[i]),
    };
  });
  timings.roundtripMs = Date.now() - startedAt;
  await testInfo.attach('river-phase-timings.json', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  await testInfo.attach('river-map-roundtrip.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.parentCount).toBe(6); expect(result.cellCount).toBe(31);
  expect(result.historyCount).toBe(2); expect(result.schema).toBe(23);
  for (const key of ['painted', 'undone', 'redone', 'noChildLandIds', 'referenceUnchanged', 'exportedCanvas', 'reloadedPaint']) expect(result[key], key).toBe(true);
  expect(['committed', 'committed-with-warnings']).toContain(result.importStatus);
  await page.locator('#riverPaintToggleBtn').click();
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('river-pilot-map.png') });
});

test('native canvas renders real Paris cells and PNG pixels follow state after tool and river display are hidden', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await gotoApp(page, '/?ui_shell=1', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const load = path => import(new URL(path, location.href).href);
    const { loadRiverPaintPilot } = await load('./js/core/river_paint/pilot_loader.js');
    const { RIVER_PAINT_PILOT } = await load('./js/core/river_paint/pilot_manifest.js');
    const { normalizeRiverPaintState } = await load('./js/core/river_paint/partition_model.js');
    const { createRiverPaintRenderOwner } = await load('./js/core/river_paint/render_owner.js');
    const pack = await loadRiverPaintPilot({}); const parent = pack.parents.find(p => p.parentId === 'FR_ARR_75001');
    const feature = { type: 'Feature', id: parent.parentId, properties: { id: parent.parentId, cntr_code: 'FR' }, geometry: parent.parentGeometry };
    const state = { activeScenarioId: pack.sceneId, scenarioBaselineHash: pack.source.baselineHash,
      activeScenarioManifest: { version: RIVER_PAINT_PILOT.scenarioVersion, generated_at: RIVER_PAINT_PILOT.scenarioGeneratedAt },
      riverPaint: normalizeRiverPaintState({ schemaVersion: 1, pack, editMode: true, overrides: {} }),
      landData: { features: [feature] }, landIndex: new Map([[feature.id, feature]]), sovereignBaseColors: { FR: '#ff0000' }, visualOverrides: {} };
    const colors = ['#12ab34', '#bd24ce', '#2358ab'];
    parent.cells.forEach((c, i) => { state.riverPaint.overrides[c.id] = colors[i]; });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 600;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const projection = d3.geoMercator().fitExtent([[20, 20], [580, 580]], feature);
    const path = d3.geoPath(projection, ctx);
    const owner = createRiverPaintRenderOwner({ state, getContext: () => ctx, getPath: () => path, getProjectionKey: () => 'paris' });
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
    owner.draw(1); const initial = parent.cells.map(sample); const png = canvas.toDataURL('image/png');
    const builds = owner.diagnostics().builds;
    state.riverPaint.editMode = false; state.showRivers = false; ctx.clearRect(0, 0, 600, 600); owner.draw(1);
    return { initial, colors, samePng: canvas.toDataURL('image/png') === png, noReproject: owner.diagnostics().builds === builds, png };
  });
  expect(result.initial).toEqual(result.colors); expect(result.samePng).toBe(true); expect(result.noReproject).toBe(true);
  await testInfo.attach('paris-bank-pixels.png', { body: Buffer.from(result.png.split(',')[1], 'base64'), contentType: 'image/png' });
});
