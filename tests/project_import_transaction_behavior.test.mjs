import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/core/state.js';
import { prepareImportedProjectState, commitImportedProjectPatch as applyProjectImportPatch } from '../js/core/interaction_funnel/import_apply_orchestration.js';
import { getScenarioImportValidFeatureIds } from '../js/core/interaction_funnel/import_trust_projection.js';
import { importProjectTextThroughFunnel, importProjectThroughFunnel, getDocumentEditGate, getInteractionFunnelDebugState } from '../js/core/interaction_funnel.js';
import { prepareProjectMergeFile } from '../js/core/project_merge_funnel.js';
import { FileManager } from '../js/core/file_manager.js';
import { registerRuntimeHook } from '../js/core/state/index.js';
import { markDirty } from '../js/core/dirty_state.js';
import { captureProjectImportState } from '../js/core/state/actions/project_import_actions.js';
import { nextScenarioApplyEpoch } from '../js/core/renderer/render_transaction_diagnostics.js';

const ui = { t: text => text, showToast: () => {}, showAppDialog: async () => false };
const payload = () => ({ schemaVersion: 21, visualOverrides: { IMPORT_TEST: '#abcdef' },
  styleConfig: {}, layerVisibility: { showCityPoints: false, showPhysical: false,
    showRivers: false, showUrban: false, showTransport: false } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('import coordinator restores every domain field synchronously and preserves rollback references', () => {
  const saved = captureProjectImportState(state);
  const target = {};
  assert.equal(applyProjectImportPatch(target, saved), undefined);
  assert.deepEqual(Object.keys(target).sort(), Object.keys(saved).sort());
  for (const key of Object.keys(saved)) assert.equal(target[key], saved[key], key);
  const patch = {
    activeSovereignCode: 'GER', showRivers: !target.showRivers,
    appearancePresets: { presets: [] }, sovereigntyByFeatureId: { TARGET: 'GER' },
    dynamicBordersDirty: !target.dynamicBordersDirty, exportWorkbenchUi: {},
    intensityFields: { channels: [] }, specialZoneLayers: {}, unitCounters: [],
    styleConfig: {}, parentBordersVisible: !target.parentBordersVisible,
    referenceImageState: {}, transportWorkbenchUi: {}, waterRegionOverrides: {},
    recentColors: ['#123456'], unrelatedUnownedRuntimeField: 'must not land',
  };
  const snapshot = captureProjectImportState(target);
  assert.equal(applyProjectImportPatch(target, patch), undefined);
  for (const key of Object.keys(patch)) {
    if (key === 'unrelatedUnownedRuntimeField') assert.equal(Object.hasOwn(target, key), false);
    else assert.equal(target[key], patch[key], key);
  }
  applyProjectImportPatch(target, snapshot);
  for (const key of Object.keys(saved)) assert.equal(target[key], saved[key], key);
});

test('required scenario preparation rejects without resetting the existing document', async () => {
  const before = { colors: state.visualOverrides, past: state.historyPast, future: state.historyFuture,
    dirty: state.isDirty, scene: state.activeScenarioId };
  await assert.rejects(prepareImportedProjectState({
    data: { scenario: { id: 'missing-assets' } }, ui, debugState: {},
    getScenarioResourcesModule: async () => ({ validateImportedScenarioBaseline: async () => ({ ok: true }) }),
    getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => { throw Error('owners unavailable'); } }),
  }), /owners unavailable/);
  assert.deepEqual({ colors: state.visualOverrides, past: state.historyPast, future: state.historyFuture,
    dirty: state.isDirty, scene: state.activeScenarioId }, before);
});

test('preflight preserves unloaded trusted owners without selecting its target scene', async () => {
  const scene = state.activeScenarioId;
  const colors = state.visualOverrides;
  const prepared = await prepareImportedProjectState({
    data: { scenario: { id: 'target' }, visualOverrides: { UNLOADED: '#123456', FORGED: '#ffffff' } },
    ui, debugState: {},
    getScenarioResourcesModule: async () => ({ validateImportedScenarioBaseline: async () => ({ ok: true }) }),
    getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => ({
      bundle: { manifest: { scenario_id: 'target', display_name: 'Target' } },
      staged: { scenarioId: 'target', resolvedOwners: { UNLOADED: 'GER' }, countryMap: {},
        runtimeTopologyPayload: { objects: { political: { geometries: [{ id: 'LOADED' }] } } } },
    }) }),
  });
  assert.equal(state.activeScenarioId, scene);
  assert.equal(state.visualOverrides, colors);
  assert.deepEqual(prepared.data.visualOverrides, { UNLOADED: '#123456' });
  assert.equal(prepared.importSummary.scenarioId, 'target');
});

