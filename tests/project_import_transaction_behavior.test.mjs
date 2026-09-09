import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import { state } from '../js/core/state.js';
import { clearHistory, pushHistoryEntry, undoHistory, redoHistory } from '../js/core/history_manager.js';
import { prepareImportedProjectState, commitImportedProjectPatch as applyProjectImportPatch } from '../js/core/interaction_funnel/import_apply_orchestration.js';
import { importProjectTextThroughFunnel, importProjectThroughFunnel, getInteractionFunnelDebugState } from '../js/core/interaction_funnel.js';
import { registerRuntimeHook } from '../js/core/state/index.js';
import { markDirty } from '../js/core/dirty_state.js';
import { getFeatureId, seedSovereigntyFromLandData } from '../js/core/sovereignty_manager.js';
import { captureProjectImportState } from '../js/core/state/actions/project_import_actions.js';
import { nextScenarioApplyEpoch } from '../js/core/renderer/render_transaction_diagnostics.js';
import { createProjectImportCompletion } from '../js/core/interaction_funnel/import_completion.js';
import { commitStartupReadonlyStateFields, clearStartupReadonlyStateForReason } from '../js/core/state/actions/boot_actions.js';

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

test('scenario import never seeds outgoing Atlantropa, TNO split or coarse land ownership', async () => {
  const funnelSource = readFileSync(new URL('../js/core/interaction_funnel.js', import.meta.url), 'utf8');
  const applyNode = parse(funnelSource, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.id?.name === 'applyImportedProjectState');
  const ownerSource = readFileSync(new URL('../js/core/sovereignty_manager.js', import.meta.url), 'utf8');
  const ensureNode = parse(ownerSource, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.id?.name === 'ensureSovereigntyState');
  const outgoingIds = ['ATLPRV_18225', 'AZE-1707__tno1962_1', 'BR'];
  const collection = ids => ({ type: 'FeatureCollection', features: ids.map(id => ({
    id, properties: { cntr_code: 'GER' },
  })) });
  assert.deepEqual(Object.keys(seedSovereigntyFromLandData(collection(outgoingIds))), outgoingIds);
  for (const runtimeFails of [false, true]) {
    const target = { activeScenarioId: 'tno_1962', landData: collection(outgoingIds),
      sovereigntyByFeatureId: {}, mapSemanticMode: 'political' };
    const events = [];
    const globals = {
      state: target, runtimeState: target, debugState: { importApplyCount: 0 },
      createProjectImportCompletion, createImportRecoveryUi: () => () => {},
      commitStartupReadonlyStateFields, clearStartupReadonlyStateForReason,
      captureProjectImportState, commitImportedProjectPatch: applyProjectImportPatch, seedSovereigntyFromLandData,
      normalizeMapSemanticMode: mode => mode, migrateLegacyColorState: () => {},
      ensureOwnerIndexMaps: () => {}, rebuildOwnerIndex: () => events.push('owners'),
      getScenarioResourcesModule: () => {}, captureImportDocumentIdentity: () => [],
      isImportDocumentCurrent: () => true, clearHistory: () => {}, clearDirty: () => {},
      markLegacyColorStateDirty: () => events.push('invalidate'), callRuntimeHook: () => {},
      restoreImportedTransportOverviewDataLayers: () => {},
      restoreImportedTransportCountryOverlayState: () => {}, syncProjectImportUiState: () => {},
      stageImportedProjectPatch: () => ({ sovereigntyByFeatureId: { HOI4_TARGET: 'GER' }, sovereigntyInitialized: false }),
      prepareImportedProjectState: async ({ data }) => ({ data, preparedScenario: {}, importSummary: {},
        manager: {
          commitScenarioForProjectImport: (_prepared, commit) => { target.activeScenarioId = 'hoi4_1936'; commit(); },
          completeScenarioProjectImport: async () => {
            events.push('runtime');
            if (runtimeFails) throw Error('runtime refresh unavailable');
            target.landData = collection(['HOI4_TARGET']);
          },
        },
      }),
    };
    const context = vm.createContext(globals);
    vm.runInContext(ownerSource.slice(ensureNode.start, ensureNode.end), context);
    vm.runInContext(funnelSource.slice(applyNode.start, applyNode.end), context);
    const result = await context.applyImportedProjectState({}, { ui, hooks: {} });
    await result.completion;
    assert.deepEqual(Object.keys(target.sovereigntyByFeatureId), ['HOI4_TARGET']);
    assert.ok(events.indexOf('invalidate') < events.indexOf('runtime'));
    if (runtimeFails) {
      assert.equal(result.status, 'committed-with-warnings');
      assert.equal(result.getRecoveryState().phase, 'blocked');
      assert.equal(target.startupReadonly, true);
      assert.equal(events.includes('owners'), false);
    } else {
      assert.equal(result.status, 'committed');
      assert.ok(events.indexOf('owners') > events.indexOf('runtime'));
    }
  }
});

