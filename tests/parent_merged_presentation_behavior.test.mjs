import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getParentMergedParents, resolveParentMergedContourColor } from '../js/core/renderer/parent_merged_presentation.js';
import { uniquifyScenarioDefaultColors } from '../js/core/state/actions/scenario_activation_actions.js';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';

const countries = () => ({
  ES: {}, CAT: { presentation: 'parent_merged', parent_owner_tag: 'ES' },
  SUBJECT: { parent_owner_tag: 'ES' },
  MISSING: { presentation: 'parent_merged', parent_owner_tag: 'UNKNOWN' },
  OTHER: { presentation: 'other', parent_owner_tag: 'ES' },
});

test('country label geometry joins children to parents and preserves ordinary subjects', async () => {
  const vendor = {};
  for (const name of ['topojson-client.min.js', 'd3.v7.min.js']) {
    vm.runInNewContext(readFileSync(new URL(`../vendor/${name}`, import.meta.url), 'utf8'), vendor);
  }
  const features = ['parent', 'child', 'subject'].map((id, x) => ({
    type: 'Feature', id, properties: {}, geometry: { type: 'Polygon',
      coordinates: [[[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]] },
  }));
  const state = {
    activeScenarioId: 'history', scenarioCountriesByTag: countries(),
    scenarioBaselineOwnersByFeatureId: { parent: 'ES', child: 'CAT', subject: 'SUBJECT' },
    scenarioBundleCacheById: { history: {
      chunkRegistry: { byLayer: { political: [{ id: 'base', globalCoverage: true, lod: 'coarse' }] } },
      chunkPayloadCacheById: { base: { payload: { features } } },
    } },
  };
  const owner = createCountryLabelSourceOwner({ state, topojson: vendor.topojson,
    geoArea: vendor.d3.geoArea, geoContains: vendor.d3.geoContains, geoBounds: vendor.d3.geoBounds,
    isWorkerSupported: () => false, yieldTask: () => Promise.resolve() });
  try {
    await owner.prepare();
    const merged = owner.getSource();
    assert.equal(merged.status, 'ready', merged.error);
    assert.deepEqual(merged.countries.map(country => country.countryCode), ['ES', 'SUBJECT']);
    const parent = merged.countries.find(country => country.countryCode === 'ES');
    assert.equal(vendor.d3.geoContains(parent.feature, [0.5, 0.5]), true);
    assert.equal(vendor.d3.geoContains(parent.feature, [1.5, 0.5]), true);
    assert.equal(vendor.d3.geoContains(parent.feature, [2.5, 0.5]), false);
    state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag, CAT: { parent_owner_tag: 'ES' } };
    await owner.prepare();
    const separate = owner.getSource();
    assert.equal(separate.status, 'ready', separate.error);
    assert.notEqual(separate.sourceToken, merged.sourceToken);
    assert.deepEqual(separate.countries.map(country => country.countryCode), ['CAT', 'ES', 'SUBJECT']);
    assert.equal(vendor.d3.geoContains(separate.countries.find(country => country.countryCode === 'ES').feature, [1.5, 0.5]), false);
  } finally {
    owner.dispose();
  }
});

test('paint contours treat an unedited child default as its parent colour, but keep real edits', () => {
  const parents = getParentMergedParents(countries());
  const baseColors = uniquifyScenarioDefaultColors({ ES: '#f2cd5e', CAT: '#f2cd5e' }, {
    deferred: new Set(parents.keys()),
  });
  assert.notEqual(baseColors.CAT, baseColors.ES);
  assert.equal(resolveParentMergedContourColor({ color: baseColors.CAT, owner: 'CAT', parents, baseColors }), '#f2cd5e');
  assert.equal(resolveParentMergedContourColor({ color: '#123456', owner: 'CAT', parents, baseColors }), '#123456');
  assert.equal(resolveParentMergedContourColor({ color: baseColors.ES, owner: 'ES', parents, baseColors }), baseColors.ES);
  assert.equal(resolveParentMergedContourColor({ color: '#abcdef', owner: 'SUBJECT', parents, baseColors }), '#abcdef');
});
