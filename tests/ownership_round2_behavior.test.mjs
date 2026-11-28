import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { state } from "../js/core/state.js";
import { callRuntimeHook } from "../js/core/state/index.js";
import "../js/core/map_renderer/public.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");
const owner = (id, feature) => callRuntimeHook(state, "resolveBorderIdentityFn", id, feature);

function scene(ctx) {
  const features = ["east", "west", "remote"].map((id, i) => ({
    type: "Feature", id, properties: { name: "Borderland" },
    geometry: { type: "Polygon", coordinates: [[[i, 0], [i, 1], [i + 1, 1], [i + 1, 0], [i, 0]]] },
  }));
  const fields = {
    currentLanguage: "zh", activeScenarioId: "test", mapSemanticMode: "political",
    scenarioCountriesByTag: { GER: {}, FRA: {}, REL: { releasable: true } },
    scenarioBaselineOwnersByFeatureId: { east: "GER", west: "GER", remote: "FRA" },
    sovereignBaseColors: { GER: "#111111", FRA: "#222222", REL: "#333333" },
    visualOverrides: { east: "#222222" }, legendLabels: {}, colorRevision: 1,
    selectedInspectorCountryCode: "", landData: { features }, landIndex: new Map(features.map(f => [f.id, f])),
    activeScenarioManifest: { detail_chunk_manifest_url: "chunks" },
    scenarioBundleCacheById: { test: { chunkRegistry: { byLayer: { political: [
      { id: "world", globalCoverage: true, lod: "coarse" },
    ] } }, chunkPayloadCacheById: { world: { payload: { features } } } } },
  };
  const saved = Object.fromEntries(Object.keys(fields).map(key => [key, state[key]]));
  Object.assign(state, fields);
  const originalD3 = globalThis.d3;
  globalThis.d3 = d3;
  ctx.after(() => { Object.assign(state, saved); globalThis.d3 = originalD3; });
  return features;
}

test("release and undo update the affected label geometries", async ctx => {
  const features = scene(ctx);
  const source = createCountryLabelSourceOwner({ state, topojson, resolveBorderIdentity: owner, yieldTask: () => Promise.resolve() });
  ctx.after(() => source.dispose());
  const geometry = code => source.getSource().countries.find(item => item.countryCode === code)?.geometry;
  await source.prepare();
  // 国名按实际版图：east 已涂成法国色，开局就计入法国国名形状。
  assert.equal(d3.geoContains(geometry("FRA"), d3.geoCentroid(features[0])), true);
  assert.equal(d3.geoContains(geometry("GER"), d3.geoCentroid(features[0])), false);
  state.visualOverrides = { east: "#333333", remote: "#333333" };
  state.colorRevision++;
  await source.prepare();
  assert.equal(d3.geoContains(geometry("REL"), [0.5, 0.5]), true);
  assert.equal(d3.geoContains(geometry("GER"), [0.5, 0.5]), false);
  assert.equal(geometry("FRA"), undefined);
  delete state.visualOverrides.remote;
  state.colorRevision++;
  await source.prepare();
  const restoredFrance = geometry("FRA");
  assert.equal(d3.geoContains(restoredFrance, d3.geoCentroid(features[2])), true);
  assert.equal(d3.geoContains(restoredFrance, d3.geoCentroid(features[0])), false);
  state.visualOverrides = {};
  state.colorRevision++;
  await source.prepare();
  assert.equal(geometry("FRA"), restoredFrance);
  assert.equal(geometry("REL"), undefined);
  assert.equal(d3.geoContains(geometry("GER"), d3.geoCentroid(features[0])), true);
});
