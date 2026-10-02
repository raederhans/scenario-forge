const { test, expect } = require('@playwright/test');
const { gotoApp, waitForAppInteractive, waitForRenderIdle } = require('./support/playwright-app');
const oracle = require('../fixtures/river_paint/overlap_visibility.json');

async function loadCandidate(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoApp(page, '/?default_scenario=modern_world&startup_interaction=full&startup_worker=0&startup_cache=0', { waitUntil: 'domcontentloaded' });
  await waitForAppInteractive(page);
  await expect(page.locator('#riverPaintToggleBtn')).toBeEnabled();
  await page.locator('#riverPaintToggleBtn').click();
  await waitForRenderIdle(page);
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#riverPaintToggleBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#toolFillBtn').click();
}

test('overlap source ranks and all seven candidate hits agree with independent visibility', async ({ page }, testInfo) => {
  // JUSTIFY: One full Modern World load and bounded overlapping-parent click/undo checks.
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadCandidate(page);
  const result = await page.evaluate(async oracle => {
    const { state } = await import('./js/core/state.js');
    const renderer = await import('./js/core/map_renderer.js');
    const history = await import('./js/core/history_manager.js');
    const { setClickSelectedColorState } = await import('./js/core/state/actions/renderer_interaction_actions.js');
    const { restoreProjectImportFields } = await import('./js/core/state/actions/scenario_presentation_actions.js');
    restoreProjectImportFields(state, { interactionGranularity: 'subdivision' });
    state.brushModeEnabled = false; history.clearHistory();
    const ranks = state.landData.features.map((f, i) => ({ id: f.properties.id || f.id, drawOrder: i }));
    const expectedIds = new Set(oracle.sourceOrderIds);
    const actualOrder = ranks.filter(row => expectedIds.has(row.id)).map(row => row.id);
    const interaction = d3.select('rect.interaction-layer'), svg = interaction.node().ownerSVGElement;
    const evidence = [];
    let sequence = 0;
    for (const mode of ['spatial', 'canvas', 'auto']) {
      const url = new URL(location.href); url.searchParams.set('hit_mode', mode); window.history.replaceState(null, '', url);
      for (const point of oracle.points.filter(row => row.kind.endsWith('interior'))) {
        const screen = renderer.projectGeoToScreen(...point.coordinates);
        const svgPoint = svg.createSVGPoint(); svgPoint.x = screen[0]; svgPoint.y = screen[1];
        const client = svgPoint.matrixTransform(svg.getScreenCTM());
        const color = '#' + (0x204060 + ++sequence * 73).toString(16).padStart(6, '0');
        setClickSelectedColorState(state, color);
        await interaction.on('click').call(interaction.node(), {
          clientX: client.x, clientY: client.y, detail: 1, timeStamp: performance.now(),
          preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        });
        const expected = point.expectedCellIds[0] || point.expectedParentId;
        const actual = point.expectedCellIds.length ? state.riverPaint.overrides[expected] : state.visualOverrides[expected];
        evidence.push({ mode, kind: point.kind, target: point.targetParentId, expected, actual, color,
          historyCount: state.historyPast.length });
        history.undoHistory(); history.clearHistory();
      }
    }
    return { actualOrder, ranks, evidence, contours: renderer.getPaintContourDiagnostics() };
  }, oracle);
  await testInfo.attach('overlap-runtime-evidence.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.actualOrder).toEqual(oracle.sourceOrderIds);
  for (const row of result.evidence) {
    expect(row.actual, JSON.stringify(row)).toBe(row.color);
    expect(row.historyCount, JSON.stringify(row)).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('overlap repaint and borders-only export preserve visible bank colors and internal seams', async ({ page }, testInfo) => {
  // JUSTIFY: Full Modern World startup and three bounded native export compositions.
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadCandidate(page);
  await page.evaluate(async () => {
    const renderer = await import('./js/core/map_renderer.js');
    renderer.focusRiverPaintParentById('RU_CITY_VOLGOGRAD');
  });
  await waitForRenderIdle(page);
  await page.evaluate(async () => {
    const renderer = await import('./js/core/map_renderer.js');
    renderer.setZoomPercent(renderer.getZoomPercent() / 3);
  });
  await waitForRenderIdle(page);
  const result = await page.evaluate(async () => {
    const { state } = await import('./js/core/state.js');
    const renderer = await import('./js/core/map_renderer.js');
    const { getRiverPaintRuntime } = await import('./js/core/river_paint/runtime.js');
    const { setClickSelectedColorState } = await import('./js/core/state/actions/renderer_interaction_actions.js');
    const { restoreProjectImportFields } = await import('./js/core/state/actions/scenario_presentation_actions.js');
    restoreProjectImportFields(state, { interactionGranularity: 'subdivision' });
    const pack = getRiverPaintRuntime(state).getActivePack();
    const lower = pack.parents.find(p => p.parentId === 'RU_RAY_50074027B61241799946425');
    const upper = pack.parents.find(p => p.parentId === 'RU_CITY_VOLGOGRAD');
    for (const parent of [lower, upper]) for (let i = 0; i < parent.cells.length; i++) {
      setClickSelectedColorState(state, parent === upper ? (i % 2 ? '#2277dd' : '#eebb22') : (i % 2 ? '#11bb33' : '#cc22bb'));
      if (!renderer.applyRiverPaintCellById(parent.parentId, parent.cells[i].id)) throw new Error(`Cell paint rejected: ${parent.cells[i].id}`);
    }
    renderer.render();
    const partial = state.renderPerfMetrics?.politicalPartialRepaint;
    await renderer.ensurePaintContoursReady();
    const point = [44.399409071126684, 48.67399352086625];
    const topCell = upper.cells.find(cell => d3.geoContains({ type: 'Feature', geometry: cell.geometry }, point));
    const sample = canvas => {
      const [x, y] = renderer.projectGeoToScreen(...point);
      const scale = canvas.width / state.width;
      return [...canvas.getContext('2d').getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data];
    };
    const political = renderer.renderExportPassesToCanvas(['political']);
    const afterPartial = sample(political);
    renderer.invalidateAllRenderPasses('overlap-test-full'); renderer.render();
    const full = renderer.renderExportPassesToCanvas(['political'], { pixelRatio: 1 });
    const borders = renderer.renderExportPassesToCanvas(['borders'], { pixelRatio: 1 });
    const combined = renderer.renderExportPassesToCanvas(['political', 'borders'], { pixelRatio: 1 });
    const seam = renderer.projectGeoToScreen(44.4917, 48.55955);
    const bctx = borders.getContext('2d'); let seamAlpha = 0;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      seamAlpha = Math.max(seamAlpha, bctx.getImageData(Math.floor(seam[0]) + x, Math.floor(seam[1]) + y, 1, 1).data[3]);
    }
    const c = d3.color(state.riverPaint.overrides[topCell.id]);
    return { expectedPixel: [c.r, c.g, c.b, 255], afterPartial, afterFull: sample(full), combined: sample(combined),
      borderInterior: sample(borders), seamAlpha, diagnostic: renderer.getPaintContourDiagnostics(),
      partial };
  });
  await testInfo.attach('overlap-export-evidence.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.afterPartial).toEqual(result.expectedPixel);
  expect(result.afterFull).toEqual(result.expectedPixel);
  expect(result.combined).toEqual(result.expectedPixel);
  expect(result.borderInterior[3]).toBe(0);
  expect(result.seamAlpha).toBeGreaterThan(0);
  expect(result.diagnostic.internal.status).toBe('ready');
  expect(result.partial?.applied, JSON.stringify(result.partial)).toBe(true);
  expect(errors).toEqual([]);
});

test('real source seam pixels agree with independent visible and occluded intervals', async ({ page }, testInfo) => {
  // JUSTIFY: One full Modern World source load, followed by fourteen bounded local Canvas samples.
  test.setTimeout(120_000);
  await loadCandidate(page);
  const evidence = await page.evaluate(async oracle => {
    const { state } = await import('./js/core/state.js');
    const { getRiverPaintRuntime } = await import('./js/core/river_paint/runtime.js');
    const { createRiverInternalContourOwner } = await import('./js/core/river_paint/internal_contour_owner.js');
    const { createRiverContourRenderOwner } = await import('./js/core/river_paint/contour_render_owner.js');
    const runtime = getRiverPaintRuntime(state), pack = runtime.getActivePack();
    const colorByCell = new Map(pack.parents.flatMap(p => p.cells).map((cell, i) => [cell.id,
      '#' + (0x102030 + i).toString(16).padStart(6, '0')]));
    const model = createRiverInternalContourOwner({ state, getActivePack: () => pack,
      getCellFeature: id => runtime.getCellFeature(id), resolveCellColor: id => colorByCell.get(id) });
    const ids = new Set(oracle.sourceOrderIds);
    const entries = state.landData.features.filter(f => ids.has(f.properties.id || f.id));
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rows = [];
    for (const point of oracle.points.filter(row => row.kind.endsWith('seam-midpoint'))) {
      // A local lens makes the independently selected interval interior much
      // larger than an antialiasing pixel; original geographic coordinates stay intact.
      const projection = d3.geoMercator().center(point.coordinates).scale(200000).translate([64, 64]);
      const geoPath = d3.geoPath(projection).context(ctx);
      const owner = createRiverContourRenderOwner({ getContext: () => ctx, getPath: () => geoPath,
        getProjectionKey: () => point, getOrderedEntries: () => entries,
        getParentMeshes: id => id === point.targetParentId ? model.getParentMeshes(id) : [] });
      ctx.clearRect(0, 0, 128, 128);
      owner.draw({ k: 1, color: '#102030', alpha: 1, width: 2 });
      let alpha = 0;
      for (let y = 62; y <= 65; y++) for (let x = 62; x <= 65; x++) {
        alpha = Math.max(alpha, ctx.getImageData(x, y, 1, 1).data[3]);
      }
      rows.push({ parent: point.targetParentId, expectedVisible: point.kind === 'visible-seam-midpoint',
        coordinates: point.coordinates, alpha, diagnostics: owner.diagnostics() });
      owner.dispose();
    }
    model.dispose();
    return rows;
  }, oracle);
  await testInfo.attach('real-seam-pixels.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  for (const row of evidence) {
    if (row.expectedVisible) expect(row.alpha, JSON.stringify(row)).toBeGreaterThan(0);
    else expect(row.alpha, JSON.stringify(row)).toBe(0);
  }
});
