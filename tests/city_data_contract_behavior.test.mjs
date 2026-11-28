import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeCityFeatureCollection } from "../js/core/data_loader.js";

const city = (id = "CITY::gn::1", properties = {}) => ({
  type: "Feature", properties: { id, stable_key: `id::${id}`, ...properties },
  geometry: { type: "Point", coordinates: [103.8, 1.3] },
});
const normalize = (features) => normalizeCityFeatureCollection({ type: "FeatureCollection", features });

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

test("tracked world cities and scenario overrides satisfy the runtime contract", async () => {
  const payload = JSON.parse(await readFile(new URL("../data/world_cities.geojson", import.meta.url), "utf8"));
  const result = normalizeCityFeatureCollection(payload);
  assert.equal(result.features.length, payload.features.length);
  for (const [index, feature] of payload.features.entries()) {
    assert.ok(feature.properties.id && feature.properties.stable_key);
    assert.equal(result.features[index].id, feature.properties.id);
    assert.equal(result.features[index].properties.stable_key, feature.properties.stable_key);
  }
});
