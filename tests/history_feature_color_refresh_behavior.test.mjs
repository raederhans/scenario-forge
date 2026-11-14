import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/core/state.js';
import { captureHistoryState, clearHistory, pushHistoryEntry, undoHistory, redoHistory } from '../js/core/history_manager.js';
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from '../js/core/state/index.js';

test('water-only undo and redo restore overrides with scoped render and UI hooks', t => {
  const oldDocument = globalThis.document;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const hookNames = ['refreshColorStateFn', 'updateToolUIFn', 'updateSwatchUIFn', 'updatePaintModeUIFn',
    'updateToolbarInputsFn', 'renderWaterRegionListFn', 'renderCountryListFn', 'renderSpecialRegionListFn'];
  const oldHooks = new Map(hookNames.map(name => [name, readRegisteredRuntimeHookSource(state, name)]));
  const originalWaterColors = captureHistoryState({ waterRegionIds: ['W'] });
  let waterFeature = { id: 'W', properties: {} };
  const originalWaterLookup = state.waterRegionsById.get.bind(state.waterRegionsById);
  t.mock.method(state.waterRegionsById, 'get', id => id === 'W' ? waterFeature : originalWaterLookup(id));
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    try {
      clearHistory();
      pushHistoryEntry({ before: originalWaterColors,
        after: captureHistoryState({ waterRegionIds: ['W'] }) });
      undoHistory();
      clearHistory();
    } finally {
      oldHooks.forEach((hook, name) => registerRuntimeHook(state, name, hook));
      if (hadDocument) globalThis.document = oldDocument;
      else delete globalThis.document;
    }
  });
  const calls = [];
  hookNames.forEach(name => registerRuntimeHook(state, name, (...args) => {
    calls.push([name, ...args]);
  }));
  clearHistory();
  pushHistoryEntry({ before: { waterRegionOverrides: { W: null } },
    after: { waterRegionOverrides: { W: '#123456' } }, meta: { affectsSovereignty: false } });
  assert.equal(undoHistory(), true);
  assert.equal(state.waterRegionOverrides.W, undefined);
  assert.deepEqual(calls.map(([name]) => name), ['refreshColorStateFn', 'updateToolUIFn',
    'updateSwatchUIFn', 'updatePaintModeUIFn', 'updateToolbarInputsFn', 'renderWaterRegionListFn']);
  assert.deepEqual(calls[0][1], { renderNow: false, waterRegionIds: ['W'], inputLabel: 'history-undo' });
  calls.length = 0;
  assert.equal(redoHistory(), true);
  assert.equal(state.waterRegionOverrides.W, '#123456');
  assert.equal(calls[0][1].inputLabel, 'history-redo');
  waterFeature = { id: 'W', properties: { atl_render_layer: 'water' } };
  calls.length = 0;
  assert.equal(undoHistory(), true);
  assert.deepEqual(calls[0][1], { renderNow: false });
  assert.equal(calls.some(([name]) => name === 'renderCountryListFn'), true,
    'Atlantropa water retains the broad history path');
});

test('multi-feature undo/redo restores removals and supplies the union to the existing hook', t => {
  const oldDocument = globalThis.document;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const oldHook = readRegisteredRuntimeHookSource(state, 'refreshColorStateFn');
  const originalColors = captureHistoryState({ featureIds: ['A', 'B'] });
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    try {
      // Restore only the feature keys owned by this test through the real history API.
      clearHistory();
      pushHistoryEntry({ before: originalColors,
        after: captureHistoryState({ featureIds: ['A', 'B'] }) });
      undoHistory();
      clearHistory();
    } finally {
      registerRuntimeHook(state, 'refreshColorStateFn', oldHook);
      if (hadDocument) globalThis.document = oldDocument;
      else delete globalThis.document;
    }
  });
  const calls = [];
  registerRuntimeHook(state, 'refreshColorStateFn', options => calls.push(options));
  clearHistory();
  const before = { visualOverrides: { A: null, B: '#123456' } };
  const after = { visualOverrides: { A: '#e31ac4', B: null } };
  // Seed the applied snapshot with the existing history entrypoint, without a singleton write.
  pushHistoryEntry({ before: after, after: originalColors });
  undoHistory();
  clearHistory();
  calls.length = 0;
  pushHistoryEntry({ before, after, meta: { kind: 'fill-feature-color' } });
  undoHistory();
  assert.deepEqual(state.visualOverrides, { B: '#123456' });
  assert.deepEqual(calls.at(-1), { renderNow: false, featureIds: ['A', 'B'], inputLabel: 'history-undo' });
  redoHistory();
  assert.deepEqual(state.visualOverrides, { A: '#e31ac4' });
  assert.deepEqual(calls.at(-1), { renderNow: false, featureIds: ['A', 'B'], inputLabel: 'history-redo' });
});

