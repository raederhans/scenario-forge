import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/core/state.js';
import { prepareImportedProjectState } from '../js/core/interaction_funnel/import_apply_orchestration.js';

import { importProjectTextThroughFunnel, importProjectThroughFunnel } from '../js/core/interaction_funnel.js';
import { prepareProjectMergeFile } from '../js/core/project_merge_funnel.js';
import { FileManager } from '../js/core/file_manager.js';
import { registerRuntimeHook } from '../js/core/state/index.js';
import { markDirty } from '../js/core/dirty_state.js';

const ui = { t: text => text, showToast: () => {}, showAppDialog: async () => false };
const payload = () => ({ schemaVersion: 21, visualOverrides: { IMPORT_TEST: '#abcdef' },
  styleConfig: {}, layerVisibility: { showCityPoints: false, showPhysical: false,
    showRivers: false, showUrban: false, showTransport: false } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

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
