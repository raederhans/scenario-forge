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
    after: { featureOverrides: { B: '#123456' } } })), ['A', 'B']);
  for (const key of ['styleConfig', 'sovereigntyByFeatureId', 'countryBaseColors', 'waterRegionOverrides', 'futureField']) {
    assert.equal(scope({ before: { visualOverrides: { A: null } },
      after: { visualOverrides: { A: '#123456' }, [key]: {} } }), null);
  }
  assert.equal(scope({ before: {}, after: {} }), null);
  assert.equal(scope({ before: { visualOverrides: { A: null } }, after: {}, meta: { affectsSovereignty: true } }), null);
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
  const before = { visualOverrides: { A: null, B: '#123456' }, featureOverrides: { A: null, B: null } };
  const after = { visualOverrides: { A: '#e31ac4', B: null }, featureOverrides: { A: null, B: null } };
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
    before: { visualOverrides: { A: null }, featureOverrides: { A: null } },
    after: { visualOverrides: { A: '#123456' }, featureOverrides: { A: '#123456' } },
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

test('mixed and ownership history retain the complete UI refresh set', t => {
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
    before: { visualOverrides: { A: null }, featureOverrides: { A: null }, waterRegionOverrides: { W: null } },
    after: { visualOverrides: { A: '#123456' }, featureOverrides: { A: '#123456' }, waterRegionOverrides: { W: '#abcdef' } },
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
  assert.deepEqual(calls, expected, 'ownership history must use broad UI refresh');
});

test('renderer uses local refresh only for resolved non-Atlantropa targets; existing callers remain full', () => {
  const calls = [];
  const refresh = privateFunction('../js/core/map_renderer.js', 'refreshColorState', {
    nowMs: () => 1, state: {}, runtimeState: { colors: { A: '#123456' } },
    normalizeFeatureOverrideTargetIds: ids => [...new Set(ids)],
    findResolvedColorFeatureById: id => id === 'missing' ? null : { id },
    isAtlantropaFieldDrivenFeature: feature => feature.id === 'atlantropa',
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
  for (const options of [{ renderNow: false }, { renderNow: false, featureIds: ['missing'] },
    { renderNow: false, featureIds: ['A', 'atlantropa'] }]) {
    calls.length = 0; refresh(options);
    assert.deepEqual(calls.map(call => call[0]), ['normalize', 'full', 'invalidate']);
    assert.equal(calls[2][1], 'contextScenario');
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
