import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { formatScenarioStatusText } from '../js/core/scenario_manager.js';
import { formatScenarioFatalRecoveryMessage } from '../js/core/scenario_recovery.js';
import { state } from '../js/core/state.js';

const source = readFileSync(new URL('../js/core/scenario_manager.js', import.meta.url), 'utf8');
const declaration = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .find(node => node.declaration?.id?.name === 'completeScenarioProjectImport').declaration;
const prepared = { bundle: {}, staged: { scenarioId: 'test', scenarioApplyEpoch: 3 } };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function createCompletion(postEffects, promotion) {
  const context = vm.createContext({
    runPostScenarioApplyEffects: postEffects,
    awaitInitialScenarioChunkVisualPromotion: promotion,
  });
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return context.completeScenarioProjectImport;
}

test('chunked import waits for coarse work and actual political promotion before completing', async () => {
  const coarse = deferred();
  const promoted = deferred();
  const promotionStarted = deferred();
  const events = [];
  const complete = createCompletion(options => {
    assert.equal(options.deferChunkPrewarm, false);
    assert.equal(options.deferOptionalLayers, true);
    assert.equal(options.renderNow, false);
    assert.equal(options.suppressRender, true);
    assert.equal(options.isScenarioApplyRequestCurrent(), true);
    events.push('coarse');
    return coarse.promise;
  }, options => {
    assert.equal(options.renderNow, false);
    events.push('promotion');
    promotionStarted.resolve();
    return promoted.promise;
  });
  let finished = false;
  const work = complete(prepared, () => true).then(() => { finished = true; });
  await Promise.resolve();
  assert.deepEqual(events, ['coarse']);
  assert.equal(finished, false);
  // Some manifests defer committing even successfully loaded coarse payloads.
  coarse.resolve({ hasChunkedRuntime: true, coarsePrewarmCommitted: false });
  await promotionStarted.promise;
  assert.deepEqual(events, ['coarse', 'promotion']);
  assert.equal(finished, false);
  promoted.resolve({ ok: true, status: 'promoted' });
  await work;
  assert.equal(finished, true);
});

test('swallowed coarse failures reject required import and permit a fresh retry', async () => {
  let attempts = 0;
  let promotions = 0;
  const complete = createCompletion(async () => ({
    hasChunkedRuntime: true, prewarmFailed: ++attempts === 1,
  }), async () => { promotions++; return { ok: true }; });
  await assert.rejects(complete(prepared, () => true), /coarse prewarm failed/);
  assert.equal(promotions, 0);
  await complete(prepared, () => true);
  assert.equal(promotions, 1);
});

test('bootstrap-only or timed-out promotion cannot complete the required import', async () => {
  const complete = createCompletion(async () => ({
    hasChunkedRuntime: true, coarsePrewarmCommitted: true,
  }), async () => ({ ok: false, status: 'timeout' }));
  await assert.rejects(complete(prepared, () => true), /political promotion failed: timeout/);
});

test('non-chunked imports retain completion without a chunk promotion', async () => {
  const complete = createCompletion(async () => ({ hasChunkedRuntime: false }), () => {
    assert.fail('non-chunked scenario must not start chunk promotion');
  });
  await complete(prepared, () => true);
});

test('stale completion after coarse work never starts a promotion', async () => {
  let current = true;
  const coarse = deferred();
  const complete = createCompletion(() => coarse.promise, () => {
    assert.fail('cancelled import must not start promotion');
  });
  const work = complete(prepared, () => current);
  current = false;
  coarse.resolve({ hasChunkedRuntime: true, prewarmFailed: true });
  await work;
});

test('stale promotion result does not report a failure against a newer import', async () => {
  let current = true;
  const promoted = deferred();
  const promotionStarted = deferred();
  const complete = createCompletion(async () => ({ hasChunkedRuntime: true }), () => {
    promotionStarted.resolve();
    return promoted.promise;
  });
  const work = complete(prepared, () => current);
  await promotionStarted.promise;
  current = false;
  promoted.resolve({ ok: false, status: 'stale' });
  await work;
});

test('scenario status names the active scenario in both normal and fatal status branches', () => {
  const keys = ['activeScenarioId', 'activeScenarioManifest', 'scenarioFatalRecovery'];
  const saved = Object.fromEntries(keys.map(key => [key, state[key]]));
  try {
    state.activeScenarioId = 'test';
    state.activeScenarioManifest = { display_name: 'Test' };
    state.scenarioFatalRecovery = null;
    assert.equal(formatScenarioStatusText(), 'Test');
    state.scenarioFatalRecovery = {};
    assert.equal(formatScenarioStatusText(), `Test - ${formatScenarioFatalRecoveryMessage({})}`);
    state.activeScenarioId = '';
    assert.equal(formatScenarioStatusText(), formatScenarioFatalRecoveryMessage({}));
  } finally {
    Object.assign(state, saved);
  }
});
