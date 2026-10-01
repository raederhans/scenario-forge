import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, rectangle, realPilot, realWave2, d3 } from './helpers/river_paint_fixture.mjs';
import { normalizeRiverPartitionPack, normalizeRiverPaintState, verifyRiverPartitionFingerprints,
  getRiverParentCompatibility, getRiverPartitionIndex, getEditedRiverParentIds } from '../js/core/river_paint/partition_model.js';
import { canonicalRiverGeometry, riverGeometryFingerprint } from '../js/core/river_paint/geometry_identity.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { applyRiverCellPaintState, restoreRiverPaintOverridesState, setRiverPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { getMapDataBoundary } from '../js/core/map_data_boundary.js';
import { verifyApprovedRiverPack, loadRiverPaintPilot } from '../js/core/river_paint/pilot_loader.js';

test('approved real pilot has six parents, 31 cells and 11 independently noded neighbors', async () => {
  const pack = await verifyApprovedRiverPack(realPilot());
  assert.equal(pack.parents.length, 6); assert.equal(pack.support.length, 11);
  assert.equal(pack.parents.reduce((n, p) => n + p.cells.length, 0), 31);
  assert.equal(await verifyRiverPartitionFingerprints(pack), pack);
  assert.equal(pack.parents.find(p => p.parentId === 'DEE0D').cells.length, 9);
  for (const parent of pack.parents) {
    for (const cell of parent.cells) assert.ok(d3.geoArea(cell.geometry) < 2 * Math.PI);
  }
});

test('normalization owns immutable geometry without freezing the caller input', async () => {
  const { pack } = await makeFixture(); const raw = structuredClone(pack);
  const normalized = normalizeRiverPartitionPack(raw);
  raw.parents[0].cells[0].geometry.coordinates[0][0][0] = 99;
  assert.notEqual(normalized.parents[0].cells[0].geometry.coordinates[0][0][0], 99);
  assert.equal(Object.isFrozen(normalized.parents[0].cells[0].geometry.coordinates[0]), true);
  assert.equal(normalizeRiverPartitionPack(normalized), normalized);
  assert.equal(getRiverPartitionIndex(normalized), getRiverPartitionIndex(normalized));
});

test('wave 2 authenticates 43 cells while preserving all original parent records', async () => {
  const old = await verifyApprovedRiverPack(realPilot());
  const pack = await verifyApprovedRiverPack(realWave2());
  assert.equal(pack.parents.length, 12); assert.equal(pack.support.length, 18);
  assert.equal(pack.parents.reduce((n, p) => n + p.cells.length, 0), 43);
  await verifyRiverPartitionFingerprints(pack);
  for (const parent of old.parents) assert.deepEqual(pack.parents.find(p => p.parentId === parent.parentId), parent);
  const forged = realWave2(); forged.source.riverNames = ['forged'];
  await assert.rejects(verifyApprovedRiverPack(forged), /integrity/);
  const swapped = realWave2(); swapped.packId = old.packId;
  await assert.rejects(verifyApprovedRiverPack(swapped), /integrity/);
});

test('river action owns imported paint and rejects invalid edits without writes', async () => {
  const { state, cells } = await makeFixture();
  const raw = structuredClone(state.riverPaint);
  setRiverPaintState(state, raw);
  raw.pack.parents[0].cells[0].geometry.coordinates[0][0][0] = 99;
  assert.notEqual(state.riverPaint.pack.parents[0].cells[0].geometry.coordinates[0][0][0], 99);
  const before = state.riverPaint;
  assert.throws(() => applyRiverCellPaintState(state, { toString: () => cells[0].id }, '#0000ff'), /not available/);
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, 'invalid'), /invalid edit color/);
  assert.throws(() => setRiverPaintState(state, { schemaVersion: 99 }), /unsupported/);
  assert.equal(state.riverPaint, before);
});

test('geometry identity ignores ring rotation and direction, not source changes', async () => {
  const a = rectangle(0, 0, 2, 2), b = structuredClone(a);
  b.coordinates[0].reverse();
  assert.equal(await riverGeometryFingerprint(a), await riverGeometryFingerprint(b));
  assert.equal(canonicalRiverGeometry(a), canonicalRiverGeometry(b));
  assert.notEqual(await riverGeometryFingerprint(a), await riverGeometryFingerprint(rectangle(0, 0, 2, 3)));
});

