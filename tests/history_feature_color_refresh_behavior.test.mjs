import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { state } from '../js/core/state.js';
import { captureHistoryState, clearHistory, pushHistoryEntry, undoHistory, redoHistory } from '../js/core/history_manager.js';
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from '../js/core/state/index.js';

function privateFunction(file, name, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(fn.start, fn.end), context);
  return context[name];
}

test('feature-only history scope unions both snapshots and rejects mixed/global effects', () => {
  const scope = privateFunction('../js/core/history_manager.js', 'getFeatureColorHistoryIds');
  assert.deepEqual(Array.from(scope({ before: { visualOverrides: { A: null } },
    after: { visualOverrides: { B: '#123456' } } })), ['A', 'B']);
  for (const key of ['styleConfig', 'sovereigntyByFeatureId', 'sovereignBaseColors', 'waterRegionOverrides', 'futureField']) {
    assert.equal(scope({ before: { visualOverrides: { A: null } },
      after: { visualOverrides: { A: '#123456' }, [key]: {} } }), null);
  }
  assert.equal(scope({ before: {}, after: {} }), null);
  assert.equal(scope({ before: { visualOverrides: { A: null } }, after: {}, meta: { affectsSovereignty: true } }), null);
});

test('water-only history scope excludes mixed and ownership changes', () => {
  const scope = privateFunction('../js/core/history_manager.js', 'getWaterColorHistoryIds');
  assert.deepEqual(Array.from(scope({ before: { waterRegionOverrides: { W: null } },
    after: { waterRegionOverrides: { W: '#123456', X: '#abcdef' } } })), ['W', 'X']);
  assert.equal(scope({ before: { waterRegionOverrides: { W: null } },
    after: { waterRegionOverrides: { W: '#123456' }, visualOverrides: { A: '#abcdef' } } }), null);
  assert.equal(scope({ before: { waterRegionOverrides: { W: null } },
    after: { waterRegionOverrides: { W: '#123456' } }, meta: { affectsSovereignty: true } }), null);
});

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

test('renderer uses local refresh only for resolved non-Atlantropa targets; existing callers remain full', () => {
  const calls = [];
  const refresh = privateFunction('../js/core/map_renderer.js', 'refreshColorState', {
    nowMs: () => 1, state: {}, runtimeState: { colors: { A: '#123456' },
      waterRegionsById: new Map([['W', { id: 'W' }], ['atl-water', { id: 'atl-water' }]]) },
    normalizeFeatureOverrideTargetIds: ids => [...new Set(ids)],
    findResolvedColorFeatureById: id => id === 'missing' ? null : { id },
    isAtlantropaFieldDrivenFeature: feature => feature.id === 'atlantropa' || feature.id === 'atl-water',
    refreshResolvedColorsForFeatures: (...args) => calls.push(['partial', ...args]),
    normalizeColorStateForRender: () => calls.push(['normalize']), sanitizeColorMap: () => {}, sanitizeCountryColorMap: () => {},
    rebuildResolvedColors: () => calls.push(['full']),
    invalidateRenderPasses: (...args) => calls.push(['invalidate', ...args]),
    recordRenderPerfMetric: () => {}, rendererSurfaceHost: { getContext: () => null },
  });
  refresh({ renderNow: false, featureIds: ['A', 'A'], inputLabel: 'history-undo' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'partial');
  assert.deepEqual(Array.from(calls[0][1]), ['A']);
  calls.length = 0;
  refresh({ renderNow: false, waterRegionIds: ['W', 'W'], inputLabel: 'history-undo' });
  assert.deepEqual(calls.map(call => call[0]), ['invalidate']);
  assert.deepEqual(calls[0].slice(1), ['contextScenario', 'refresh-water-colors']);
  for (const options of [{ renderNow: false }, { renderNow: false, featureIds: ['missing'] },
    { renderNow: false, featureIds: ['A', 'atlantropa'] },
    { renderNow: false, waterRegionIds: ['atl-water'] },
    { renderNow: false, waterRegionIds: ['unknown'] }]) {
    calls.length = 0; refresh(options);
    // Normalization is owned by the full rebuild rather than repeated here.
    assert.deepEqual(calls.map(call => call[0]), ['full', 'invalidate']);
    assert.equal(calls[1][1], 'contextScenario');
  }
});

test('color promotion replacing settle timers resumes pending chunks once after entering idle', () => {
  const timers = new Map();
  let nextTimer = 1;
  const calls = [];
  const runtimeState = { renderPhase: 'settling', deferExactAfterSettle: true,
    runtimeChunkLoadState: { pendingReason: 'zoom-end' },
    scheduleScenarioChunkRefreshFn: options => calls.push(options),
  };
  const flush = privateFunction('../js/core/map_renderer.js', 'flushPendingScenarioChunkRefreshAfterExact', {
    runtimeState, pendingScenarioChunkFlushAfterExactHandle: null, RENDER_PHASE_IDLE: 'idle',
    setTimeout: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const promote = privateFunction('../js/core/map_renderer.js', 'promoteDeferredColorRenderToIdle', {
    runtimeState, RENDER_PHASE_SETTLING: 'settling', RENDER_PHASE_IDLE: 'idle',
    getRenderPassCacheState: () => ({ dirty: { political: true }, reasons: { political: 'refresh-colors' } }),
    clearRenderPhaseTimer: () => {},
    cancelExactAfterSettleRefresh: () => { runtimeState.deferExactAfterSettle = false; },
    setRenderPhase: phase => { runtimeState.renderPhase = phase; },
    recordRenderPerfMetric: () => {}, flushPendingScenarioChunkRefreshAfterExact: flush,
  });
  assert.equal(promote(), true);
  assert.equal(runtimeState.renderPhase, 'idle');
  assert.equal(timers.size, 1);
  const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  runTimers();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].flushPending, true);
  assert.equal(timers.size, 0);
  // A new gesture defers to its own idle transition without timer polling.
  flush(); runtimeState.renderPhase = 'interacting'; runTimers();
  assert.equal(calls.length, 1);
  assert.equal(timers.size, 0);
  // A reset removing the pending request must not revive it.
  runtimeState.renderPhase = 'idle'; flush(); runtimeState.runtimeChunkLoadState = {};
  runTimers(); assert.equal(calls.length, 1);
});
