import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createContextLayerResolverOwner } from "../js/core/renderer/context_layer_resolver.js";
import { getUrbanFeatureOwnerId } from "../js/core/renderer/urban_adaptive_paint_model.js";
import { commitContextLayerCollection, decodeStartupPrimaryCollectionsIntoState } from "../js/core/state/content_state.js";
import { commitPhysicalContourDisplayState } from "../js/core/state/actions/content_load_actions.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");
const fields = {
  ocean: "oceanData", land: "landBgData", water_regions: "waterRegionsData",
  rivers: "riversData", urban: "urbanData", physical: "physicalData", special_zones: "specialZonesData",
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function topology(prefix = "primary") {
  return {
    type: "Topology",
    arcs: [[[0, 0], [0, 8], [12, 8], [12, 0], [0, 0]]],
    objects: Object.fromEntries(Object.keys(fields).map(name => [name, {
      type: "GeometryCollection",
      geometries: [{ type: "Polygon", arcs: [[0]], id: `${prefix}-${name}`,
        properties: { country_owner_id: "owner-a", population: 1200 } }],
    }])),
  };
}

function fixture(t) {
  const saved = { d3: globalThis.d3, topojson: globalThis.topojson, info: console.info, warn: console.warn };
  const calls = { decode: 0, bounds: 0, owner: 0, id: 0, water: 0, toolbar: 0 };
  globalThis.topojson = { feature: (...args) => { calls.decode += 1; return topojson.feature(...args); } };
  globalThis.d3 = { ...d3, geoBounds: (...args) => { calls.bounds += 1; return d3.geoBounds(...args); } };
  console.info = () => {};
  console.warn = () => {};
  t.after(() => { globalThis.d3 = saved.d3; globalThis.topojson = saved.topojson; console.info = saved.info; console.warn = saved.warn; });
  const state = { topologyPrimary: topology(), activeScenarioId: "scenario-a", topologyBundleMode: "composite", contextLayerRevision: 0,
    citiesData: { features: [{ id: "city-a", population: 123 }] }, populationData: { epoch: 1940 },
    updateToolbarInputsFn: () => { calls.toolbar += 1; } };
  const helpers = {
    clamp,
    getUrbanFeatureOwnerId: feature => { calls.owner += 1; return getUrbanFeatureOwnerId(feature); },
    getUrbanFeatureStableId: feature => { calls.id += 1; return feature.id; },
    getContextLayerStableSourceToken: (_name, collection) => collection?.features?.[0]?.id || "none",
    resetScenarioWaterCacheAdaptiveState: () => { calls.water += 1; },
  };
  const create = runtimeState => createContextLayerResolverOwner({ runtimeState, helpers, caches: { layerResolverCache: {} } });
  return { calls, state, create, resolver: create(state) };
}

function snapshot(state) {
  return structuredClone({
    layers: Object.fromEntries(Object.values(fields).map(field => [field, state[field]])),
    sources: state.contextLayerSourceByName,
    diagnostics: state.layerDataDiagnostics,
    urban: state.urbanLayerCapability,
  });
}

function assertMatchesFreshResolver(f) {
  const expectedState = { ...f.state, layerDataDiagnostics: {}, contextLayerSourceByName: {} };
  f.create(expectedState).ensureLayerDataFromTopology();
  assert.deepEqual(snapshot(f.state), snapshot(expectedState));
}

function startupDecodeBundle(state) {
  const source = state.topologyPrimary;
  source.objects.political = structuredClone(source.objects.land);
  return structuredClone({
    landData: topojson.feature(source, source.objects.political),
    ...Object.fromEntries(Object.entries(fields).map(([name, field]) => [field, topojson.feature(source, source.objects[name])])),
  });
}

test("shared real TopoJSON across scenarios reuses decoding, coverage and urban scans while publishing current selections", t => {
  const f = fixture(t);
  f.state.topologyDetail = topology("detail");
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 14);
  assert.equal(f.calls.bounds, 16);
  assert.equal(f.calls.owner, 2);
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, true);
  const original = f.state.landBgData;
  const originalCities = f.state.citiesData;
  const originalPopulation = f.state.populationData;
  const before = { ...f.calls };
  f.state.activeScenarioId = "scenario-b";
  f.state.topologyBundleMode = "single";
  f.state.projection = d3.geoMercator().rotate([40, 0]).scale(230);
  f.state.specialZonesExternalData = { type: "FeatureCollection", features: [{ type: "Feature", id: "new-zone", geometry: null, properties: {} }] };
  f.resolver.ensureLayerDataFromTopology();
  for (const key of ["decode", "bounds", "owner", "id"]) assert.equal(f.calls[key], before[key], `${key} must add zero work`);
  assert.equal(f.calls.toolbar, before.toolbar + 1);
  assert.equal(f.state.landBgData, original);
  assert.equal(f.state.specialZonesData, f.state.specialZonesExternalData);
  assert.equal(f.state.contextLayerSourceByName.special_zones, "external");
  assert.equal(f.state.citiesData, originalCities);
  assert.equal(f.state.populationData, originalPopulation);
  assertMatchesFreshResolver(f);
});

