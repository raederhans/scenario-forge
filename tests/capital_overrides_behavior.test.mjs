import test from "node:test";
import assert from "node:assert/strict";
import { setCapitalOverride } from "../js/core/capital_overrides.js";
import { normalizeCityFeature } from "../js/core/data_loader/city_normalization.js";
import { createCapitalVisibility } from "../js/core/renderer/capital_visibility.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";

import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import * as policy from "../js/core/renderer/city_reveal_policy.js";

function fixture() {
  const cities = [["old", "P", 10], ["new", "N", 100], ["foreign", "Q", 200]].map(([id, host, population], index) =>
    normalizeCityFeature({ type: "Feature", id, geometry: { type: "Point", coordinates: [1, 0.5] },
      properties: { host_feature_id: host, population } }, index));
  const state = { activeScenarioId: "modern_world", scenarioCountriesByTag: {
    AA: {}, BB: { releasable: true }, CC: { entry_kind: "project_country", feature_count: 0 },
  }, worldCitiesData: { features: cities }, sovereigntyByFeatureId: { P: "AA", N: "AA", Q: "BB" },
  scenarioCityOverridesData: { capitals_by_tag: { AA: "old" } }, visualOverrides: {},
  landIndex: new Map(["P", "N", "Q"].map(id => [id, { id }])) };
  const resolveBorderIdentity = createBorderIdentityResolver({
    sovereignBaseColors: { AA: "#aaaaaa", BB: "#bbbbbb", CC: "#cccccc" },
    getReferenceOwner: (id, f) => state.sovereigntyByFeatureId[f?.properties?.__riverParentId || id],
    getOverrideColor: (id, f) => state.riverPaint?.overrides[id] || state.visualOverrides[f?.properties?.__riverParentId || id],
  });
  const options = { resolveBorderIdentity, getSuppressedCodes: () => new Set() };
  const visibility = createCapitalVisibility({ state, ...options });
  const owner = createUrbanCityPolicyOwner({ state, caches: { cityLayerCache: {} },
    helpers: { ...policy, ...createCityLabelTextModel(state, {}) } });
  const collection = owner.getEffectiveCityCollection;
  const capitals = () => collection().features.filter(f => f.properties.__city_is_capital).map(f => f.id);
  const city = id => collection().features.find(f => f.id === id);
  return { state, options, visibility, capitals, city };
}

test("a project capital decision replaces the scenario capital", () => {
  const { state, options, capitals } = fixture();
  assert.deepEqual(capitals(), ["old"]);
  assert.equal(setCapitalOverride(state, "aa", "new", options), true);
  assert.deepEqual(capitals(), ["new"]);
});

test("capital visibility follows occupation and recovery", () => {
  const { state, city, visibility } = fixture();
  const capital = city("old");
  state.visualOverrides.P = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(capital), false);
  state.visualOverrides.P = "#aaaaaa";
  assert.equal(visibility.isCapitalVisible(capital), true);
});

test("a city without a host region cannot become the capital", () => {
  const { state, options } = fixture();
  const hostless = normalizeCityFeature({ type: "Feature", id: "nord", geometry: { type: "Point", coordinates: [5, 5] },
    properties: { country_code: "AA", population: 5000 } }, 9);
  const cityCollection = { features: [...state.worldCitiesData.features, hostless] };
  assert.equal(setCapitalOverride(state, "AA", "nord", { ...options, cityCollection }), false);
});