test('plain project trust projection preserves base detail regions and excludes outgoing scenario identities', () => {
  const topology = id => ({ objects: { political: { geometries: [{ id }] } } });
  const outgoingRuntimeIds = ['ATLPRV_18225'];
  const target = Object.freeze({
    activeScenarioId: 'tno_1962',
    topologyPrimary: topology('AF'),
    topologyDetail: topology('AFG-1741'),
    defaultRuntimePoliticalTopology: null,
    runtimePoliticalTopology: topology(outgoingRuntimeIds[0]),
    runtimeFeatureIds: outgoingRuntimeIds,
    landData: { features: [{ id: outgoingRuntimeIds[0] }] },
  });
  const validIds = getScenarioImportValidFeatureIds(target, null);
  assert.deepEqual([...validIds].sort(), ['AF', 'AFG-1741']);
  assert.equal(validIds.has(outgoingRuntimeIds[0]), false);
  assert.equal(target.activeScenarioId, 'tno_1962');
  assert.deepEqual(target.runtimeFeatureIds, outgoingRuntimeIds);
});

test('trusted import universe retains composite coarse features alongside unloaded scenario regions', async () => {
  const { getScenarioImportValidFeatureIds } = await import('../js/core/interaction_funnel/import_trust_projection.js');
  const ids = getScenarioImportValidFeatureIds({
    activeScenarioId: 'hoi4_1936',
    runtimeFeatureIds: ['RUNTIME_ONLY'],
    runtimeFeatureIndexById: new Map([['INDEX_ONLY', {}]]),
    defaultRuntimePoliticalTopology: { objects: { political: { geometries: [{ id: 'AE' }] } } },
    topologyPrimary: { objects: { political: { geometries: [{ id: 'AD' }, { id: 'AU__1' }] } } },
    // Outgoing rendered data and detail variants are not shared-base authorities.
    landData: { features: [{ id: 'ATLPRV_18225' }] },
    topologyDetail: { objects: { political: { geometries: [{ id: 'AZE-1707__tno1962_1' }] } } },
  }, { staged: { scenarioId: 'hoi4_1936', resolvedOwners: { UNLOADED: 'GER' },
    runtimeTopologyPayload: { objects: { political: { geometries: [{ id: 'STAGED' }] } } } } });
  assert.deepEqual([...ids].sort(), ['AD', 'AE', 'AU__1', 'INDEX_ONLY', 'RUNTIME_ONLY', 'STAGED', 'UNLOADED']);
  assert.equal(ids.has('U1_FORGED_FEATURE'), false);
  assert.equal(ids.has('ATLPRV_18225'), false);
  assert.equal(ids.has('AZE-1707__tno1962_1'), false);
  const fallbackIds = getScenarioImportValidFeatureIds({
    topology: { objects: { political: { geometries: [{ id: 'AD' }] } } },
  });
  assert.deepEqual([...fallbackIds], ['AD']);
});

test('file request is awaitable; duplicate pending imports and edits while reading cannot commit', async () => {
  const oldDocument = globalThis.document;
  const oldReader = globalThis.FileReader;
  globalThis.document = { getElementById: () => null };
  const started = deferred();
  let reader;
  globalThis.FileReader = class {
    readAsText() { reader = this; started.resolve(); }
  };
  try {
    const first = importProjectThroughFunnel({ name: 'test.json', text: 'unused' }, { ui });
    assert.equal(typeof first.then, 'function');
    await started.promise;
    const second = await importProjectTextThroughFunnel(JSON.stringify(payload()), { ui });
    assert.equal(second.status, 'failed');
    assert.equal(second.reason, 'import-in-progress');
    await assert.rejects(prepareProjectMergeFile({ name: 'merge.json' }), /import-in-progress/);
    markDirty('edit-during-file-read');
    const colors = state.visualOverrides;
    reader.result = JSON.stringify(payload());
    await reader.onload();
    assert.equal((await first).status, 'cancelled');
    assert.equal(state.visualOverrides, colors);
    assert.equal(state.isDirty, true);
  } finally {
    globalThis.document = oldDocument;
    globalThis.FileReader = oldReader;
  }
});

