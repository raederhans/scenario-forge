import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { state } from '../js/core/state.js';
import { clearHistory, pushHistoryEntry, undoHistory, redoHistory } from '../js/core/history_manager.js';

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
  const oldHook = state.refreshColorStateFn;
  globalThis.document = { getElementById: () => null };
  t.after(() => { globalThis.document = oldDocument; state.refreshColorStateFn = oldHook; clearHistory(); });
  const calls = [];
  state.refreshColorStateFn = options => calls.push(options);
  clearHistory();
  state.visualOverrides = { A: '#e31ac4' };
  state.featureOverrides = {};
  const before = { visualOverrides: { A: null, B: '#123456' }, featureOverrides: { A: null, B: null } };
  const after = { visualOverrides: { A: '#e31ac4', B: null }, featureOverrides: { A: null, B: null } };
  pushHistoryEntry({ before, after, meta: { kind: 'fill-feature-color' } });
  undoHistory();
  assert.deepEqual(state.visualOverrides, { B: '#123456' });
  assert.deepEqual(calls.at(-1), { renderNow: false, featureIds: ['A', 'B'], inputLabel: 'history-undo' });
  redoHistory();
  assert.deepEqual(state.visualOverrides, { A: '#e31ac4' });
  assert.deepEqual(calls.at(-1), { renderNow: false, featureIds: ['A', 'B'], inputLabel: 'history-redo' });
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
