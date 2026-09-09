import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/core/state.js';
import { prepareImportedProjectState } from '../js/core/interaction_funnel/import_apply_orchestration.js';
import { getScenarioImportValidFeatureIds } from '../js/core/interaction_funnel/import_trust_projection.js';

const topology = id => Object.freeze({ objects: Object.freeze({ political: Object.freeze({
  geometries: Object.freeze([Object.freeze({ id })]),
}) }) });
const fields = ['activeScenarioId', 'runtimeFeatureIds', 'runtimeFeatureIndexById',
  'defaultRuntimePoliticalTopology', 'runtimePoliticalTopology', 'topologyPrimary', 'topology', 'topologyDetail'];
const ui = { t: value => value, showAppDialog: async () => false };

test('trusted identity results are detached from deeply frozen topology and runtime IDs', () => {
  const target = Object.freeze({ activeScenarioId: 'same',
    runtimeFeatureIds: Object.freeze(['LIVE']), defaultRuntimePoliticalTopology: topology('BASE') });
  const prepared = Object.freeze({ staged: Object.freeze({ scenarioId: 'same',
    resolvedOwners: Object.freeze({ UNLOADED: 'GER' }), runtimeTopologyPayload: topology('STAGED') }) });
  const first = getScenarioImportValidFeatureIds(target, prepared);
  first.clear();
  first.add('FORGED');
  assert.deepEqual([...getScenarioImportValidFeatureIds(target, prepared)].sort(), ['BASE', 'LIVE', 'STAGED', 'UNLOADED']);
  assert.deepEqual(target.runtimeFeatureIds, ['LIVE']);
});

test('preparation copies only same-scene runtime identities and never borrows runtime feature payloads', async () => {
  const saved = Object.fromEntries(fields.map(key => [key, state[key]]));
  try {
    state.activeScenarioId = 'current';
    state.runtimeFeatureIds = Object.freeze(['LIVE_ARRAY']);
    state.runtimeFeatureIndexById = new Map([['LIVE_INDEX', new Proxy({}, {
      get() { throw new Error('feature payload must not be inspected'); },
      ownKeys() { throw new Error('feature payload must not be copied'); },
    })]]);
    state.defaultRuntimePoliticalTopology = topology('BASE');
    state.topologyPrimary = null;
    state.topology = null;
    state.topologyDetail = topology('OUTGOING_DETAIL');
    state.runtimePoliticalTopology = topology('OUTGOING_RUNTIME');
    for (const scenarioId of ['current', 'different']) {
      const prepared = await prepareImportedProjectState({
        data: { scenario: { id: scenarioId }, visualOverrides: {
          LIVE_ARRAY: '#123456', LIVE_INDEX: '#123456', BASE: '#123456',
          UNLOADED: '#123456', STAGED: '#123456', OUTGOING_DETAIL: '#123456',
          OUTGOING_RUNTIME: '#123456', FORGED: '#123456',
        } },
        ui, debugState: {},
        getScenarioResourcesModule: async () => ({ validateImportedScenarioBaseline: async () => ({ ok: true }) }),
        getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => ({
          bundle: { manifest: {} }, staged: { scenarioId, resolvedOwners: { UNLOADED: 'GER' },
            runtimeTopologyPayload: topology('STAGED'), countryMap: {} },
        }) }),
      });
      assert.deepEqual(Object.keys(prepared.data.visualOverrides).sort(),
        (scenarioId === 'current' ? ['BASE', 'LIVE_ARRAY', 'LIVE_INDEX', 'STAGED', 'UNLOADED']
          : ['BASE', 'STAGED', 'UNLOADED']));
      assert.equal(Object.hasOwn(prepared.scenarioState, 'runtimeFeatureIndexById'), false);
      assert.equal(Object.hasOwn(prepared.scenarioState, 'runtimeFeatureIds'), false);
      assert.equal(state.runtimeFeatureIndexById.size, 1);
    }
  } finally { Object.assign(state, saved); }
});

test('plain preparation reads immutable base topology without leaking it or trusting outgoing runtime IDs', async () => {
  const saved = Object.fromEntries(fields.map(key => [key, state[key]]));
  try {
    state.activeScenarioId = 'outgoing';
    state.runtimeFeatureIds = ['OUTGOING'];
    state.runtimeFeatureIndexById = new Map([['OUTGOING_INDEX', {}]]);
    const baseTopology = topology('BASE');
    state.defaultRuntimePoliticalTopology = baseTopology;
    state.topologyPrimary = null;
    state.topology = null;
    state.topologyDetail = topology('DETAIL');
    const prepared = await prepareImportedProjectState({
      data: { visualOverrides: { BASE: '#123456', DETAIL: '#123456', OUTGOING: '#123456', OUTGOING_INDEX: '#123456' } },
      ui, debugState: {}, getScenarioResourcesModule: async () => ({}),
      getScenarioManagerModule: async () => ({ prepareScenarioForProjectImport: async () => null }),
    });
    assert.equal(state.defaultRuntimePoliticalTopology, baseTopology);
    assert.equal(Object.hasOwn(prepared.scenarioState, 'runtimePoliticalTopology'), false);
    assert.deepEqual(Object.keys(prepared.data.visualOverrides).sort(), ['BASE', 'DETAIL']);
  } finally { Object.assign(state, saved); }
});