test('whole-project import restores exported legend labels and rolls them back if the commit fails', async t => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const previousLabels = state.legendLabels;
  t.after(() => { globalThis.document = previousDocument; state.legendLabels = previousLabels; });
  const labels = { '#112233': 'Border', '#abcdef': 'River' };
  const project = FileManager.buildProjectPayload({ ...state, legendLabels: labels });
  const open = () => importProjectTextThroughFunnel(JSON.stringify(project), { ui });
  const result = await open();
  await result.completion;
  assert.equal(result.status, 'committed');
  assert.deepEqual(state.legendLabels, labels);

  const before = { '#445566': 'Current map' };
  state.legendLabels = before;
  const original = Object.getOwnPropertyDescriptor(state, 'onlyUnpainted');
  t.after(() => Object.defineProperty(state, 'onlyUnpainted', original));
  let duringCommit;
  Object.defineProperty(state, 'onlyUnpainted', { configurable: true, get: () => original.value,
    set() {
      duringCommit = state.legendLabels;
      Object.defineProperty(state, 'onlyUnpainted', original);
      throw Error('Interrupted project commit');
    },
  });
  const failed = await open();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /Interrupted project commit/);
  assert.deepEqual(duringCommit, labels);
  assert.deepEqual(state.legendLabels, before);
});

test('merge checks document readiness at read, preview and commit and invalidates stale previews', async t => {
  const original = { dirtyRevision: state.dirtyRevision, activeScenarioId: state.activeScenarioId,
    historyPast: state.historyPast, historyFuture: state.historyFuture, startupReadonly: state.startupReadonly,
    scenarioApplyInFlight: state.scenarioApplyInFlight };
  t.after(() => Object.assign(state, original));
  const source = { ...payload(), scenario: { id: 'source' },
    riverPaint: { overrides: { UNKNOWN_CELL: '#abc' } }, legendLabels: { bad_key: 'invalid' } };
  const file = { name: 'paint.json', text: async () => JSON.stringify(source) };
  const loadReference = async id => { assert.equal(id, 'source'); return {}; };
  state.startupReadonly = true;
  await assert.rejects(prepareProjectMergeFile(file, { loadReference }), /startup-readonly/);
  state.startupReadonly = false;
  const preview = await prepareProjectMergeFile(file, { loadReference });
  state.scenarioApplyInFlight = true;
  assert.throws(() => preview(), /scenario-apply-in-progress/);
  state.scenarioApplyInFlight = false;
  const plan = preview();
  assert.ok(plan.report.unmatchedIds.includes('UNKNOWN_CELL'));
  assert.deepEqual(plan.report.invalidColors, [{ field: 'legendLabels', id: 'bad_key' }]);
  state.startupReadonly = true;
  assert.throws(() => plan.commit(), /startup-readonly/);
  state.startupReadonly = false;
  for (const [key, value] of Object.entries({ dirtyRevision: state.dirtyRevision + 1, activeScenarioId: 'other',
    historyPast: [], historyFuture: [] })) {
    const current = preview();
    state[key] = value;
    assert.equal(current.commit(), 'stale', key);
  }
  for (const envelope of [{ format: 'scenario-forge-hgo' }, { scenario: { id: 'hgo_1936' } }]) {
    await assert.rejects(prepareProjectMergeFile({ ...file, text: async () => JSON.stringify(envelope) },
      { loadReference }), error => error.userMessage === 'Open this HGO project in the HGO editor.');
  }
});

test('required import recovery blocks merging until the failed resource is restored', async t => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { globalThis.document = previousDocument; registerRuntimeHook(state, 'clearExportBakeCacheFn', null); });
  registerRuntimeHook(state, 'clearExportBakeCacheFn', () => { throw Error('map display unavailable'); });
  const result = await importProjectTextThroughFunnel(JSON.stringify(payload()), { ui });
  assert.equal(getDocumentEditGate().reason, 'import-recovery-required');
  await assert.rejects(prepareProjectMergeFile({ name: 'paint.json' }), /import-recovery-required/);
  registerRuntimeHook(state, 'clearExportBakeCacheFn', null);
  assert.equal(await result.retry('document-refresh'), true);
  assert.equal(getDocumentEditGate().editable, true);
});

