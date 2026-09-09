import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { normalizeCityFeatureCollection, normalizeScenarioCityOverridesPayload } from "../js/core/data_loader.js";

const city = (id = "CITY::gn::1", properties = {}) => ({
  type: "Feature", properties: { id, stable_key: `id::${id}`, ...properties },
  geometry: { type: "Point", coordinates: [103.8, 1.3] },
});
const normalize = (features) => normalizeCityFeatureCollection({ type: "FeatureCollection", features });

test("city identity survives reorder and retains unloaded host references", () => {
  const a = city("a", { host_feature_id: "unloaded-host", urban_match_id: "unloaded-urban" });
  const b = city("b");
  assert.deepEqual(normalize([a, b]).features[0], normalize([b, a]).features[1]);
  assert.equal(normalize([a]).features[0].properties.__city_host_feature_id, "unloaded-host");
});

test("legacy city aliases normalize to the same canonical identity and links", () => {
  const canonical = city("a", { host_feature_id: "host", urban_match_id: "urban" });
  const legacy = { ...canonical, properties: { cityId: "a", stableKey: "id::a", politicalFeatureId: "host", urbanAreaId: "urban" } };
  const [a, b] = [canonical, legacy].map((value) => normalize([value]).features[0]);
  for (const key of ["id", "stable_key", "host_feature_id", "urban_match_id", "__city_id", "__city_stable_key"]) {
    assert.equal(a.properties[key], b.properties[key]);
  }
  assert.equal(normalize([{ ...legacy, properties: { city_id: "a" } }]).features[0].properties.stable_key, "id::a");
  assert.equal(normalize([city("a", { stable_key: "city::a" })]).features[0].properties.stable_key, "city::a");
});

test("invalid cities fail with source diagnostics instead of invented identities", () => {
  for (const geometry of [null, { type: "LineString", coordinates: [[0, 0], [1, 1]] },
    { type: "Point", coordinates: [181, 0] }, { type: "Point", coordinates: [0, -91] },
    { type: "Point", coordinates: [NaN, 0] }, { type: "Point", coordinates: ["1", 0] }]) {
    assert.throws(() => normalize([{ ...city(), geometry }]), /city-contract.*world_cities feature 1/);
  }
  assert.throws(() => normalize([{ ...city(), properties: {} }]), /missing explicit city id/);
  assert.throws(() => normalize([city({ bad: "id" })]), /invalid city id/);
  assert.throws(() => normalize([city("a", { stable_key: {} })]), /invalid stable_key/);
  assert.throws(() => normalize([city(), city()]), /duplicate id/);
  assert.throws(() => normalize([city("a"), city("b", { stable_key: "id::a" })]), /duplicate stable_key/);
  assert.throws(() => normalizeScenarioCityOverridesPayload({ feature_collection: { features: [{ ...city(), properties: {} }] } }), /scenario_city_overrides:feature_collection.*missing explicit/);
});

test("tracked world cities and scenario overrides satisfy the runtime contract", async () => {
  const payload = JSON.parse(await readFile(new URL("../data/world_cities.geojson", import.meta.url), "utf8"));
  const result = normalizeCityFeatureCollection(payload);
  assert.equal(result.features.length, payload.features.length);
  assert.ok(result.features.length > 20_000);
  for (const [index, feature] of payload.features.entries()) {
    assert.ok(feature.properties.id && feature.properties.stable_key);
    assert.equal(result.features[index].id, feature.properties.id);
    assert.equal(result.features[index].properties.stable_key, feature.properties.stable_key);
  }
  const root = new URL("../data/scenarios/", import.meta.url);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let raw;
    try { raw = await readFile(new URL(`${entry.name}/city_overrides.json`, root), "utf8"); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const overrides = normalizeScenarioCityOverridesPayload(JSON.parse(raw));
    for (const value of Object.values(overrides.cities)) assert.ok(value.city_id && value.stable_key);
  }
});
