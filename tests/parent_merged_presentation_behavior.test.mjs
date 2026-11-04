import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getParentMergedParents, resolveParentMergedBorderKeys } from '../js/core/renderer/parent_merged_presentation.js';
import { uniquifyScenarioDefaultColors } from '../js/core/state/actions/scenario_activation_actions.js';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';

const countries = () => ({
  ES: {}, CAT: { presentation: 'parent_merged', parent_owner_tag: 'ES' },
  SUBJECT: { parent_owner_tag: 'ES' },
  MISSING: { presentation: 'parent_merged', parent_owner_tag: 'UNKNOWN' },
  OTHER: { presentation: 'other', parent_owner_tag: 'ES' },
});

for (const asMap of [false, true]) {
  test(`filters declared parent-merged countries and caches by identity (${asMap ? 'Map' : 'object'})`, () => {
    const input = asMap ? new Map(Object.entries(countries())) : countries();
    const parents = getParentMergedParents(input);
    assert.deepEqual([...parents], [['CAT', 'ES']]);
    assert.equal(getParentMergedParents(input), parents);
    const replacement = asMap ? new Map(input) : { ...input };
    assert.notEqual(getParentMergedParents(replacement), parents);
    assert.deepEqual(getParentMergedParents(replacement), parents);
  });
}

test('border keys merge only an unpainted parent-merged child', () => {
  const parents = getParentMergedParents(countries());
  assert.deepEqual(resolveParentMergedBorderKeys({ borderKey: 'CAT', reference: 'CAT', parentKey: 'ES', parents }),
    { borderKey: 'ES', parentKey: 'subject:CAT', homeKey: 'ES' });
  assert.deepEqual(resolveParentMergedBorderKeys({ borderKey: 'FR', reference: 'CAT', parentKey: 'ES', parents }),
    { borderKey: 'FR', parentKey: 'ES', homeKey: 'FR' });
  assert.deepEqual(resolveParentMergedBorderKeys({ borderKey: 'SUBJECT', reference: 'SUBJECT', parentKey: 'ES', parents }),
    { borderKey: 'SUBJECT', parentKey: 'ES', homeKey: 'SUBJECT' });
});

test('deferred children preserve the parent color even when preferred', () => {
  const input = { CAT: '#123456', ES: '#123456' };
  for (const preferred of [[], ['CAT']]) {
    const colors = uniquifyScenarioDefaultColors(input, {
      preferred, deferred: new Set(getParentMergedParents(countries()).keys()),
    });
    assert.equal(colors.ES, input.ES);
    assert.notEqual(colors.CAT, colors.ES);
    const difference = [1, 3, 5].reduce((sum, offset) => sum + Math.abs(
      parseInt(colors.CAT.slice(offset, offset + 2), 16) - parseInt(colors.ES.slice(offset, offset + 2), 16)), 0);
    assert.ok(difference <= 3);
  }
  assert.deepEqual(input, { CAT: '#123456', ES: '#123456' });
  assert.equal(uniquifyScenarioDefaultColors(input).CAT, input.CAT);
  assert.equal(uniquifyScenarioDefaultColors(input, { preferred: ['ES'] }).ES, input.ES);
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