test('a diagnostic scenario epoch change cancels an import even without dirty or request changes', async () => {
  const oldDocument = globalThis.document;
  const oldReader = globalThis.FileReader;
  globalThis.document = { getElementById: () => null };
  const started = deferred();
  let reader;
  globalThis.FileReader = class {
    readAsText() { reader = this; started.resolve(); }
  };
  try {
    nextScenarioApplyEpoch(state, { scenarioId: state.activeScenarioId, reason: 'test-initial-epoch' });
    const dirtyRevision = state.dirtyRevision;
    const requestId = state.currentScenarioApplyRequestId;
    const colors = state.visualOverrides;
    const pending = importProjectThroughFunnel({ name: 'epoch.json' }, { ui });
    await started.promise;
    nextScenarioApplyEpoch(state, { scenarioId: state.activeScenarioId, reason: 'test-new-epoch' });
    assert.equal(state.dirtyRevision, dirtyRevision);
    assert.equal(state.currentScenarioApplyRequestId, requestId);
    reader.result = JSON.stringify(payload());
    await reader.onload();
    assert.equal((await pending).status, 'cancelled');
    assert.equal(state.visualOverrides, colors);
  } finally {
    globalThis.document = oldDocument;
    globalThis.FileReader = oldReader;
  }
});

test('optional failure has a named retry; later edits invalidate retry and stay dirty', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  let attempts = 0;
  registerRuntimeHook(state, 'ensureContextLayerDataFn', async () => {
    attempts += 1;
    if (attempts === 1) throw Error('rivers temporarily unavailable');
  });
  try {
    const data = payload();
    data.layerVisibility.showRivers = true;
    const result = await importProjectTextThroughFunnel(JSON.stringify(data), { ui });
    await result.completion;
    assert.equal(result.status, 'committed');
    assert.ok(result.getRecoveryState().warnings.some(warning => warning.resource === 'rivers'));
    assert.equal(state.isDirty, false);
    assert.equal(state.historyPast.length, 0);
    assert.equal(await result.retry('rivers'), true);
    assert.equal(attempts, 2);
    markDirty('new-edit');
    assert.equal(await result.retry('rivers'), false);
    assert.equal(state.isDirty, true);
  } finally {
    registerRuntimeHook(state, 'ensureContextLayerDataFn', null);
    globalThis.document = oldDocument;
  }
});

test('editing during optional completion does not clear the newer dirty baseline', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const started = deferred();
  const finish = deferred();
  registerRuntimeHook(state, 'ensureContextLayerDataFn', async () => { started.resolve(); await finish.promise; });
  try {
    const data = payload();
    data.layerVisibility.showRivers = true;
    const beforeCount = getInteractionFunnelDebugState().importApplyCount;
    const pending = importProjectTextThroughFunnel(JSON.stringify(data), { ui });
    await started.promise;
    markDirty('new-edit-during-optional');
    finish.resolve();
    const result = await pending;
    await result.completion;
    assert.ok(['committed', 'committed-with-warnings'].includes(result.status));
    assert.equal(state.isDirty, true);
    assert.equal(state.lastDirtyReason, 'new-edit-during-optional');
    assert.equal(getInteractionFunnelDebugState().importApplyCount, beforeCount + 1);
    assert.equal(getInteractionFunnelDebugState().importPhase, 'completion-cancelled');
  } finally {
    registerRuntimeHook(state, 'ensureContextLayerDataFn', null);
    globalThis.document = oldDocument;
  }
});

test('a hung optional loader does not occupy import; replacement revokes old loader writes', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const started = deferred();
  const finish = deferred();
  let staleWrites = 0;
  registerRuntimeHook(state, 'ensureContextLayerDataFn', async (_layer, { isCurrent, signal }) => {
    started.resolve();
    await finish.promise;
    if (isCurrent() && !signal.aborted) staleWrites++;
  });
  try {
    const firstData = payload();
    firstData.layerVisibility.showRivers = true;
    const first = await importProjectThroughFunnel(null, { ui, projectPayload: firstData });
    await started.promise;
    assert.equal(first.getRecoveryState().editable, true);
    const secondData = payload();
    secondData.visualOverrides.IMPORT_TEST = '#112233';
    const second = await importProjectThroughFunnel(null, { ui, projectPayload: secondData });
    assert.equal(second.status, 'committed');
    await second.completion;
    assert.equal((await first.completion).phase, 'cancelled');
    finish.resolve();
    await Promise.resolve();
    assert.equal(staleWrites, 0);
    assert.equal(state.visualOverrides.IMPORT_TEST, '#112233');
  } finally {
    finish.resolve();
    registerRuntimeHook(state, 'ensureContextLayerDataFn', null);
    globalThis.document = oldDocument;
  }
});