test('cancelled baseline confirmation preserves document, dirty state and real undo/redo stacks', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    clearHistory();
    const before = { visualOverrides: { IMPORT_TEST: null }, featureOverrides: { IMPORT_TEST: null } };
    const middle = { visualOverrides: { IMPORT_TEST: '#112233' }, featureOverrides: { IMPORT_TEST: null } };
    const after = { visualOverrides: { IMPORT_TEST: '#445566' }, featureOverrides: { IMPORT_TEST: null } };
    pushHistoryEntry({ before, after: middle });
    pushHistoryEntry({ before: middle, after });
    undoHistory();
    const snapshot = () => structuredClone({ colors: state.visualOverrides, dirty: state.isDirty,
      past: state.historyPast, future: state.historyFuture, scenario: state.activeScenarioId });
    const expected = snapshot();
    const source = readFileSync(new URL('../js/core/interaction_funnel.js', import.meta.url), 'utf8');
    const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'applyImportedProjectState');
    const context = vm.createContext({ clearHistory, prepareImportedProjectState, debugState: {},
      getScenarioResourcesModule: async () => ({ validateImportedScenarioBaseline: async () => ({
        ok: false, reason: 'baseline_mismatch', message: 'Changed baseline',
      }) }), getScenarioDispatcherModule: async () => { throw Error('must not select a scenario'); } });
    vm.runInContext(source.slice(fn.start, fn.end), context);
    await assert.rejects(context.applyImportedProjectState({ scenario: { id: 'test' } }, {
      ui: { t: text => text, showAppDialog: async () => false }, hooks: {},
    }), { code: 'IMPORT_ABORTED' });
    assert.deepEqual(snapshot(), expected);
    redoHistory();
    assert.equal(state.visualOverrides.IMPORT_TEST, '#445566');
    undoHistory();
    assert.equal(state.visualOverrides.IMPORT_TEST, '#112233');
    undoHistory();
    assert.equal(state.visualOverrides.IMPORT_TEST, undefined);
  } finally {
    clearHistory();
    globalThis.document = originalDocument;
  }
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

test('plain project preflight preserves base detail regions while leaving an active scenario', async () => {
  const fields = ['activeScenarioId', 'activeScenarioManifest', 'topologyPrimary', 'topologyDetail',
    'defaultRuntimePoliticalTopology', 'runtimePoliticalTopology', 'runtimeFeatureIds', 'landData'];
  const saved = Object.fromEntries(fields.map(key => [key, state[key]]));
  const topology = id => ({ objects: { political: { geometries: [{ id }] } } });
  try {
    state.activeScenarioId = 'tno_1962';
    state.activeScenarioManifest = { display_name: 'TNO 1962' };
    state.topologyPrimary = topology('AF');
    state.topologyDetail = topology('AFG-1741');
    state.defaultRuntimePoliticalTopology = null;
    state.runtimePoliticalTopology = topology('ATLPRV_18225');
    state.runtimeFeatureIds = ['ATLPRV_18225'];
    state.landData = { features: [{ id: 'ATLPRV_18225' }] };
    const prepared = await prepareImportedProjectState({
      data: { scenario: null, visualOverrides: { 'AFG-1741': '#123456', ATLPRV_18225: '#ffffff' },
        sovereigntyByFeatureId: { 'AFG-1741': 'AFG' } },
      ui, debugState: {}, getScenarioResourcesModule: async () => ({}),
      getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => null }),
    });
    assert.deepEqual(prepared.data.visualOverrides, { 'AFG-1741': '#123456' });
    assert.deepEqual(prepared.data.sovereigntyByFeatureId, { 'AFG-1741': 'AFG' });
    assert.equal(prepared.importSummary.scenarioId, '');
    assert.equal(prepared.importSummary.scenarioName, '');
    assert.equal(state.activeScenarioId, 'tno_1962');
  } finally { Object.assign(state, saved); }
});

