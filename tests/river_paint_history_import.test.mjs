import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/core/state.js';
import { makeFixture, realPilot } from './helpers/river_paint_fixture.mjs';
import { getRiverPaintRuntime } from '../js/core/river_paint/runtime.js';
import { createRiverPaintEditorOwner } from '../js/core/river_paint/editor_owner.js';
import { normalizeRiverPaintState, createDefaultRiverPaintState } from '../js/core/river_paint/partition_model.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory, clearHistory } from '../js/core/history_manager.js';
import { FileManager } from '../js/core/file_manager.js';
import { commitImportedProjectPatch } from '../js/core/interaction_funnel/import_apply_orchestration.js';
import { registerRuntimeHook } from '../js/core/state/index.js';

// Exercise the real history and project authorities, not a substitute undo stack.
test('real cell command undo/redo and same-color whole-parent fill restore sparse child edits', async () => {
  const fixture = await makeFixture(); const saved = { ...state };
  try {
    Object.assign(state, fixture.state); clearHistory();
    const refreshes = [];
    registerRuntimeHook(state, 'refreshColorStateFn', value => refreshes.push(value));
    const editor = createRiverPaintEditorOwner({ state, captureHistoryState, commitHistoryEntry: pushHistoryEntry,
      refreshParents() {}, markDirty() {}, addRecentColor() {}, selectColor() {} });
    const hit = { ...fixture.hit, riverCellId: fixture.cells[0].id, riverPackId: fixture.pack.packId };
    assert.equal(editor.handleClick(hit), true);
    assert.equal(state.historyPast.length, 1);
    assert.equal(state.riverPaint.overrides[hit.riverCellId], '#0000ff');
    assert.equal(undoHistory(), true); assert.deepEqual(state.riverPaint.overrides, {});
    assert.deepEqual(refreshes.at(-1).featureIds, ['P']);
    assert.equal(redoHistory(), true); assert.equal(state.riverPaint.overrides[hit.riverCellId], '#0000ff');
    const before = captureHistoryState({ featureIds: ['P'] });
    assert.deepEqual(Object.keys(before).sort(), ['riverPaintOverrides', 'visualOverrides']);
    assert.equal(Object.values(before).some(section => section?.pack), false);
    applyFeaturePaintState(state, ['P'], '#ff0000');
    pushHistoryEntry({ kind: 'whole-parent', before, after: captureHistoryState({ featureIds: ['P'] }) });
    assert.deepEqual(state.riverPaint.overrides, {});
    undoHistory(); assert.equal(state.riverPaint.overrides[hit.riverCellId], '#0000ff');
    redoHistory(); assert.deepEqual(state.riverPaint.overrides, {});
    assert.equal(state.riverPaint.pack, fixture.pack);
  } finally { getRiverPaintRuntime(state).cancel(); Object.assign(state, saved); }
});

test('self-contained approved project survives JSON and the real import commit without fetching geometry', async () => {
  const saved = { ...state }; const pack = realPilot();
  try {
    state.activeScenarioId = pack.sceneId; state.scenarioBaselineHash = pack.source.baselineHash;
    state.activeScenarioManifest = { version: 1 };
    state.riverPaint = normalizeRiverPaintState({ schemaVersion: 1, pack, editMode: false,
      overrides: { [pack.parents[0].cells[0].id]: '#123456' } });
    const payload = FileManager.buildProjectPayload(state);
    assert.equal(payload.schemaVersion, 23);
    assert.equal(payload.riverPaint.editMode, false);
    state.riverPaint = createDefaultRiverPaintState();
    let called = 0;
    const imported = await FileManager.importProjectText(JSON.stringify(payload), data => {
      called++;
      commitImportedProjectPatch(state, { riverPaint: data.riverPaint });
      return { status: 'committed' };
    });
    assert.equal(imported.status, 'committed'); assert.equal(called, 1);
    assert.deepEqual(state.riverPaint, payload.riverPaint);
    assert.equal(state.riverPaint.overrides[pack.parents[0].cells[0].id], '#123456');
    assert.equal(Object.isFrozen(state.riverPaint.pack), true);
    state.riverPaint = createDefaultRiverPaintState();
    const old = FileManager.buildProjectPayload(state);
    assert.equal(old.schemaVersion, 22); assert.equal(Object.hasOwn(old, 'riverPaint'), false);
  } finally { Object.assign(state, saved); }
});

test('wrong project baseline and modified saved pack never reach the import commit', async () => {
  const saved = { ...state }; const consoleError = console.error; console.error = () => {};
  try {
    const pack = realPilot(); state.activeScenarioId = pack.sceneId;
    state.scenarioBaselineHash = pack.source.baselineHash;
    state.riverPaint = normalizeRiverPaintState({ schemaVersion: 1, pack, overrides: {} });
    const payload = FileManager.buildProjectPayload(state); let called = 0;
    const wrongBaseline = structuredClone(payload); wrongBaseline.scenario.baselineHash = 'different';
    assert.equal(await FileManager.importProjectData(wrongBaseline, () => called++), false);
    const tampered = structuredClone(payload); tampered.riverPaint.pack.source.riverNames = ['forged'];
    assert.equal(await FileManager.importProjectData(tampered, () => called++), false);
    assert.equal(called, 0);
    assert.equal(state.riverPaint.pack.packId, pack.packId);
  } finally { console.error = consoleError; Object.assign(state, saved); }
});
