import { RIVER_PAINT_PILOT } from '../js/core/river_paint/pilot_manifest.js';
import { normalizeRiverPaintState } from '../js/core/river_paint/partition_model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, rectangle, feature, d3, captureCells, realPilot } from './helpers/river_paint_fixture.mjs';
import { getRiverPaintRuntime, createRiverPaintRuntime } from '../js/core/river_paint/runtime.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { createRiverPaintEditorOwner } from '../js/core/river_paint/editor_owner.js';
import { createPaintContourGraphBuilder } from '../js/core/renderer/paint_contour_graph.js';
import { createPaintContourMesh } from '../js/core/renderer/paint_contour_mesh.js';
import { createPaintContourRuntime } from '../js/core/renderer/paint_contour_runtime.js';
import { createPaintContourWorkerClient } from '../js/core/paint_contour_worker_client.js';
import { getMapDataBoundary } from '../js/core/map_data_boundary.js';

test('point targeting distinguishes both banks while preserving canonical parent ID', async () => {
  const { state, hit, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state, { geoContains: d3.geoContains });
  const lower = runtime.refineHit(hit, [1, .5]), upper = runtime.refineHit(hit, [1, 1.5]);
  assert.equal(lower.id, 'P'); assert.equal(lower.riverCellId, cells[0].id);
  assert.equal(upper.id, 'P'); assert.equal(upper.riverCellId, cells[1].id);
  assert.ok(runtime.refineHit(hit, [20, 20]).riverBlockedReason);
  assert.equal(runtime.refineHit({ ...hit, targetType: 'water' }, [1, .5]).riverCellId, undefined);
});

test('tool off preserves geometry and colors; eyedropper still samples the visible bank', async () => {
  const { state, hit, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state, { geoContains: d3.geoContains });
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  const surfaces = runtime.surfaces(); runtime.setMode(false); state.showRivers = false;
  assert.equal(runtime.surfaces(), surfaces); assert.equal(state.riverPaint.overrides[cells[0].id], '#0000ff');
  assert.equal(runtime.refineHit(hit, [1, .5]).riverCellId, undefined);
  state.currentTool = 'eyedropper'; assert.equal(runtime.refineHit(hit, [1, .5]).riverCellId, cells[0].id);
});

test('simultaneous activation shares one request and loading clicks never fall through', async () => {
  const { state, pack, hit } = await makeFixture({ installed: false });
  const runtime = createRiverPaintRuntime(state); let release, requests = 0;
  const loader = () => { requests++; return new Promise(resolve => { release = resolve; }); };
  const a = runtime.enable(loader), b = runtime.enable(loader);
  await Promise.resolve(); assert.equal(requests, 1);
  assert.equal(runtime.refineHit(hit, [1, .5]).riverBlockedReason, 'loading');
  assert.throws(() => runtime.assertReadyForExport(), /loading/);
  release(pack); const [left, right] = await Promise.all([a, b]);
  assert.equal(left.ready, true); assert.equal(right.ready, true); assert.equal(runtime.diagnostics().pending, false);
});

test('cancellation and scene generations reject late loads without replacing newer paint', async () => {
  for (const action of ['cancel', 'scene']) {
    const { state, pack } = await makeFixture({ installed: false }); const runtime = createRiverPaintRuntime(state);
    let release, signal; const task = runtime.enable(options => { signal = options.signal; return new Promise(r => { release = r; }); });
    await Promise.resolve();
    if (action === 'cancel') runtime.setMode(false);
    else { state.sceneGeneration++; runtime.diagnostics(); }
    assert.equal(signal.aborted, true); release(pack);
    assert.equal((await task).stale, true); assert.equal(state.riverPaint.pack, null);
  }
});

test('synchronous loader failure is retryable and failed mode remains fail-closed', async () => {
  const { state, pack, hit } = await makeFixture({ installed: false }); const runtime = createRiverPaintRuntime(state);
  await assert.rejects(runtime.enable(() => { throw new Error('offline'); }), /offline/);
  assert.equal(runtime.diagnostics().pending, false); assert.ok(runtime.refineHit(hit, [1, .5]).riverBlockedReason);
  assert.equal((await runtime.enable(async () => pack)).ready, true);
});

