import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCountryLabelCoverageOwner } from '../js/core/renderer/country_label_coverage.js';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';
import { createBorderIdentityResolver } from '../js/core/renderer/border_identity.js';

const vendor = {};
vm.runInNewContext(readFileSync(new URL('../vendor/topojson-client.min.js', import.meta.url), 'utf8'), vendor);

function fixture() {
  const owners = { one: 'B', two: 'CHILD', sea: 'B', excluded: 'B', other: 'A' };
  const ids = Object.keys(owners);
  const state = {
    activeScenarioId: 'world',
    scenarioCountriesByTag: { A: {}, B: {}, CHILD: { presentation: 'parent_merged', parent_owner_tag: 'B' } },
    scenarioBaselineOwnersByFeatureId: owners,
    sovereignBaseColors: { A: '#111111', B: '#222222', CHILD: '#333333' },
    visualOverrides: {},
    scenarioRuntimeTopologyData: { type: 'Topology',
      arcs: ids.map((_, i) => [[i, 0], [i, 1], [i + 1, 1], [i + 1, 0], [i, 0]]),
      objects: { political: { type: 'GeometryCollection', geometries: ids.map((id, i) => ({
        type: 'Polygon', id, properties: id === 'sea' ? { water_type: 'sea' } : {}, arcs: [[i]],
      })) } },
    },
  };
  const source = createCountryLabelSourceOwner({ state, topojson: vendor.topojson,
    isEligible: (_, id) => id !== 'excluded', yieldTask: () => Promise.resolve() });
  const resolved = [];
  const resolver = createBorderIdentityResolver({ sovereignBaseColors: () => state.sovereignBaseColors,
    getReferenceOwner: (id, feature) => { resolved.push(id); assert.equal(feature.id, id); return owners[id]; },
    getOverrideColor: id => state.visualOverrides[id] });
  const coverage = createCountryLabelCoverageOwner({ state, peekSource: source.peekSource, resolveBorderIdentity: resolver });
  return { state, source, resolved, coverage };
}

test('only eligible label members determine annexation, restoration and uniform recoloring', async () => {
  const { state, source, resolved, coverage } = fixture();
  assert.deepEqual(coverage.getSuppressedCodes(), new Set());
  await source.prepare();
  assert.equal(source.peekSource().status, 'ready');
  assert.deepEqual(coverage.getSuppressedCodes(), new Set());
  assert.deepEqual(resolved.sort(), ['one', 'other', 'two']);

  function paint(changes, hidden) {
    Object.assign(state.visualOverrides, changes);
    resolved.length = 0;
    const ids = Object.keys(changes);
    coverage.notifyColorsChanged(ids);
    assert.deepEqual(coverage.getSuppressedCodes(), new Set(hidden));
    assert.equal(coverage.getSignature(), hidden.join(','));
    assert.deepEqual(resolved, ids);
    coverage.invalidate();
    assert.deepEqual(coverage.getSuppressedCodes(), new Set(hidden));
  }
  paint({ one: '#111111' }, []); // The unpainted child still belongs to B.
  paint({ two: '#111111' }, ['B']);
  paint({ two: '#222222' }, []);
  paint({ two: '#abcdef' }, ['B']);
  paint({ one: '#abcdef' }, []);
  paint({ two: '#fedcba' }, ['B']);
  paint({ other: '#222222' }, ['A', 'B']);

  state.activeScenarioId = '';
  assert.deepEqual(coverage.getSuppressedCodes(), new Set());
  assert.equal(coverage.getSignature(), '');
});

test('full invalidation reclassifies unchanged overrides after a country palette edit', async () => {
  const { state, source, coverage } = fixture();
  await source.prepare();
  state.sovereignBaseColors = { ...state.sovereignBaseColors, A: '#222222' };
  state.visualOverrides = { one: '#222222', two: '#222222' };
  assert.equal(coverage.getSignature(), '');
  state.sovereignBaseColors = { ...state.sovereignBaseColors, B: '#444444' };
  coverage.invalidate();
  assert.equal(coverage.getSignature(), 'B');
});

test('new country metadata and member indexes trigger recounts, and a pending source clears suppression', async () => {
  const { state, source, coverage, resolved } = fixture();
  await source.prepare();
  state.visualOverrides = { one: '#111111', two: '#111111' };
  assert.equal(coverage.getSignature(), 'B');
  resolved.length = 0;
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag };
  source.getSource();
  assert.equal(coverage.getSignature(), 'B');
  assert.deepEqual(resolved.sort(), ['one', 'other', 'two']);
  state.scenarioBaselineOwnersByFeatureId = { ...state.scenarioBaselineOwnersByFeatureId, two: 'A' };
  assert.equal(coverage.getSignature(), '');
  await source.prepare();
  assert.equal(coverage.getSignature(), 'B');
  state.scenarioBaselineOwnersByFeatureId = { ...state.scenarioBaselineOwnersByFeatureId, one: 'A' };
  await source.prepare();
  assert.equal(coverage.getSignature(), '');
});
