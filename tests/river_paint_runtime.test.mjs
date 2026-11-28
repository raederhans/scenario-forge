import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, d3, captureCells } from './helpers/river_paint_fixture.mjs';
import { getRiverPaintRuntime, createRiverPaintRuntime } from '../js/core/river_paint/runtime.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { createRiverPaintEditorOwner } from '../js/core/river_paint/editor_owner.js';

test('point targeting distinguishes both banks while preserving canonical parent ID', async () => {
  const { state, hit, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state, { geoContains: d3.geoContains });
  const lower = runtime.refineHit(hit, [1, .5]), upper = runtime.refineHit(hit, [1, 1.5]);
  assert.equal(lower.id, 'P'); assert.equal(lower.riverCellId, cells[0].id);
  assert.equal(upper.id, 'P'); assert.equal(upper.riverCellId, cells[1].id);
  assert.ok(runtime.refineHit(hit, [20, 20]).riverBlockedReason);
  assert.equal(runtime.refineHit({ ...hit, targetType: 'water' }, [1, .5]).riverCellId, undefined);
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

test('chunk unload retains saved edits but blocks incomplete export including contour neighbors', async () => {
  const { state, cells } = await makeFixture(); const runtime = createRiverPaintRuntime(state);
  applyRiverCellPaintState(state, cells[0].id, '#0000ff'); runtime.assertReadyForExport();
  const neighbor = state.landIndex.get('N'); state.landIndex.delete('N');
  assert.throws(() => runtime.assertReadyForExport(), /neighbor/);
  assert.equal(state.riverPaint.overrides[cells[0].id], '#0000ff');
  state.landIndex.set('N', neighbor); runtime.assertReadyForExport();
  state.landIndex.delete('P'); assert.throws(() => runtime.assertReadyForExport(), /not ready/);
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
