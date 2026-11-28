import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createContextLayerResolverOwner } from "../js/core/renderer/context_layer_resolver.js";
import { getUrbanFeatureOwnerId } from "../js/core/renderer/urban_adaptive_paint_model.js";

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
  globalThis.topojson = topojson;
  globalThis.d3 = d3;
  console.info = () => {};
  console.warn = () => {};
  t.after(() => { globalThis.d3 = saved.d3; globalThis.topojson = saved.topojson; console.info = saved.info; console.warn = saved.warn; });
  const state = { topologyPrimary: topology(), activeScenarioId: "scenario-a", topologyBundleMode: "composite", contextLayerRevision: 0,
  };
  const helpers = {
    clamp,
    getUrbanFeatureOwnerId,
    getUrbanFeatureStableId: feature => feature.id,
    getContextLayerStableSourceToken: (_name, collection) => collection?.features?.[0]?.id || "none",
  };
  const create = runtimeState => createContextLayerResolverOwner({ runtimeState, helpers, caches: { layerResolverCache: {} } });
  return { state, resolver: create(state) };
}

test("replacing real topology and arcs updates derived geometry", t => {
  const f = fixture(t);
  f.resolver.ensureLayerDataFromTopology();
  f.state.topologyPrimary = topology("new");
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.riversData.features[0].id, "new-rivers");
  f.state.topologyPrimary.arcs = [[[15, 0], [15, 8], [27, 8], [27, 0], [15, 0]]];
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.landBgData.features[0].geometry.coordinates[0][0][0], 15);
});

test("coverage score spans every vertex of points, multipolygons and geometry collections", t => {
  const f = fixture(t);
  const collection = { type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-60, -10] } },
    { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [30, 0], [30, 20], [0, 0]]]] } },
    { type: "Feature", properties: {}, geometry: { type: "GeometryCollection", geometries: [
      { type: "LineString", coordinates: [[100, 40], [120, 50]] },
    ] } },
    { type: "Feature", properties: {}, geometry: null },
  ] };
  // Extent [-60, -10] to [120, 50]: 180° × 60° of a 360° × 180° world, with four features.
  const expected = (180 * 60) / (360 * 180) * 0.8 + (Math.log10(5) / 4) * 0.2;
  assert.ok(Math.abs(f.resolver.computeLayerCoverageScore(collection) - expected) < 1e-12);
  assert.equal(f.resolver.computeLayerCoverageScore({ type: "FeatureCollection", features: [
    { type: "Feature", properties: {}, geometry: null },
  ] }), 0, "a collection without coordinates has no coverage");
});