test('reject duplicate IDs, wrong winding, changed coverage and unsupported coordinates', async () => {
  const { pack } = await makeFixture();
  for (const mutate of [
    p => p.parents.push(p.parents[0]),
    p => p.parents[0].cells.push(p.parents[0].cells[0]),
    p => p.parents[0].cells[0].geometry.coordinates[0].reverse(),
    p => p.parents[0].cells[0].geometry.coordinates[0].pop(),
    p => p.parents[0].cells[0].geometry.coordinates[0][1][1] = 85,
    p => p.parents[0].cells[0].geometry = rectangle(0, 0, .5, .5),
    p => p.support.push(p.support[0]),
    p => p.parents[0].cells[0].id = '__proto__',
  ]) {
    const raw = structuredClone(pack); mutate(raw);
    assert.throws(() => normalizeRiverPartitionPack(raw));
  }
});

test('normalization cannot authenticate a forged area-preserving geometry', async () => {
  const raw = realPilot();
  raw.source.riverNames = ['FORGED'];
  await assert.rejects(verifyApprovedRiverPack(raw), /integrity/);
  const { pack } = await makeFixture();
  await assert.rejects(verifyApprovedRiverPack(pack), /Unsupported/);
});

test('approved loader uses the catalog URL and propagates abort and HTTP failure', async () => {
  const signal = new AbortController().signal;
  const pack = await loadRiverPaintPilot({ signal, fetchImpl: async (url, options) => {
    assert.equal(url, 'data/river_partitions/modern_world_wave2.json'); assert.equal(options.signal, signal);
    return { ok: true, text: async () => JSON.stringify(realWave2()) };
  } });
  assert.equal(pack.parents.length, 12);
  await assert.rejects(loadRiverPaintPilot({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(loadRiverPaintPilot({ fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(2000001) }) }), /budget/);
});

test('parent color inheritance and child overrides never alter reference membership', async () => {
  const { state, cells } = await makeFixture(); const boundary = getMapDataBoundary(state);
  const referenceBefore = boundary.reference.getFeatureOrigin('P');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#ff0000');
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[1].id).color, '#ff0000');
  state.sovereignBaseColors.FR = '#00ff00';
  assert.equal(boundary.paint.resolveRiverCellColor(cells[0].id).color, '#0000ff');
  assert.equal(boundary.paint.resolveRiverCellColor(cells[1].id).color, '#00ff00');
  assert.deepEqual(boundary.reference.getFeatureOrigin('P'), referenceBefore);
  assert.deepEqual([...state.landIndex.keys()], ['P', 'N']);
});

test('same-color entire-parent fill still removes child overrides; eraser resumes inheritance', async () => {
  const { state, cells } = await makeFixture();
  applyFeaturePaintState(state, ['P'], '#ff0000');
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  assert.deepEqual(getEditedRiverParentIds(state.riverPaint), ['P']);
  applyFeaturePaintState(state, ['P'], '#ff0000');
  assert.deepEqual(state.riverPaint.overrides, {});
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  applyRiverCellPaintState(state, cells[0].id, null, { remove: true });
  assert.equal(getMapDataBoundary(state).paint.resolveRiverCellColor(cells[0].id).color, '#ff0000');
});

test('invalid batch or history patch fails before any child color mutation', async () => {
  const { state, cells } = await makeFixture();
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  const before = state.riverPaint;
  assert.throws(() => applyFeaturePaintState(state, ['P'], 'invalid'));
  assert.throws(() => restoreRiverPaintOverridesState(state, { [cells[0].id]: null, unknown: '#123456' }));
  assert.equal(state.riverPaint, before);
  assert.throws(() => normalizeRiverPaintState({ ...before, overrides: { wrong: '#123456' } }));
});

test('changed geometry and scenario baselines reject child edits', async () => {
  const { state, cells, pack } = await makeFixture();
  state.landIndex.set('P', { ...state.landIndex.get('P'), geometry: rectangle(0, 0, 4, 4) });
  assert.equal(getRiverParentCompatibility(pack, state.landIndex.get('P'), 'P').status, 'geometry-mismatch');
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, '#0000ff'), /not ready/);
  state.activeScenarioId = 'tno_1962';
  assert.throws(() => applyRiverCellPaintState(state, cells[0].id, '#0000ff'), /not available/);
  assert.deepEqual(state.riverPaint.overrides, {});
});