test('stale palette completion cannot commit or restore over a newer selection', async () => {
  const source = readFileSync(new URL('../js/core/palette_manager.js', import.meta.url), 'utf8');
  const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'setActivePaletteSource');
  const load = deferred();
  let current = true;
  let writes = 0;
  const context = vm.createContext({ runtimeState: {},
    ensurePaletteAssetsLoaded: () => load.promise,
    commitActivePaletteSourceState: () => { writes += 1; },
    restoreActivePaletteSourceState: () => { writes += 1; },
    setPaletteLoadErrorState: () => { writes += 1; },
  });
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const pending = context.setActivePaletteSource('old', { isCurrent: () => current });
  current = false;
  load.resolve({ meta: {}, pack: {}, map: {} });
  assert.equal(await pending, false);
  assert.equal(writes, 0);
});

test('staged project patch includes unchanged visibility values and leaves live state untouched', async () => {
  const source = readFileSync(new URL('../js/core/interaction_funnel.js', import.meta.url), 'utf8');
  const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'stageImportedProjectPatch');
  const globals = Object.assign({},
    await import('../js/core/state.js'), await import('../js/core/releasable_manager.js'),
    await import('../js/core/special_zone_layers.js'), await import('../js/core/state/dev_state.js'),
    await import('../js/core/state/strategic_overlay_state.js'),
    { cloneImportedProjectValue: structuredClone, captureProjectImportState });
  const context = vm.createContext(globals);
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const oldStyle = structuredClone(state.styleConfig);
  const oldColors = state.visualOverrides;
  const data = payload();
  data.layerVisibility.showRivers = state.showRivers;
  const patch = context.stageImportedProjectPatch(data, {
    scenarioState: { activeScenarioId: '' }, importedOwnershipState: { sovereigntyByFeatureId: {} },
    validFeatureIds: null,
  });
  assert.equal(Object.hasOwn(patch, 'showRivers'), true, 'scene activation can change an equal-valued field before project commit');
  assert.equal(patch.showRivers, state.showRivers);
  assert.equal(state.visualOverrides, oldColors);
  assert.deepEqual(state.styleConfig, oldStyle);
  const admitted = captureProjectImportState(state);
  assert.deepEqual(Object.keys(patch).filter(key => !Object.hasOwn(admitted, key)), []);
  const target = {};
  applyProjectImportPatch(target, patch);
  assert.deepEqual(Object.keys(target).sort(), Object.keys(patch).sort());
  assert.equal(target.showRivers, patch.showRivers);
});

test('configured optional scenario resource null is failure; absent configuration and chunk ownership are valid', async () => {
  const source = readFileSync(new URL('../js/core/interaction_funnel.js', import.meta.url), 'utf8');
  const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(node => node.id?.name === 'restoreImportedScenarioOptionalLayer');
  let chunkOwned = false;
  const context = vm.createContext({ getScenarioResourcesModule: async () => ({
    ensureActiveScenarioOptionalLayerLoaded: async () => null,
    scenarioBundleUsesChunkedLayer: () => chunkOwned,
  }) });
  vm.runInContext(source.slice(fn.start, fn.end), context);
  const prepared = { preparedScenario: { bundle: { manifest: { city_overrides_url: 'cities.json' } } } };
  await assert.rejects(context.restoreImportedScenarioOptionalLayer('cities', prepared, () => true), /cities could not be restored/);
  chunkOwned = true;
  assert.equal(await context.restoreImportedScenarioOptionalLayer('cities', prepared, () => true), null);
  chunkOwned = false;
  delete prepared.preparedScenario.bundle.manifest.city_overrides_url;
  assert.equal(await context.restoreImportedScenarioOptionalLayer('cities', prepared, () => true), null);
});

test('context loader swallowed failure produces named warning but topology-provided null is valid', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  registerRuntimeHook(state, 'ensureContextLayerDataFn', async () => ({ rivers: null }));
  try {
    const data = payload();
    data.layerVisibility.showRivers = true;
    const result = await importProjectTextThroughFunnel(JSON.stringify(data), { ui });
    await result.completion;
    assert.equal(result.status, 'committed');
    assert.ok(result.getRecoveryState().warnings.some(warning => warning.resource === 'rivers'));
    const source = readFileSync(new URL('../js/core/interaction_funnel.js', import.meta.url), 'utf8');
    const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .find(node => node.id?.name === 'validateImportedContextLayerResult');
    const context = vm.createContext({});
    vm.runInContext(source.slice(fn.start, fn.end), context);
    assert.doesNotThrow(() => context.validateImportedContextLayerResult({ rivers: null }, {
      contextLayerLoadStateByName: { rivers: 'loaded' },
    }));
  } finally {
    registerRuntimeHook(state, 'ensureContextLayerDataFn', null);
    globalThis.document = oldDocument;
  }
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
