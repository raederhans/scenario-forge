import test from "node:test";
import assert from "node:assert/strict";
import {
  addProjectCity, clearCapitalOverride, isCityInCountryTerritory, listCountryCities, normalizeCapitalOverrides,
  normalizeProjectCities, pickLargestCity, removeProjectCity, setCapitalOverride,
} from "../js/core/capital_overrides.js";
import { normalizeCityFeature } from "../js/core/data_loader/city_normalization.js";
import { createCapitalVisibility } from "../js/core/renderer/capital_visibility.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";
import { createCityGeometryPresentation } from "../js/core/renderer/city_geometry_presentation.js";
import { createCityLabelTextModel } from "../js/core/renderer/city_label_text_model.js";
import { createUrbanCityPolicyOwner } from "../js/core/renderer/urban_city_policy.js";
import * as policy from "../js/core/renderer/city_reveal_policy.js";
import { makeFixture, d3 } from "./helpers/river_paint_fixture.mjs";

function fixture(extra = {}) {
  const cities = [["old", "P", 10], ["new", "N", 100], ["foreign", "Q", 200]].map(([id, host, population], index) =>
    normalizeCityFeature({ type: "Feature", id, geometry: { type: "Point", coordinates: [1, 0.5] },
      properties: { host_feature_id: host, population } }, index));
  const state = { activeScenarioId: "modern_world", scenarioCountriesByTag: {
    AA: {}, BB: { releasable: true }, CC: { entry_kind: "project_country", feature_count: 0 },
  }, worldCitiesData: { features: cities }, sovereigntyByFeatureId: { P: "AA", N: "AA", Q: "BB" },
  scenarioCityOverridesData: { capitals_by_tag: { AA: "old" } }, visualOverrides: {},
  landIndex: new Map(["P", "N", "Q"].map(id => [id, { id }])), ...extra };
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

test("project capital decisions replace, suppress and restore a scenario capital", () => {
  const { state, options, capitals, city, visibility } = fixture();
  const presentation = createCityGeometryPresentation({ state, isCapitalVisible: visibility.isCapitalVisible });
  assert.deepEqual(capitals(), ["old"]);
  state.cityNameOverrides = { new: { en: "Custom", hidden: true } };
  assert.equal(setCapitalOverride(state, "aa", "new", options), true);
  assert.deepEqual(state.cityNameOverrides, { new: { en: "Custom" } });
  assert.deepEqual(capitals(), ["new"]);
  assert.equal(presentation.getCityCapitalDescriptor({ feature: city("old") }), "");
  assert.equal(presentation.getCityCapitalDescriptor({ feature: city("new") }), "Capital");
  assert.equal(setCapitalOverride(state, "AA", null), true);
  assert.deepEqual(capitals(), []);
  clearCapitalOverride(state, "AA");
  assert.deepEqual(capitals(), ["old"]);
  state.capitalOverrides = normalizeCapitalOverrides({ AA: { cityId: "late" }, ZZ: { cityId: "new" } });
  assert.deepEqual(capitals(), ["old"]);
  assert.equal(state.capitalOverrides.AA.cityId, "late");
});

test("project city joins the collection and can be the capital of a landless-on-baseline country", () => {
  const { state, options, visibility, capitals, city } = fixture();
  state.visualOverrides.N = "#cccccc";
  const id = addProjectCity(state, { name: { zh: "新城" }, lon: 1, lat: 1, hostFeatureId: "N" });
  assert.deepEqual(city(id).properties.__city_locale, { zh: "新城", en: "新城" });
  assert.deepEqual(capitals(), ["old"]);
  assert.equal(setCapitalOverride(state, "CC", id, options), true);
  assert.deepEqual(capitals(), ["old", id]);
  assert.equal(visibility.getCapitalTag(city(id)), "CC");
  assert.equal(visibility.isCapitalVisible(city(id)), true);
  state.cityNameOverrides = { [id]: { hidden: true } };
  assert.equal(removeProjectCity(state, id), true);
  assert.equal(city(id), undefined);
  assert.deepEqual(state.cityNameOverrides, {});
  assert.deepEqual(state.capitalOverrides, {});
});

test("queries use current borders and retain foreign-held reference members", () => {
  const { state, options } = fixture();
  state.visualOverrides.P = "#bbbbbb";
  state.visualOverrides.Q = "#aaaaaa";
  assert.deepEqual(listCountryCities(state, "AA", options).map(({ id, inTerritory }) => [id, inTerritory]),
    [["old", false], ["new", true], ["foreign", true]]);
  assert.equal(pickLargestCity(state, "AA", options), "foreign");
  assert.equal(isCityInCountryTerritory(state, "AA", "old", options), false);
  assert.equal(setCapitalOverride(state, "AA", "old", options), false);
  assert.equal(setCapitalOverride(state, "ZZ", null), false);
});

test("visibility follows occupation, recovery, parent merging and uniform custom recoloring", () => {
  const { state, city, visibility, options } = fixture();
  const capital = city("old");
  state.visualOverrides.P = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(capital), false);
  state.visualOverrides.P = "#aaaaaa";
  assert.equal(visibility.isCapitalVisible(capital), true);
  state.visualOverrides.P = state.visualOverrides.N = "#121212";
  assert.equal(visibility.isCapitalVisible(capital), true);
  assert.equal(createCapitalVisibility({ state, ...options, getSuppressedCodes: () => new Set(["AA"]) })
    .isCapitalVisible(capital), false);
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag, BB: { presentation: "parent_merged", parent_owner_tag: "AA" } };
  state.visualOverrides.P = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(capital), true);
});

