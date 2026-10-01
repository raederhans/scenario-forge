import test from 'node:test';
import assert from 'node:assert/strict';
import { state as appState } from '../js/core/state.js';
import { makeFixture, makeWave3Fixture, realPilot, realWave2, realWave3 } from './helpers/river_paint_fixture.mjs';
import { getRiverPaintRuntime } from '../js/core/river_paint/runtime.js';
import { normalizeRiverPaintState, createDefaultRiverPaintState } from '../js/core/river_paint/partition_model.js';
import { applyRiverCellPaintState } from '../js/core/state/actions/river_paint_actions.js';
import { applyFeaturePaintState } from '../js/core/state/color_state.js';
import { captureScenarioActivationState, restoreScenarioActivationState } from '../js/core/state/actions/scenario_activation_actions.js';
import { captureHistoryState, pushHistoryEntry, undoHistory, redoHistory, clearHistory } from '../js/core/history_manager.js';
import { FileManager } from '../js/core/file_manager.js';
import { commitImportedProjectPatch } from '../js/core/interaction_funnel/import_apply_orchestration.js';
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from '../js/core/state/index.js';

// Use production state authorities and scoped native mocks for singleton history.
// Project serialization below needs no application singleton mutation at all.
for (const [label, make] of [['synthetic', makeFixture], ['wave3', makeWave3Fixture]])
test(`${label}: real cell mutation undo/redo and same-color whole-parent fill restore sparse child edits`, async t => {
  const fixture = await make(); const parentId = fixture.parent.id;
  const saved = captureScenarioActivationState(appState);
  const oldRefresh = readRegisteredRuntimeHookSource(appState, 'refreshColorStateFn');
  const changed = { activeScenarioId: fixture.pack.sceneId, scenarioBaselineHash: fixture.pack.source.baselineHash,
    riverPaint: fixture.state.riverPaint, sovereignBaseColors: fixture.state.sovereignBaseColors,
    activeScenarioManifest: fixture.state.activeScenarioManifest,
    visualOverrides: {}, mapSemanticMode: 'political' };
  restoreScenarioActivationState(appState, { values: { ...saved.values, ...changed },
    presentKeys: [...new Set([...saved.presentKeys, ...Object.keys(changed)])] });
  const originalGet = appState.landIndex.get.bind(appState.landIndex);
  t.mock.method(appState.landIndex, 'get', id => fixture.state.landIndex.get(id) || originalGet(id));
  try {
    clearHistory(); const refreshes = [];
    registerRuntimeHook(appState, 'refreshColorStateFn', value => refreshes.push(value));
    const cellId = fixture.cells[0].id;
    const beforeCell = captureHistoryState({ riverCellIds: [cellId] });
    assert.equal(applyRiverCellPaintState(appState, cellId, '#0000ff').changed, true);
    pushHistoryEntry({ kind: 'river-cell-fill', before: beforeCell,
      after: captureHistoryState({ riverCellIds: [cellId] }) });
    assert.equal(appState.historyPast.length, 1);
    assert.equal(appState.riverPaint.overrides[cellId], '#0000ff');
    assert.equal(undoHistory(), true); assert.deepEqual(appState.riverPaint.overrides, {});
    assert.deepEqual(refreshes.at(-1).featureIds, [parentId]);
    assert.equal(redoHistory(), true); assert.equal(appState.riverPaint.overrides[cellId], '#0000ff');
    const before = captureHistoryState({ featureIds: [parentId] });
    assert.deepEqual(Object.keys(before).sort(), ['riverPaintOverrides', 'visualOverrides']);
    assert.equal(Object.values(before).some(section => section?.pack), false);
    applyFeaturePaintState(appState, [parentId], '#ff0000');
    pushHistoryEntry({ kind: 'whole-parent', before, after: captureHistoryState({ featureIds: [parentId] }) });
    assert.deepEqual(appState.riverPaint.overrides, {});
    undoHistory(); assert.equal(appState.riverPaint.overrides[cellId], '#0000ff');
    redoHistory(); assert.deepEqual(appState.riverPaint.overrides, {});
    assert.equal(appState.riverPaint.pack, fixture.pack);
  } finally {
    getRiverPaintRuntime(appState).cancel(); clearHistory();
    restoreScenarioActivationState(appState, saved);
    registerRuntimeHook(appState, 'refreshColorStateFn', oldRefresh);
  }
});

function projectFixture(pack) {
  return { ...appState, activeScenarioId: pack.sceneId, scenarioBaselineHash: pack.source.baselineHash,
    activeScenarioManifest: { version: 1 },
    riverPaint: normalizeRiverPaintState({ schemaVersion: 1, pack, editMode: false,
      overrides: { [pack.parents[0].cells[0].id]: '#123456' } }) };
}

for (const [label, readPack] of [['legacy', realPilot], ['wave2', realWave2], ['wave3', realWave3]])
test(`${label} self-contained project survives JSON and the real import commit without fetching geometry`, async () => {
  const pack = readPack(); const state = projectFixture(pack);
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
  assert.deepEqual(state.riverPaint.pack.parents.map(p => p.parentId), pack.parents.map(p => p.parentId));
  assert.equal(state.riverPaint.pack.packId, pack.packId);
  assert.equal(state.riverPaint.overrides[pack.parents[0].cells[0].id], '#123456');
  assert.equal(Object.isFrozen(state.riverPaint.pack), true);
  state.riverPaint = createDefaultRiverPaintState();
  const old = FileManager.buildProjectPayload(state);
  assert.equal(old.schemaVersion, 22); assert.equal(Object.hasOwn(old, 'riverPaint'), false);
});

for (const [label, readPack] of [['legacy', realPilot], ['wave2', realWave2], ['wave3', realWave3]])
test(`${label}: wrong project baseline and modified saved pack never reach the import commit`, async () => {
  const consoleError = console.error; console.error = () => {};
  try {
    const pack = readPack(); const state = projectFixture(pack);
    const payload = FileManager.buildProjectPayload(state); let called = 0;
    const wrongBaseline = structuredClone(payload); wrongBaseline.scenario.baselineHash = 'different';
    assert.equal(await FileManager.importProjectData(wrongBaseline, () => called++), false);
    const tampered = structuredClone(payload); tampered.riverPaint.pack.source.riverNames = ['forged'];
    assert.equal(await FileManager.importProjectData(tampered, () => called++), false);
    for (const geometry of ['support', 'cell']) {
      const changed = structuredClone(payload);
      const target = geometry === 'support' ? changed.riverPaint.pack.support[0].geometry : changed.riverPaint.pack.parents[0].cells[0].geometry;
      const ring = target.type === 'Polygon' ? target.coordinates[0] : target.coordinates[0][0];
      ring.pop(); ring.push(ring.shift()); ring.push(ring[0]);
      assert.equal(await FileManager.importProjectData(changed, () => called++), false);
    }
    assert.equal(called, 0);
    assert.equal(state.riverPaint.pack.packId, pack.packId);
  } finally { console.error = consoleError; }
});
