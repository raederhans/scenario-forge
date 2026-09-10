import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";

function fixture() {
  const feature = (id, country, properties = {}) => ({ type: "Feature", id,
    properties: { id, cntr_code: country, ...properties }, geometry: { type: "Point", coordinates: [55, 74] } });
  const modernRussia = feature("RU", "RU", { __source: "primary" });
  const modernFrance = feature("FR", "FR", { __source: "primary" });
  const shell = feature("RU_ARCTIC_FB_RKM_030", "RU", { scenario_helper_kind: "shell_fallback", interactive: false });
  const detail = feature("RU_DETAIL_001", "RU");
  const primary = { type: "FeatureCollection", features: [modernRussia, modernFrance] };
  const complete = { type: "FeatureCollection", globalCoverage: true, features: [shell, detail, detail] };
  const owner = createPoliticalCollectionOwner({ state: {},
    constants: { highFrequencyCountryDetailWhitelist: new Set(["RU"]) },
    helpers: { getFeatureId: (entry) => entry.properties.id,
      getFeatureCountryCodeNormalized: (entry) => entry.properties.cntr_code } });
  return { owner, primary, complete, shell, detail, feature };
}

test("complete scenario coverage retains shell and detail without modern primary promotion", () => {
  const { owner, primary, complete, shell, detail } = fixture();
  const result = owner.composePoliticalFeatureCollections(primary, complete);
  assert.deepEqual(result.features.map((entry) => entry.properties.id), [shell.id, detail.id]);
  assert.ok(result.features.every((entry) => entry.properties.__source === "detail"));
  assert.ok(result.features.every((entry) => !entry.properties.__coveragePromoted));
  assert.equal(result.features[0].properties.interactive, false);
  assert.equal(primary.features.length, 2);
  assert.equal(complete.features.length, 3, "source is not mutated by deduplication");
});

test("complete source still applies explicit override replacement after normalization and deduplication", () => {
  const { owner, primary, complete, detail, feature, shell } = fixture();
  const override = feature("RU_OVERRIDE", "RU", { replace_ids: [detail.id] });
  const result = owner.composePoliticalFeatureCollections(primary, complete, { features: [override] });
  assert.deepEqual(result.features.map((entry) => entry.properties.id), [shell.id, override.id]);
  assert.equal(result.features[1].properties.__source, "ru_override");
});

test("unmarked detail keeps legacy high frequency primary promotion and uncovered countries", () => {
  const { owner, primary, complete, shell, detail } = fixture();
  const legacy = { ...complete };
  delete legacy.globalCoverage;
  const result = owner.composePoliticalFeatureCollections(primary, legacy);
  assert.deepEqual(result.features.map((entry) => entry.properties.id), [shell.id, detail.id, "RU", "FR"]);
  assert.equal(result.features.find((entry) => entry.properties.id === "RU").properties.__coveragePromoted, true);
});
