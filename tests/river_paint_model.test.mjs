import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, rectangle, realPilot, d3 } from './helpers/river_paint_fixture.mjs';
import { normalizeRiverPaintState, verifyRiverPartitionFingerprints } from '../js/core/river_paint/partition_model.js';
import { canonicalRiverGeometry, riverGeometryFingerprint } from '../js/core/river_paint/geometry_identity.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { applyRiverCellPaintState, restoreRiverPaintOverridesState } from '../js/core/state/actions/river_paint_actions.js';
import { getMapDataBoundary } from '../js/core/map_data_boundary.js';
import { verifyApprovedRiverPack } from '../js/core/river_paint/pilot_loader.js';

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

test('geometry identity ignores ring rotation and direction, not source changes', async () => {
  const a = rectangle(0, 0, 2, 2), b = structuredClone(a);
  b.coordinates[0].reverse();
  assert.equal(await riverGeometryFingerprint(a), await riverGeometryFingerprint(b));
  assert.equal(canonicalRiverGeometry(a), canonicalRiverGeometry(b));
  assert.notEqual(await riverGeometryFingerprint(a), await riverGeometryFingerprint(rectangle(0, 0, 2, 3)));
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

test('invalid batch or history patch fails before any child color mutation', async () => {
  const { state, cells } = await makeFixture();
  applyRiverCellPaintState(state, cells[0].id, '#0000ff');
  const before = state.riverPaint;
  assert.throws(() => applyFeaturePaintState(state, ['P'], 'invalid'));
  assert.throws(() => restoreRiverPaintOverridesState(state, { [cells[0].id]: null, unknown: '#123456' }));
  assert.equal(state.riverPaint, before);
  assert.throws(() => normalizeRiverPaintState({ ...before, overrides: { wrong: '#123456' } }));
});
