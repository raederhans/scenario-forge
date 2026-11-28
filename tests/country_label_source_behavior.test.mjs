import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';
import { mergeCountryLabelGroups } from '../js/core/renderer/country_label_geometry.js';

const sandbox = {};
vm.runInNewContext(readFileSync(new URL('../vendor/topojson-client.min.js', import.meta.url), 'utf8'), sandbox);
vm.runInNewContext(readFileSync(new URL('../vendor/d3.v7.min.js', import.meta.url), 'utf8'), sandbox);
const topojson = sandbox.topojson;
const ring = (x, y, w = 1) => [[x, y], [x, y + 1], [x + w, y + 1], [x + w, y], [x, y]];
const feature = (id, x, country = 'AA', overrides = {}) => ({ type: 'Feature', id,
  properties: { cntr_code: country, ...overrides }, geometry: { type: 'Polygon', coordinates: [ring(x, 0)] } });
function fixture(extra = {}, helpers = {}) {
  const payload = { features: [feature('one', 0), feature('two', 1), feature('three', 4)] };
  const bundle = { chunkRegistry: { byLayer: { political: [{ id: 'base', globalCoverage: true, lod: 'coarse', sha256: 'world' }] } },
    chunkPayloadCacheById: { base: { payload } } };
  const state = { activeScenarioId: 'history', sceneGeneration: 1, currentLanguage: 'en',
    scenarioBaselineOwnersByFeatureId: Object.freeze({ one: 'AAA', two: 'AAA', three: 'BBB' }),
    scenarioCountriesByTag: { AAA: { en: 'Historical A', zh: '历史甲' }, BBB: { en: 'Historical B', zh: '历史乙' } },
    sovereignBaseColors: { AAA: '#123456', BBB: '#123456' },
    scenarioBundleCacheById: { history: bundle }, ...extra };
  const owner = createCountryLabelSourceOwner({ state, topojson, geoArea: sandbox.d3.geoArea,
    geoContains: sandbox.d3.geoContains, geoBounds: sandbox.d3.geoBounds,
    yieldTask: () => Promise.resolve(),
    getCountryName: code => state.scenarioCountriesByTag[code]?.[state.currentLanguage], ...helpers });
  return { owner, state };
}

test('exact axial endpoint splitting preserves a real narrow gap and detached land', async () => {
  const gap = 1e-8;
  const members = [feature('mainland', 0, 'AA', { detail_tier: 'coarse' }),
    feature('other-side', 1 + gap, 'AA', { detail_tier: 'fine' }), feature('island', 4)];
  const original = JSON.stringify(members);
  const [record] = await mergeCountryLabelGroups([['AAA', members]], {
    topojson, geoArea: sandbox.d3.geoArea, geoContains: sandbox.d3.geoContains, geoBounds: sandbox.d3.geoBounds,
  });
  assert.equal(record.geometry.coordinates.length, 3);
  assert.equal(sandbox.d3.geoContains(record.geometry, [1 + gap / 2, 0.5]), false);
  assert.equal(sandbox.d3.geoContains(record.geometry, [3, 0.5]), false);
  assert.equal(JSON.stringify(members), original);
});

test('stitched ring nesting preserves dateline holes, inner islands and a separate mainland', async () => {
  const exterior = [[170, -6], [170, 6], [-170, 6], [-170, -6], [170, -6]];
  const hole = [[175, -3], [175, 3], [-175, 3], [-175, -3], [175, -3]];
  const island = [[178, -1], [178, 1], [-178, 1], [-178, -1], [178, -1]];
  const merged = { type: 'MultiPolygon', coordinates: [[ring(0, 0), hole, island, exterior]] };
  const [record] = await mergeCountryLabelGroups([['AAA', [feature('one', 0), feature('two', 1)]]], {
    topojson: { merge: () => merged }, geoArea: sandbox.d3.geoArea,
    geoContains: sandbox.d3.geoContains, geoBounds: sandbox.d3.geoBounds,
  });
  assert.equal(record.geometry.coordinates.length, 3);
  for (const p of [[0.5, 0.5], [172, 0], [-172, 0], [179, 0], [-179, 0]]) assert.equal(sandbox.d3.geoContains(record.geometry, p), true, p.join(','));
  for (const p of [[176, 0], [-176, 0], [160, 0], [180, 4.5]]) {
    assert.equal(sandbox.d3.geoContains(record.geometry, p), p[1] === 4.5, p.join(','));
  }
  assert.ok(sandbox.d3.geoArea(record.geometry) < 0.1);
});

test('replacing the scene terminates an active geometry worker before stale publication', async () => {
  let messageSent, terminated = 0;
  const sent = new Promise(resolve => { messageSent = resolve; });
  const { owner, state } = fixture({}, { isWorkerSupported: () => true,
    createWorker: () => ({ postMessage() { messageSent(); }, terminate() { terminated++; } }),
  });
  const preparing = owner.prepare(); await sent;
  state.activeScenarioId = 'blank_base';
  assert.equal(owner.getSource().status, 'disabled');
  await preparing;
  assert.equal(terminated, 1);
  assert.equal(owner.getSource().features.length, 0);
});

test('complete coarse world dissolves provinces by immutable reference, independent of equal paint', async () => {
  const { owner } = fixture();
  await owner.prepare();
  const source = owner.getSource();
  assert.equal(source.status, 'ready');
  assert.deepEqual(source.countries.map(c => c.countryCode), ['AAA', 'BBB']);
  assert.deepEqual([...source.memberIndex.groupCodeById], [['one', 'AAA'], ['two', 'AAA'], ['three', 'BBB']]);
  assert.deepEqual([...source.memberIndex.memberCountByCode], [['AAA', 2], ['BBB', 1]]);
  assert.throws(() => source.memberIndex.groupCodeById.clear(), TypeError);
  assert.equal(source.countries[0].geometry.coordinates.length, 1);
  const points = source.countries[0].geometry.coordinates[0][0];
  assert.ok(points.some(p => p[0] === 0) && points.some(p => p[0] === 2));
});