test("an occupying country can choose the former capital and lose it again", () => {
  const { state, city, options, visibility } = fixture();
  state.visualOverrides.P = "#cccccc";
  assert.equal(setCapitalOverride(state, "CC", "old", options), true);
  const capital = city("old");
  assert.equal(visibility.getCapitalTag(capital), "CC");
  state.visualOverrides.P = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(capital), false);
  delete state.visualOverrides.P;
  assert.equal(visibility.isCapitalVisible(capital), true);
  assert.equal(visibility.getCapitalTag(capital), "AA");
});

test("a river city uses its cell even outside river editing mode", async t => {
  const saved = globalThis.d3;
  globalThis.d3 = d3;
  t.after(() => { if (saved === undefined) delete globalThis.d3; else globalThis.d3 = saved; });
  const river = await makeFixture();
  const { state, city, visibility } = fixture(river.state);
  state.riverPaint.editMode = false;
  state.riverPaint.overrides[river.cells[1].id] = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(city("old")), true);
  state.riverPaint.overrides[river.cells[0].id] = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(city("old")), false);
});

test("a project capital follows its host while the country loses territory", () => {
  const { state, city, visibility, options } = fixture();
  const id = addProjectCity(state, { name: { en: "Town" }, lon: 0, lat: 0, hostFeatureId: "N" });
  assert.equal(setCapitalOverride(state, "AA", id, options), true);
  state.visualOverrides.P = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(city(id)), true);
  state.visualOverrides.N = "#bbbbbb";
  assert.equal(visibility.isCapitalVisible(city(id)), false);
});

test("normalization keeps unresolved ids and discards malformed records", () => {
  assert.deepEqual(normalizeCapitalOverrides({ uk: { cityId: " later " }, AA: { cityId: null }, BB: {} }),
    { GB: { cityId: "later" }, AA: { cityId: null } });
  const valid = { id: "project_city_1", lon: 0, lat: 0, name: { en: "Name" } };
  assert.deepEqual(normalizeProjectCities([null, valid, { ...valid, id: "project_city_2", lat: 100 }]),
    [{ ...valid, name: { en: "Name", zh: "Name" }, tier: "minor", hostFeatureId: "" }]);
});