test('feature-only history refreshes color and selection UI without rebuilding unrelated surfaces', t => {
  const oldDocument = globalThis.document;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const oldHooks = new Map([
    'refreshColorStateFn', 'updateToolUIFn', 'updateSwatchUIFn',
    'updatePaintModeUIFn', 'updateActiveSovereignUIFn',
    'refreshCountryInspectorDetailFn', 'updateToolbarInputsFn',
    'renderCountryListFn', 'renderWaterRegionListFn',
    'renderSpecialRegionListFn', 'renderPresetTreeFn', 'updateLegendUI',
    'updateStrategicOverlayUIFn',
  ].map(name => [name, readRegisteredRuntimeHookSource(state, name)]));
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    try {
      clearHistory();
    } finally {
      oldHooks.forEach((hook, name) => registerRuntimeHook(state, name, hook));
      if (hadDocument) globalThis.document = oldDocument;
      else delete globalThis.document;
    }
  });

  const calls = [];
  const trackedHooks = [
    'refreshColorStateFn', 'updateToolUIFn', 'updateSwatchUIFn',
    'updatePaintModeUIFn', 'updateActiveSovereignUIFn',
    'refreshCountryInspectorDetailFn', 'updateToolbarInputsFn',
    'renderCountryListFn', 'renderWaterRegionListFn',
    'renderSpecialRegionListFn', 'renderPresetTreeFn', 'updateLegendUI',
    'updateStrategicOverlayUIFn',
  ];
  trackedHooks.forEach(name => registerRuntimeHook(state, name, () => calls.push(name)));
  clearHistory();
  pushHistoryEntry({
    before: { visualOverrides: { A: null } },
    after: { visualOverrides: { A: '#123456' } },
    meta: { affectsSovereignty: false },
  });
  undoHistory();
  assert.deepEqual(calls, [
    'refreshColorStateFn',
    'updateToolUIFn',
    'updateSwatchUIFn',
    'updatePaintModeUIFn',
    'updateActiveSovereignUIFn',
    'refreshCountryInspectorDetailFn',
  ]);
});

test('mixed history retains broad UI refresh while retired ownership entries are rejected', t => {
  const oldDocument = globalThis.document;
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const hookNames = [
    'refreshColorStateFn', 'updateToolUIFn', 'updateSwatchUIFn',
    'updatePaintModeUIFn', 'updateToolbarInputsFn',
    'updateActiveSovereignUIFn', 'renderCountryListFn',
    'renderWaterRegionListFn', 'renderSpecialRegionListFn',
    'renderPresetTreeFn', 'updateLegendUI', 'updateStrategicOverlayUIFn',
  ];
  const oldHooks = new Map(hookNames.map(name => [name, readRegisteredRuntimeHookSource(state, name)]));
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    try {
      clearHistory();
    } finally {
      oldHooks.forEach((hook, name) => registerRuntimeHook(state, name, hook));
      if (hadDocument) globalThis.document = oldDocument;
      else delete globalThis.document;
    }
  });

  const calls = [];
  hookNames.forEach(name => registerRuntimeHook(state, name, () => calls.push(name)));
  const expected = [
    'refreshColorStateFn', 'updateToolUIFn', 'updateSwatchUIFn',
    'updatePaintModeUIFn', 'updateToolbarInputsFn',
    'updateActiveSovereignUIFn', 'renderCountryListFn',
    'renderWaterRegionListFn', 'renderSpecialRegionListFn',
    'renderPresetTreeFn', 'updateLegendUI', 'updateStrategicOverlayUIFn',
  ];

  clearHistory();
  pushHistoryEntry({
    before: { visualOverrides: { A: null }, waterRegionOverrides: { W: null } },
    after: { visualOverrides: { A: '#123456' }, waterRegionOverrides: { W: '#abcdef' } },
    meta: { affectsSovereignty: false },
  });
  undoHistory();
  assert.deepEqual(calls, expected, 'mixed visual and water history must use broad UI refresh');

  calls.length = 0;
  clearHistory();
  pushHistoryEntry({
    before: { sovereigntyByFeatureId: { A: null } },
    after: { sovereigntyByFeatureId: { A: 'USA' } },
    meta: { affectsSovereignty: true },
  });
  undoHistory();
  assert.deepEqual(calls, [], 'retired ownership history must schedule no UI or render effects');
  assert.equal(state.historyPast.length, 0);
  assert.equal(state.historyFuture.length, 0);
});