test('coarse/fine changes pin only the reviewed parent and support, with no new land IDs', async () => {
  const { state, pack } = await makeFixture(); const runtime = createRiverPaintRuntime(state);
  const source = { type: 'FeatureCollection', features: [feature('P', rectangle(0, 0, 2.1, 2)),
    feature('N', rectangle(2, 0, 3, 2)), feature('other', rectangle(10, 0, 11, 2))] };
  const before = JSON.stringify(source); const pinned = runtime.pinCollection(source);
  assert.equal(JSON.stringify(source), before); assert.equal(pinned.features[0].geometry, pack.parents[0].parentGeometry);
  assert.equal(pinned.features[1].geometry, pack.support[0].geometry);
  assert.equal(pinned.features[2], source.features[2]); assert.equal(runtime.pinCollection(source), pinned);
  state.scenarioBaselineHash = 'other-baseline'; assert.equal(runtime.pinCollection(source), source);
  assert.throws(() => runtime.assertReadyForExport(), /baseline/);
});

test('chunk unload retains saved edits but blocks incomplete export including contour neighbors', async () => {
  const { state, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state);
  applyRiverCellPaintState(state, cells[0].id, '#0000ff'); runtime.assertReadyForExport();
  const neighbor = state.landIndex.get('N'); state.landIndex.delete('N');
  assert.throws(() => runtime.assertReadyForExport(), /neighbor/);
  assert.equal(state.riverPaint.overrides[cells[0].id], '#0000ff');
  state.landIndex.set('N', neighbor); runtime.assertReadyForExport();
  state.landIndex.delete('P'); assert.throws(() => runtime.assertReadyForExport(), /not ready/);
});

test('derived surfaces replace parents, preserve neighbor arcs, and retain geometry across color edits', async () => {
  const { state, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state);
  const surfaces = runtime.surfaces(); assert.equal(surfaces.length, 3);
  assert.equal(surfaces.some(f => f.id === 'P'), false); assert.deepEqual([...state.landIndex.keys()], ['P', 'N']);
  const builder = createPaintContourGraphBuilder(); builder.patch(surfaces); const graph = builder.finish();
  assert.equal(graph.diagnostics.arcCount, 3);
  const boundary = getMapDataBoundary(state);
  const color = id => id === 'N' ? '#ff0000' : boundary.paint.resolveRiverCellColor(id).color;
  const mesh = createPaintContourMesh(graph, color); assert.equal(mesh.getActiveArcCount(), 0);
  applyRiverCellPaintState(state, cells[0].id, '#0000ff'); mesh.refresh([cells[0].id]);
  assert.equal(mesh.getActiveArcCount(), 2, 'river arc and lower neighbor arc both appear');
  assert.equal(runtime.surfaces(), surfaces); assert.equal(runtime.diagnostics().compositions, 1);
  applyFeaturePaintState(state, ['P'], '#ff0000'); mesh.refresh(runtime.expandDirtyIds(['P']));
  assert.equal(mesh.getActiveArcCount(), 0);
});

