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
  const resolver = createBorderIdentityResolver({ sovereignBaseColors: () => state.sovereignBaseColors,
    getReferenceOwner: id => owners[id],
    getOverrideColor: id => state.visualOverrides[id] });
  const coverage = createCountryLabelCoverageOwner({ state, peekSource: source.peekSource, resolveBorderIdentity: resolver });
  return { state, source, coverage };
}

test('only eligible label members determine annexation and restoration', async () => {
  const { state, source, coverage } = fixture();
  await source.prepare();

  function paint(changes, hidden) {
    Object.assign(state.visualOverrides, changes);
    coverage.notifyColorsChanged(Object.keys(changes));
    assert.deepEqual(coverage.getSuppressedCodes(), new Set(hidden));
  }
  paint({ one: '#111111' }, []); // The unpainted child still belongs to B.
  paint({ two: '#111111' }, ['B']);
  paint({ two: '#222222' }, []);
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