test("real topology, object, geometries, arc and transform replacement invalidate only their affected derivations", t => {
  const f = fixture(t);
  f.resolver.ensureLayerDataFromTopology();
  const expectDecodes = (count, mutate) => {
    const before = f.calls.decode;
    mutate();
    f.resolver.ensureLayerDataFromTopology();
    assert.equal(f.calls.decode - before, count);
    assertMatchesFreshResolver(f);
  };
  expectDecodes(7, () => { f.state.topologyPrimary = structuredClone(f.state.topologyPrimary); });
  expectDecodes(1, () => { f.state.topologyPrimary.objects.rivers = topology("new").objects.rivers; });
  assert.equal(f.state.riversData.features[0].id, "new-rivers");
  expectDecodes(1, () => { f.state.topologyPrimary.objects.land.geometries = topology("new").objects.land.geometries; });
  assert.equal(f.state.landBgData.features[0].id, "new-land");
  expectDecodes(7, () => { f.state.topologyPrimary.arcs = [[[15, 0], [15, 8], [27, 8], [27, 0], [15, 0]]]; });
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 15);
  expectDecodes(7, () => { f.state.topologyPrimary.transform = { scale: [1, 1], translate: [30, 10] }; });
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 45);
  expectDecodes(7, () => { f.state.topologyPrimary.transform.scale = [2, 1]; });
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 60);
});

test("explicit mutable revision refreshes real geometry, urban ownership, population properties and water caches", t => {
  const f = fixture(t);
  f.resolver.ensureLayerDataFromTopology();
  const before = { ...f.calls };
  f.state.topologyPrimary.arcs[0][0][0] = 2;
  const urban = f.state.topologyPrimary.objects.urban.geometries[0];
  urban.properties.country_owner_id = "";
  urban.properties.population = 9876;
  f.state.contextLayerRevision += 1;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode - before.decode, 7);
  assert.equal(f.calls.water, before.water + 1);
  assert.equal(f.state.urbanData.features[0].properties.population, 9876);
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, false);
  assert.equal(f.state.urbanLayerCapability.missingOwnerCount, 1);
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 2);
  assertMatchesFreshResolver(f);
});

test("external urban collection and feature-array replacement remain fresh without redecoding shared topology", t => {
  const f = fixture(t);
  delete f.state.topologyPrimary.objects.urban;
  const external = { type: "FeatureCollection", features: [{ type: "Feature", id: "external-a",
    properties: { country_owner_id: "owner-a", population: 500 }, geometry: { type: "Point", coordinates: [1, 1] } }] };
  f.state.contextLayerExternalDataByName = { urban: external };
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, external);
  const before = { ...f.calls };
  f.state.activeScenarioId = "scenario-b";
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, before.decode);
  assert.equal(f.calls.bounds, before.bounds);
  external.features = [{ ...external.features[0], id: "external-b", properties: { population: 1000 } }];
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, before.decode);
  assert.equal(f.state.urbanData.features[0].id, "external-b");
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, false);
  external.features[0].properties.country_owner_id = "owner-b";
  f.state.contextLayerRevision += 1;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, true);
  f.state.contextLayerExternalDataByName.urban = structuredClone(external);
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, f.state.contextLayerExternalDataByName.urban);
  assertMatchesFreshResolver(f);
});

