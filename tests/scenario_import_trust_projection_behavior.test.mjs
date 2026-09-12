import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenarioImportValidFeatureIds } from '../js/core/interaction_funnel/import_trust_projection.js';

const topology = id => Object.freeze({ objects: Object.freeze({ political: Object.freeze({
  geometries: Object.freeze([Object.freeze({ id })]),
}) }) });
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

test('same-scene projection copies runtime identities without borrowing feature payloads', () => {
  const runtimeFeatureIds = Object.freeze(['LIVE_ARRAY']);
  const runtimeFeatureIndexById = new Map([['LIVE_INDEX', new Proxy({}, {
      get() { throw new Error('feature payload must not be inspected'); },
      ownKeys() { throw new Error('feature payload must not be copied'); },
  })]]);
  const target = Object.freeze({
    activeScenarioId: 'current', runtimeFeatureIds, runtimeFeatureIndexById,
    defaultRuntimePoliticalTopology: topology('BASE'), topologyPrimary: null,
    topology: null, topologyDetail: topology('OUTGOING_DETAIL'),
    runtimePoliticalTopology: topology('OUTGOING_RUNTIME'),
  });
  for (const scenarioId of ['current', 'different']) {
    const prepared = Object.freeze({
      staged: Object.freeze({ scenarioId, resolvedOwners: Object.freeze({ UNLOADED: 'GER' }),
        runtimeTopologyPayload: topology('STAGED') }),
    });
    assert.deepEqual([...getScenarioImportValidFeatureIds(target, prepared)].sort(),
      (scenarioId === 'current' ? ['BASE', 'LIVE_ARRAY', 'LIVE_INDEX', 'STAGED', 'UNLOADED']
        : ['BASE', 'STAGED', 'UNLOADED']));
  }
  assert.equal(runtimeFeatureIndexById.size, 1);
  assert.deepEqual(runtimeFeatureIds, ['LIVE_ARRAY']);
});

test('plain projection reads immutable base topology without trusting outgoing runtime IDs', () => {
  const baseTopology = topology('BASE');
  const target = Object.freeze({
    activeScenarioId: 'outgoing', runtimeFeatureIds: Object.freeze(['OUTGOING']),
    runtimeFeatureIndexById: new Map([['OUTGOING_INDEX', {}]]),
    defaultRuntimePoliticalTopology: baseTopology,
    topologyPrimary: null, topology: null, topologyDetail: topology('DETAIL'),
  });
  const ids = getScenarioImportValidFeatureIds(target, null);
  assert.equal(target.defaultRuntimePoliticalTopology, baseTopology);
  assert.deepEqual([...ids].sort(), ['BASE', 'DETAIL']);
  assert.equal(ids.has('OUTGOING'), false);
  assert.equal(ids.has('OUTGOING_INDEX'), false);
});
