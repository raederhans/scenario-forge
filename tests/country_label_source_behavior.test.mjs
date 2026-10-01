import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Worker as NodeWorker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createCountryLabelSourceOwner } from '../js/core/renderer/country_label_source.js';

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
    yieldTask: () => Promise.resolve(),
    getCountryName: code => state.scenarioCountriesByTag[code]?.[state.currentLanguage], ...helpers });
  return { owner, state, bundle, payload };
}

function nodeWorkerAdapter(log) {
  const worker = new NodeWorker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { readFileSync } = require('node:fs'); const vm = require('node:vm');
    const vendors = {};
    for (const path of workerData.vendors) vm.runInNewContext(readFileSync(path, 'utf8'), vendors);
    globalThis.topojson = vendors.topojson; globalThis.d3 = vendors.d3;
    globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
    import(workerData.url).then(() => parentPort.on('message', data => self.onmessage({ data })));
  `, { eval: true, workerData: {
    vendors: ['../vendor/topojson-client.min.js', '../vendor/d3.v7.min.js'].map(path => fileURLToPath(new URL(path, import.meta.url))),
    url: new URL('../js/workers/country_label_geometry.worker.js', import.meta.url).href,
  } });
  const adapter = {
    postMessage(message, transfer) { log.messages.push(message); worker.postMessage(message, transfer); },
    terminate() { log.terminated++; worker.terminate(); },
  };
  worker.on('message', data => adapter.onmessage?.({ data }));
  worker.on('error', error => adapter.onerror?.({ error }));
  return adapter;
}

test('real module worker builds the same surfaces without invoking main-thread merge', async () => {
  const log = { messages: [], terminated: 0 };
  const { owner } = fixture({}, {
    topojson: { merge() { throw new Error('Main-thread merge forbidden'); } },
    isWorkerSupported: () => true, createWorker: () => nodeWorkerAdapter(log),
  });
  await owner.prepare();
  const source = owner.getSource();
  assert.equal(source.status, 'ready', source.error);
  assert.equal(source.countries[0].geometry.coordinates.length, 1);
  assert.ok(sandbox.d3.geoArea(source.features[0]) < 0.01);
  assert.equal(log.messages[0].type, 'BUILD_COUNTRY_LABELS');
  assert.equal(log.terminated, 1);
  owner.dispose();
});

for (const useWorker of [false, true]) {
  test(`mixed coarse polygon winding preserves adjacent provinces, islands and holes (${useWorker ? 'worker' : 'local'})`, async () => {
    const log = { messages: [], terminated: 0 };
    const { owner, payload } = fixture({}, useWorker ? {
      topojson: { merge() { throw new Error('Main-thread merge forbidden'); } },
      isWorkerSupported: () => true, createWorker: () => nodeWorkerAdapter(log),
    } : {});
    payload.features[0].geometry = { type: 'MultiPolygon', coordinates: [[ring(0, 0)], [ring(8, 0).reverse()]] };
    payload.features[1].geometry.coordinates = [ring(1, 0).reverse(),
      [[1.2, 0.2], [1.2, 0.4], [1.4, 0.4], [1.4, 0.2], [1.2, 0.2]]];
    const original = JSON.stringify(payload.features);
    await owner.prepare();
    const source = owner.getSource();
    assert.equal(source.status, 'ready', source.error);
    const country = source.countries.find(c => c.countryCode === 'AAA');
    assert.equal(country.geometry.coordinates.length, 2);
    for (const point of [[0.8, 0.8], [1.8, 0.8], [8.5, 0.5]]) {
      assert.equal(sandbox.d3.geoContains(country.feature, point), true, `Missing country surface at ${point}`);
    }
    assert.equal(sandbox.d3.geoContains(country.feature, [1.3, 0.3]), false);
    assert.ok(sandbox.d3.geoArea(country.feature) < 0.01);
    assert.equal(JSON.stringify(payload.features), original);
    if (useWorker) assert.equal(log.terminated, 1);
  });
}

test('worker failure is explicit, terminates its worker, and does not retry or merge locally', async () => {
  let creations = 0, terminated = 0;
  const { owner } = fixture({}, {
    isWorkerSupported: () => true,
    createWorker: () => {
      creations++;
      const worker = { terminate() { terminated++; }, postMessage(message) {
        queueMicrotask(() => worker.onmessage({ data: { type: 'ERROR', taskId: message.taskId, message: 'Worker rejected source' } }));
      } };
      return worker;
    },
  });
  await owner.prepare(); await owner.prepare();
  assert.equal(owner.getSource().status, 'error');
  assert.match(owner.getSource().error, /Worker rejected source/);
  assert.equal(creations, 1); assert.equal(terminated, 1);
});

test('real worker receives quantized topology arcs for default country dissolution', async () => {
  const log = { messages: [], terminated: 0 };
  const topology = { type: 'Topology', transform: { scale: [0.1, 0.1], translate: [0, 0] },
    arcs: [[[0, 0], [0, 10], [10, 0], [0, -10], [-10, 0]]], objects: { political: {
      type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 'france', properties: { cntr_code: 'FR' }, arcs: [[0]] }],
    } } };
  const { owner } = fixture({ activeScenarioId: '', topologyPrimary: topology }, {
    topojson: { merge() { throw new Error('Main-thread merge forbidden'); } },
    isWorkerSupported: () => true, createWorker: () => nodeWorkerAdapter(log),
  });
  await owner.prepare();
  assert.equal(owner.getSource().status, 'ready', owner.getSource().error);
  assert.equal(owner.getSource().countries[0].countryCode, 'FR');
  assert.ok(sandbox.d3.geoContains(owner.getSource().features[0], [0.5, 0.5]));
  assert.equal(log.terminated, 1);
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
  const { owner, state } = fixture();
  await owner.prepare();
  const source = owner.getSource();
  assert.equal(source.status, 'ready');
  assert.deepEqual(source.countries.map(c => c.countryCode), ['AAA', 'BBB']);
  assert.equal(source.countries[0].geometry.coordinates.length, 1);
  const points = source.countries[0].geometry.coordinates[0][0];
  assert.ok(points.some(p => p[0] === 0) && points.some(p => p[0] === 2));
  state.sovereigntyByFeatureId = { one: 'BBB', two: 'BBB' };
  state.visualOverrides = { one: '#abcdef' }; state.colorRevision = 8;
  state.landData = { features: [feature('one', 80)] }; state.topologyDetail = {};
  state.runtimePoliticalTopology = {}; state.scenarioShellOverlayRevision = 9;
  assert.equal(owner.getSource().countries, source.countries);
  assert.equal(owner.getSource().sourceToken, source.sourceToken);
});

test('viewport chunks and coarse payload eviction keep completed country geometry stable', async () => {
  const { owner, state, bundle } = fixture();
  await owner.prepare();
  const source = owner.getSource();
  bundle.chunkPayloadCacheById = {};
  state.activeScenarioChunks = { payloadByChunkId: { detail: { payload: { features: [feature('one', 90)] } } } };
  assert.equal(owner.getSource().features, source.features);
  assert.equal(owner.getSource().revision, source.revision);
});

test('language updates names through caller seam without rebuilding merged geometry', async () => {
  const { owner, state } = fixture();
  await owner.prepare();
  const before = owner.getSource(); state.currentLanguage = 'zh';
  const after = owner.getSource();
  assert.equal(after.countries[0].name, '历史甲');
  assert.equal(after.features[0].properties.label, '历史甲');
  assert.equal(after.countries[0].geometry, before.countries[0].geometry);
  assert.equal(after.revision, before.revision);
  assert.equal(after.sourceToken, before.sourceToken);
});

test('same-language geo locale and alias replacements refresh names without replacing geometry', async () => {
  let runtime;
  const { owner, state } = fixture({
    locales: { geo: { old: { en: 'Old country name' }, alternate: { en: 'Alternate country name' } } },
    geoAliasToStableKey: { 'Historical A': 'old' },
  }, { getCountryName: code => {
    const raw = runtime.scenarioCountriesByTag[code]?.[runtime.currentLanguage];
    const key = runtime.geoAliasToStableKey[raw] || raw;
    return runtime.locales.geo[key]?.[runtime.currentLanguage] || raw;
  } });
  runtime = state;
  await owner.prepare();
  const before = owner.getSource();
  assert.equal(before.countries[0].name, 'Old country name');
  state.locales.geo = { old: { en: 'Updated country name' }, alternate: { en: 'Alternate country name' } };
  const updated = owner.getSource();
  assert.equal(updated.countries[0].name, 'Updated country name');
  state.geoAliasToStableKey = { 'Historical A': 'alternate' };
  const aliased = owner.getSource();
  assert.equal(aliased.countries[0].name, 'Alternate country name');
  assert.equal(aliased.features[0].properties.label, 'Alternate country name');
  for (const after of [updated, aliased]) {
    assert.equal(after.countries[0].geometry, before.countries[0].geometry);
    assert.equal(after.revision, before.revision);
    assert.equal(after.sourceToken, before.sourceToken);
  }
});

test('preserves holes and dateline coordinates while excluding ocean, shell and unknown historical identity', async () => {
  const { owner, payload } = fixture();
  payload.features[0].geometry.coordinates.push(ring(0.2, 0.2, 0.2).reverse());
  payload.features[0].geometry.coordinates[1] = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]];
  payload.features[2].geometry.coordinates = [ring(179, 0, 2)];
  payload.features.push(feature('unknown', 50, 'CC'), feature('ocean', 60, 'AA', { water_type: 'ocean' }),
    feature('RU_ARCTIC_FB_1', 70, 'AA', { name: 'shell fallback' }));
  await owner.prepare();
  const source = owner.getSource();
  assert.equal(source.countries.length, 2);
  assert.equal(source.countries[0].geometry.coordinates[0].length, 2);
  assert.equal(source.countries[1].geometry.coordinates[0][0][2][0], 181);
});

test('blank baseline suppresses all country labels', () => {
  assert.equal(fixture({ activeScenarioId: 'blank_base' }).owner.getSource().status, 'disabled');
  assert.equal(fixture({ mapSemanticMode: 'blank' }).owner.getSource().features.length, 0);
});

test('counterclockwise coarse islands normalize to small d3 surfaces without filling holes', async () => {
  const { owner, payload } = fixture();
  payload.features[0].geometry.coordinates = [ring(0, 0).reverse(),
    [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2], [0.2, 0.2]]];
  payload.features[1].geometry.coordinates = [ring(1, 0).reverse()];
  payload.features[2].geometry.coordinates = [ring(4, 0).reverse()];
  await owner.prepare();
  const countries = owner.getSource().countries;
  for (const country of countries) assert.ok(sandbox.d3.geoArea(country.feature) < 0.01);
  assert.equal(sandbox.d3.geoContains(countries[0].feature, [0.3, 0.3]), false);
  assert.equal(sandbox.d3.geoContains(countries[0].feature, [0.8, 0.8]), true);
});

test('collapsed exterior with quantized holes never becomes a world-sized label surface', async () => {
  const { owner, payload } = fixture();
  payload.features[2].geometry.coordinates = [
    [[4, 0], [4.00001, 0], [4.00001, 0.00001], [4, 0]],
    [[4, 0], [4, 0.001], [4.001, 0.001], [4.001, 0], [4, 0]],
  ];
  await owner.prepare();
  const source = owner.getSource();
  for (const feature of source.features) assert.ok(sandbox.d3.geoArea(feature) < 2 * Math.PI);
});

test('historical missing global bases stays pending and never falls back to modern geometry', () => {
  const { owner, bundle, state } = fixture();
  bundle.chunkPayloadCacheById = {};
  state.topologyPrimary = { objects: { political: { type: 'GeometryCollection', geometries: [] } } };
  state.scenarioPoliticalChunkData = { globalCoverage: true, features: [feature('one', 80)] };
  assert.equal(owner.getSource().status, 'pending');
  assert.equal(owner.getSource().countries.length, 0);
});

test('missing hook remains retryable, later complete loading is retained across eviction', async () => {
  let calls = 0, result, changes = 0;
  const { owner, bundle, payload } = fixture({}, { ensureSources: async layers => {
    calls++; assert.deepEqual(layers, ['political']); return result;
  }, onChange: () => changes++ });
  bundle.chunkPayloadCacheById = {};
  await owner.prepare(); assert.equal(owner.getSource().status, 'pending');
  result = { political: [payload] };
  await owner.prepare();
  assert.equal(owner.getSource().status, 'ready'); assert.equal(changes, 1);
  await owner.prepare(); assert.equal(calls, 2);
});

test('incomplete world load fails once per identity and stale loads cannot publish', async () => {
  let calls = 0;
  const failed = fixture({}, { ensureSources: async () => { calls++; return { political: [] }; } });
  failed.bundle.chunkPayloadCacheById = {};
  await failed.owner.prepare(); await failed.owner.prepare();
  assert.equal(failed.owner.getSource().status, 'error'); assert.equal(calls, 1);
  let resolve;
  const stale = fixture({}, { ensureSources: () => new Promise(r => { resolve = r; }) });
  stale.bundle.chunkPayloadCacheById = {};
  const request = stale.owner.prepare(); await Promise.resolve();
  stale.state.activeScenarioId = 'another'; resolve({ political: [stale.payload] }); await request;
  assert.equal(stale.owner.getSource().countries.length, 0);
});

test('default base uses stable primary topology and aliases geographic country identity', async () => {
  const topology = { type: 'Topology', arcs: [ring(0, 0), ring(4, 0)], objects: { political: {
    type: 'GeometryCollection', geometries: [
      { type: 'Polygon', id: 'france', properties: { cntr_code: 'FR' }, arcs: [[0]] },
      { type: 'Polygon', id: 'germany', properties: { cntr_code: 'DE' }, arcs: [[1]] },
    ],
  } } };
  const state = { activeScenarioId: '', topologyPrimary: topology, countryNames: { FR: 'France', DE: 'Germany' } };
  const owner = createCountryLabelSourceOwner({ state, topojson });
  await owner.prepare();
  const source = owner.getSource();
  assert.equal(source.status, 'ready');
  assert.deepEqual(source.countries.map(c => c.countryCode), ['DE', 'FR']);
  state.topologyDetail = {}; state.landData = {};
  assert.equal(owner.getSource().countries, source.countries);
});