test("failed decode and unavailable bounds do not poison later successful geographic derivations", t => {
  const f = fixture(t);
  const source = f.state.topologyPrimary;
  const originalFeature = globalThis.topojson.feature;
  globalThis.topojson.feature = () => { throw new Error("temporary decoder failure"); };
  assert.equal(f.resolver.getLayerFeatureCollection(source, "land"), null);
  globalThis.topojson.feature = originalFeature;
  const collection = f.resolver.getLayerFeatureCollection(source, "land");
  assert.deepEqual(collection, topojson.feature(source, source.objects.land));
  const originalBounds = globalThis.d3.geoBounds;
  let boundsFailing = true;
  globalThis.d3.geoBounds = (...args) => {
    if (boundsFailing) throw new Error("temporary bounds failure");
    return originalBounds(...args);
  };
  assert.equal(f.resolver.computeLayerCoverageScore(collection), 0);
  boundsFailing = false;
  assert.ok(f.resolver.computeLayerCoverageScore(collection) > 0);
  const before = f.calls.bounds;
  f.resolver.computeLayerCoverageScore(collection);
  assert.equal(f.calls.bounds, before);
  const urban = structuredClone(collection);
  urban.features[0].geometry.coordinates[0].reverse();
  boundsFailing = true;
  assert.equal(f.resolver.getUrbanLayerCapability(urban).hasCorruptBounds, false);
  boundsFailing = false;
  assert.equal(f.resolver.getUrbanLayerCapability(urban).hasCorruptBounds, true);
});

test("actual lake, urban and contour publication writers preserve unrelated topology derivations across scenarios", t => {
  const f = fixture(t);
  f.state.topologyPrimary.objects.urban.geometries[0].properties.country_owner_id = "";
  f.resolver.ensureLayerDataFromTopology();
  const before = { ...f.calls };
  const externalUrban = { type: "FeatureCollection", features: [{ type: "Feature", id: "external-urban",
    properties: { country_owner_id: "owner-b" }, geometry: { type: "Point", coordinates: [3, 4] } }] };
  commitContextLayerCollection(f.state, "water_regions", { type: "FeatureCollection", features: [] }, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, before.decode);
  assert.equal(f.calls.bounds, before.bounds);
  commitContextLayerCollection(f.state, "urban", externalUrban, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, before.decode);
  assert.equal(f.calls.bounds - before.bounds, 2, "only new external urban capability and coverage are scanned");
  assert.equal(f.state.urbanData, externalUrban);
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, true);
  commitPhysicalContourDisplayState(f.state, { major: { features: [] }, minor: { features: [] } });
  f.state.activeScenarioId = "scenario-b";
  const beforeSwitch = { ...f.calls };
  f.resolver.ensureLayerDataFromTopology();
  for (const key of ["decode", "bounds", "owner", "id"]) assert.equal(f.calls[key], beforeSwitch[key]);
  assert.equal(f.state.contextLayerRevision, 3, "all existing global revision consumers still see publication epochs");
  assertMatchesFreshResolver(f);

  const beforeRepublish = { ...f.calls };
  externalUrban.features[0].properties.country_owner_id = "";
  commitContextLayerCollection(f.state, "urban", externalUrban, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, beforeRepublish.decode);
  assert.equal(f.calls.owner, beforeRepublish.owner + 1, "same-reference published metadata must be inspected again");
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, false);
  assertMatchesFreshResolver(f);
});

test("unknown explicit revision changes before known publications still invalidate all topology derivations", t => {
  const f = fixture(t);
  f.resolver.ensureLayerDataFromTopology();
  const before = f.calls.decode;
  f.state.topologyPrimary.arcs[0][0][0] = 9;
  f.state.contextLayerRevision = 20;
  commitContextLayerCollection(f.state, "rivers", { features: [] }, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode - before, 7);
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 9);
  const after = f.calls.decode;
  f.state.contextLayerRevision = 2;
  commitPhysicalContourDisplayState(f.state, { major: { features: [] } });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode - after, 7, "a backwards epoch must conservatively invalidate too");
  assertMatchesFreshResolver(f);
});

test("startup worker collections seed all seven context layers with zero main-thread redecodes and trusted source identity", t => {
  const f = fixture(t);
  const decoded = startupDecodeBundle(f.state);
  const override = { type: "FeatureCollection", features: [] };
  f.state.specialZonesExternalData = override;
  decodeStartupPrimaryCollectionsIntoState(f.state, { startupDecodedCollections: decoded });
  assert.equal(f.calls.decode, 0);
  // A display alias is not a source proof; it must not become the seed.
  f.state.oceanData = { type: "FeatureCollection", features: [] };
  const stateFields = Object.keys(f.state);
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 0);
  for (const [name, field] of Object.entries(fields)) {
    if (name !== "special_zones") assert.equal(f.state[field], decoded[field]);
  }
  assert.equal(f.state.specialZonesData, override);
  assert.ok(Object.keys(f.state).every(key => stateFields.includes(key)
    || ["manualSpecialZones", "layerDataDiagnostics", "contextLayerSourceByName", "urbanLayerCapability"].includes(key)),
  "seed provenance must not add runtime fields");
  f.state.specialZonesExternalData = null;
  f.state.activeScenarioId = "scenario-b";
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 0);
  assert.equal(f.state.specialZonesData, decoded.specialZonesData);
  assertMatchesFreshResolver(f);
});

