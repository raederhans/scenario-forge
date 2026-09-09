import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureRenderTransactionDiagnosticsState,
  advanceScenarioApplyEpochState,
} from '../js/core/state/actions/renderer_transaction_diagnostics_actions.js';
import {
  ensureRenderTransactionDiagnosticsState as ensureLegacyDiagnostics,
  exposeRenderTransactionDiagnostics,
  getRenderTransactionGlobalName,
  nextScenarioApplyEpoch,
} from '../js/core/renderer/render_transaction_diagnostics.js';

test('canonical diagnostics normalization preserves valid borrowed root and collection references', () => {
  const snapshots = [];
  const warnings = [];
  const epochs = { prior: 2 };
  const diagnostics = { sequence: -1, scenarioApplyEpoch: '3', renderTransactionEpoch: -2,
    maxSnapshots: 0, snapshots, warnings, scenarioApplyEpochByScenarioId: epochs };
  const target = { renderTransactionDiagnostics: diagnostics, untouched: {} };
  assert.equal(ensureRenderTransactionDiagnosticsState(target), undefined);
  assert.equal(ensureLegacyDiagnostics(target), diagnostics);
  assert.equal(target.renderTransactionDiagnostics, diagnostics);
  assert.equal(diagnostics.snapshots, snapshots);
  assert.equal(diagnostics.warnings, warnings);
  assert.equal(diagnostics.scenarioApplyEpochByScenarioId, epochs);
  assert.equal(diagnostics.sequence, 0);
  assert.equal(diagnostics.scenarioApplyEpoch, 3);
  assert.equal(diagnostics.renderTransactionEpoch, 0);
  assert.equal(diagnostics.maxSnapshots, 1);
  assert.equal(diagnostics.globalName, getRenderTransactionGlobalName());
  assert.equal(advanceScenarioApplyEpochState(target, { scenarioId: ' next ', reason: 'import', recordedAt: 123 }), 4);
  assert.deepEqual(diagnostics.lastScenarioApply, { scenarioId: 'next', reason: 'import', recordedAt: 123 });
  assert.deepEqual(epochs, { prior: 2, next: 4 });
});

test('canonical diagnostics initialize malformed collections and leave blank scenario IDs out of index', () => {
  const target = { renderTransactionDiagnostics: { snapshots: null, warnings: {}, scenarioApplyEpochByScenarioId: 0 } };
  assert.equal(ensureRenderTransactionDiagnosticsState(target), undefined);
  const diagnostics = target.renderTransactionDiagnostics;
  assert.deepEqual(diagnostics.snapshots, []);
  assert.deepEqual(diagnostics.warnings, []);
  assert.deepEqual(diagnostics.scenarioApplyEpochByScenarioId, {});
  assert.equal(advanceScenarioApplyEpochState(target, { scenarioId: ' ', recordedAt: 321 }), 1);
  assert.deepEqual(diagnostics.scenarioApplyEpochByScenarioId, {});
  assert.deepEqual(diagnostics.lastScenarioApply, { scenarioId: '', reason: '', recordedAt: 321 });
  assert.equal(ensureLegacyDiagnostics(null).scenarioApplyEpoch, 0);
  assert.equal(nextScenarioApplyEpoch(null), 1);
});

test('legacy epoch API samples the existing clock and keeps the globally exposed diagnostics object live', () => {
  const globalName = getRenderTransactionGlobalName();
  const previous = globalThis[globalName];
  const previousNow = Date.now;
  try {
    Date.now = () => 456;
    const target = { renderTransactionDiagnosticsEnabled: true };
    const diagnostics = exposeRenderTransactionDiagnostics(target);
    assert.equal(globalThis[globalName].state, diagnostics);
    assert.equal(nextScenarioApplyEpoch(target, { scenarioId: ' scene ', reason: 'legacy' }), 1);
    assert.equal(globalThis[globalName].state, diagnostics);
    assert.deepEqual(diagnostics.lastScenarioApply, { scenarioId: 'scene', reason: 'legacy', recordedAt: 456 });
    assert.equal(diagnostics.scenarioApplyEpochByScenarioId.scene, 1);
  } finally {
    Date.now = previousNow;
    if (previous === undefined) delete globalThis[globalName];
    else globalThis[globalName] = previous;
  }
});
