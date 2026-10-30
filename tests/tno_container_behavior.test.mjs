import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCountryInspectorModel } from '../js/ui/sidebar/country_inspector_model.js';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';
import { resolveImportedOwnershipState } from '../js/core/interaction_funnel/import_trust_projection.js';

test('zero-territory container groups its two children and produces no map label', async () => {
  const vendors = {};
  for (const file of ['topojson-client.min.js', 'd3.v7.min.js']) {
    vm.runInNewContext(readFileSync(new URL(`../vendor/${file}`, import.meta.url), 'utf8'), vendors);
  }
  const countries = {
    RKM: { entry_kind: 'scenario_container', feature_count: 0 },
    MS00: { entry_kind: 'scenario_subject', parent_owner_tag: 'RKM', base_iso2: 'RU' },
    MS01: { entry_kind: 'scenario_subject', parent_owner_tag: 'RKM', base_iso2: 'RU' },
  };
  const features = ['one', 'two'].map((id, x) => ({ type: 'Feature', id,
    properties: { id, cntr_code: 'RU' }, geometry: { type: 'Polygon',
      coordinates: [[[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]] } }));
  const state = { activeScenarioId: 'tno_1962', sceneGeneration: 1, currentLanguage: 'en',
    scenarioCountriesByTag: countries, scenarioBaselineOwnersByFeatureId: { one: 'MS00', two: 'MS01' },
    scenarioBundleCacheById: { tno_1962: {
      chunkRegistry: { byLayer: { political: [{ id: 'base', globalCoverage: true, lod: 'coarse', sha256: 'world' }] } },
      chunkPayloadCacheById: { base: { payload: { features } } },
    } } };
  const model = createCountryInspectorModel(state, value => value);
  const entries = Object.entries(countries).map(([code, country]) => ({ code,
    entryKind: country.entry_kind, scenarioSubject: country.entry_kind === 'scenario_subject',
    parentOwnerTag: country.parent_owner_tag,
    inspectorGroupId: model.resolveScenarioInspectorGroupMeta(code).id }));
  assert.deepEqual(model.buildInspectorTopLevelCountryEntries(entries).map(entry => entry.code), ['RKM']);
  assert.deepEqual(model.getScenarioSubjectChildrenForParent('RKM', entries).map(entry => entry.code), ['MS00', 'MS01']);
  const owner = createCountryLabelSourceOwner({ state, topojson: vendors.topojson,
    geoArea: vendors.d3.geoArea, geoContains: vendors.d3.geoContains, geoBounds: vendors.d3.geoBounds,
    isWorkerSupported: () => false, yieldTask: () => Promise.resolve(), getCountryName: code => code });
  try {
    await owner.prepare();
    assert.equal(owner.peekSource().status, 'ready');
    assert.deepEqual(owner.peekSource().countries.map(country => country.countryCode).sort(), ['MS00', 'MS01']);
  } finally {
    owner.dispose();
  }
});

test('saved PG ownership resolves to the current RKP baseline without a feature migration', () => {
  const result = resolveImportedOwnershipState({ sovereigntyByFeatureId: { warsaw: 'PG01' } }, {
    activeScenarioId: 'tno_1962', scenarioBaselineOwnersByFeatureId: { warsaw: 'RKP' },
  });
  assert.deepEqual(result.sovereigntyByFeatureId, { warsaw: 'RKP' });
});