test("known external and contour publication before first resolution preserves startup seeds", t => {
  const f = fixture(t);
  const decoded = startupDecodeBundle(f.state);
  decodeStartupPrimaryCollectionsIntoState(f.state, { startupDecodedCollections: decoded });
  commitContextLayerCollection(f.state, "water_regions", { features: [] }, { bumpRevision: true });
  commitPhysicalContourDisplayState(f.state, { major: { features: [] } });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 0);
  assert.equal(f.state.landBgData, decoded.landBgData);
  assertMatchesFreshResolver(f);
});

test("a startup collection republished as mutable external data cannot silently become a primary source seed", t => {
  const f = fixture(t);
  const decoded = startupDecodeBundle(f.state);
  decodeStartupPrimaryCollectionsIntoState(f.state, { startupDecodedCollections: decoded });
  decoded.urbanData.features = [];
  commitContextLayerCollection(f.state, "urban", decoded.urbanData, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 1, "only the republished seed lost its provenance");
  assert.notEqual(f.state.urbanData, decoded.urbanData);
  assert.equal(f.state.urbanData.features.length, 1);
  assertMatchesFreshResolver(f);
});

for (const [name, expectedDecodes, mutate] of [
  ["topology replacement", 7, f => { f.state.topologyPrimary = structuredClone(f.state.topologyPrimary); }],
  ["object replacement", 1, f => { f.state.topologyPrimary.objects.rivers = topology("replacement").objects.rivers; }],
  ["geometry-array replacement", 1, f => { f.state.topologyPrimary.objects.land.geometries = topology("replacement").objects.land.geometries; }],
  ["arc replacement", 7, f => { f.state.topologyPrimary.arcs = [[[10, 0], [10, 8], [22, 8], [22, 0], [10, 0]]]; }],
  ["transform replacement", 7, f => { f.state.topologyPrimary.transform = { scale: [2, 1], translate: [30, 10] }; }],
  ["strong revision before a known publication", 7, f => {
    f.state.topologyPrimary.objects.urban.geometries[0].properties.country_owner_id = "";
    f.state.contextLayerRevision += 1;
    commitContextLayerCollection(f.state, "rivers", { features: [] }, { bumpRevision: true });
  }],
  ["decoder replacement", 7, () => {
    const original = globalThis.topojson.feature;
    globalThis.topojson.feature = (...args) => original(...args);
  }],
]) {
  test(`startup seed rejects stale ${name} before first resolution`, t => {
    const f = fixture(t);
    const decoded = startupDecodeBundle(f.state);
    decodeStartupPrimaryCollectionsIntoState(f.state, { startupDecodedCollections: decoded });
    mutate(f);
    f.resolver.ensureLayerDataFromTopology();
    assert.equal(f.calls.decode, expectedDecodes);
    assertMatchesFreshResolver(f);
  });
}

test("absent, partial and malformed startup decode bundles preserve ordinary TopoJSON fallback", t => {
  const f = fixture(t);
  const decoded = startupDecodeBundle(f.state);
  decodeStartupPrimaryCollectionsIntoState(f.state);
  assert.equal(f.calls.decode, 8, "no predecode keeps the original startup decode path");
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.calls.decode, 15, "no registered worker seed keeps the original resolver fallback");

  const nextState = { ...f.state, contextLayerRevision: 0 };
  const partial = { ...decoded, riversData: null, urbanData: { type: "FeatureCollection", features: null } };
  const before = f.calls.decode;
  decodeStartupPrimaryCollectionsIntoState(nextState, { startupDecodedCollections: partial });
  assert.equal(f.calls.decode - before, 1, "missing river collection decodes during startup");
  f.create(nextState).ensureLayerDataFromTopology();
  assert.equal(f.calls.decode - before, 3, "missing or malformed collections use normal resolver decoding");
  assert.deepEqual(nextState.riversData, topojson.feature(nextState.topologyPrimary, nextState.topologyPrimary.objects.rivers));
  assert.deepEqual(nextState.urbanData, topojson.feature(nextState.topologyPrimary, nextState.topologyPrimary.objects.urban));
});