test('actual contour runtime does not rebuild graph on bank paint, parent fill or palette changes', async () => {
  const { state, cells } = await makeFixture(); const river = createRiverPaintRuntime(state);
  const boundary = getMapDataBoundary(state);
  const contour = createPaintContourRuntime({ state, getFeatures: () => river.surfaces(), getFeatureId: f => f.id,
    resolveColor: (f, id) => f.properties.__riverParentId ? boundary.paint.resolveRiverCellColor(id).color
      : boundary.paint.resolveFeatureColor(id).color,
    client: createPaintContourWorkerClient({ isSupported: () => false, yieldToHost: () => Promise.resolve() }) });
  await contour.ensureReady(); const initial = contour.diagnostics();
  for (let i = 0; i < 30; i++) {
    applyRiverCellPaintState(state, cells[0].id, i % 2 ? '#0000ff' : '#ff0000');
    state.colorRevision++; contour.notifyPaintChanged([cells[0].id]);
  }
  applyFeaturePaintState(state, ['P'], '#ff0000'); state.colorRevision++; contour.notifyPaintChanged(river.expandDirtyIds(['P']));
  state.sovereignBaseColors.FR = '#00ff00'; state.colorRevision++; contour.notifyPaintChanged();
  assert.equal(contour.diagnostics().builds, initial.builds);
  assert.equal(contour.diagnostics().sentFeatures, initial.sentFeatures); contour.dispose();
});

test('editor owns both banks in one brush stroke and preserves first-touch history', async () => {
  const { state, hit, cells } = await makeFixture(); const previousD3 = globalThis.d3; globalThis.d3 = d3;
  try {
    const runtime = getRiverPaintRuntime(state), entries = [], refreshed = [];
    const editor = createRiverPaintEditorOwner({ state, captureHistoryState: captureCells(state),
      commitHistoryEntry: e => entries.push(e), refreshParents: ids => refreshed.push(ids),
      markDirty() {}, addRecentColor() {}, selectColor() {} });
    const session = { before: {}, changed: false };
    for (const point of [[1, .5], [1, 1.5], [1, .5]]) editor.handleBrush(runtime.refineHit(hit, point), session);
    assert.equal(session.affectedRiverCellIds.size, 2); assert.equal(refreshed.length, 2);
    assert.deepEqual(session.before.riverPaintOverrides, { [cells[0].id]: null, [cells[1].id]: null });
    assert.equal(entries.length, 0); assert.equal(session.changed, true);
  } finally { globalThis.d3 = previousD3; }
});

test('blocked, stale and mismatched-parent hits cannot write; eyedropper uses child color', async () => {
  const { state, hit, cells } = await makeFixture(); let selected; const entries = [];
  const editor = createRiverPaintEditorOwner({ state, captureHistoryState: captureCells(state), commitHistoryEntry: e => entries.push(e),
    refreshParents() {}, markDirty() {}, addRecentColor() {}, selectColor: color => { selected = color; } });
  const cellHit = { ...hit, riverCellId: cells[0].id, riverPackId: state.riverPaint.pack.packId };
  for (const target of [{ ...hit, riverBlockedReason: 'loading' }, { ...cellHit, riverPackId: 'old' }, { ...cellHit, id: 'N' }]) {
    assert.equal(editor.handleClick(target), true);
  }
  assert.deepEqual(state.riverPaint.overrides, {}); assert.equal(entries.length, 0);
  assert.equal(editor.handleClick(cellHit), true); assert.equal(entries.length, 1);
  state.currentTool = 'eyedropper'; state.riverPaint.editMode = false; editor.handleClick(cellHit);
  assert.equal(selected, '#0000ff');
});


test('same ownership hash cannot activate a pilot against a regenerated geometry build', async () => {
  const pack = realPilot();
  const manifest = { version: RIVER_PAINT_PILOT.scenarioVersion, generated_at: RIVER_PAINT_PILOT.scenarioGeneratedAt };
  const state = { activeScenarioId: pack.sceneId, scenarioBaselineHash: pack.source.baselineHash,
    activeScenarioManifest: manifest, riverPaint: normalizeRiverPaintState({ schemaVersion: 1, pack, overrides: {} }) };
  const runtime = createRiverPaintRuntime(state);
  assert.equal(runtime.getActivePack().packId, pack.packId);
  state.activeScenarioManifest = { ...manifest, generated_at: 'new-geometry-build' };
  assert.equal(runtime.getActivePack(), null);
  assert.throws(() => runtime.assertReadyForExport(), /geometry build/);
  await assert.rejects(runtime.enable(async () => pack), /does not match/);
  assert.equal(state.riverPaint.pack.packId, pack.packId);
});
