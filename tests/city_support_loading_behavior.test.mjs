import test from "node:test";
import assert from "node:assert/strict";
import { loadCitySupportData, buildCityLocalizationPatchSteps, mergeCityLocalizationData } from "../js/core/data_loader.js";
import { prepareLocalizationCandidate, prepareFullLocalizationData, commitPreparedBaseCitySupportData } from "../js/core/state/content_state.js";

test("night-light data does not fetch aliases or clone locales, then labels reuse normalized geometry", async () => {
  const requests = [];
  const locales = { ui: {}, geo: { retained: { en: "Existing" } } };
  const options = {
    worldCitiesUrls: ["cities"], cityAliasesUrls: ["aliases"], locales,
    d3Client: { json: async (url) => {
      requests.push(url);
      return url === "cities" ? { type: "FeatureCollection", features: [{ type: "Feature",
        geometry: { type: "Point", coordinates: [12, 48] },
        properties: { id: "test-city", name: "City", population: 250000 },
      }] } : {};
    } },
  };
  const geometry = await loadCitySupportData({ ...options, includeLocalization: false });
  assert.deepEqual(requests, ["cities"]);
  assert.equal(geometry.localizationReady, false);
  assert.equal(geometry.locales, undefined);
  assert.equal(geometry.worldCities.features.length, 1);
  const full = await loadCitySupportData({ ...options, cityCollection: geometry.worldCities });
  assert.equal(full.worldCities, geometry.worldCities);
  assert.equal(full.localizationReady, true);
  assert.deepEqual(requests, ["cities", "aliases"]);
  assert.deepEqual(full.locales.geo.retained, locales.geo.retained);
  assert.ok(Object.keys(full.cityLocalizationPatch.geo).length > 0);
});

test("city support normalizes privately in slices and defers localization without enumerating live dictionaries", async () => {
  const raw = { type: "FeatureCollection", features: Array.from({ length: 1024 }, (_, index) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [12, 48] }, properties: { id: `city-${index}`, name: "City" },
  })) };
  let yields = 0, clock = 0;
  const aliases = { alias_to_stable_key: { City: "CITY" } };
  const dictionary = new Proxy({}, { ownKeys() { throw new Error("live dictionary enumerated during resource load"); } });
  const result = await loadCitySupportData({
    worldCitiesUrls: ["cities"], cityAliasesUrls: ["aliases"],
    d3Client: { json: async (url) => url === "cities" ? raw : aliases },
    locales: { geo: dictionary }, geoAliases: { alias_to_stable_key: dictionary }, deferLocalization: true,
    prepareCandidate: (iterator) => prepareLocalizationCandidate(iterator, {
      nowMs: () => ++clock, sliceBudgetMs: 1, yieldControl: async () => { yields++; },
    }),
  });
  assert.ok(yields >= 9);
  assert.equal(result.localizationDeferred, true);
  assert.equal(result.locales, undefined);
  assert.equal(result.cityAliases, aliases);
  assert.equal(result.worldCities.features.length, raw.features.length);
  assert.notEqual(result.worldCities, raw);
  assert.equal(raw.features[0].properties.__city_id, undefined);
});

test("100k city aliases prepare completely in private slices with legacy merge precedence", async () => {
  const aliases = Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => [` alias-${index} `, ` key-${index} `]));
  const cityAliases = { alias_to_stable_key: aliases, geo: { CITY: { en: "Alias English" } },
    locales: { geo: { CITY: { zh: "覆盖中文" } } }, cities: [{ stable_key: "CITY", name_en: "Final English", aliases: ["Final"] }] };
  const locales = { ui: { retained: "UI" }, geo: { OLD: { en: "Old" }, CITY: { fr: "French" } } };
  const geoAliases = { alias_to_stable_key: { existing: "OLD" } };
  const expected = mergeCityLocalizationData({ locales, geoAliases, cityAliases });
  let yields = 0, clock = 0;
  const originalGeo = locales.geo;
  const options = { nowMs: () => ++clock, sliceBudgetMs: 1, yieldControl: async () => {
    yields++;
    assert.equal(locales.geo, originalGeo);
    assert.deepEqual(Object.keys(locales.geo), ["OLD", "CITY"]);
  } };
  const patch = await prepareLocalizationCandidate(buildCityLocalizationPatchSteps({ cityAliases }), options);
  const candidate = await prepareFullLocalizationData({
    uiLocales: locales.ui, geoLocales: locales.geo, aliasToStableKey: geoAliases.alias_to_stable_key, cityPatch: patch,
  }, options);
  // Dictionary copies now move 2048 keys per step; 100k aliases still cross dozens of slices.
  assert.ok(yields > 50, "alias normalization and complete copies must cross many deterministic slices");
  assert.deepEqual(candidate.baseGeoLocales, expected.locales.geo);
  assert.deepEqual(candidate.baseGeoAliasToStableKey, expected.geoAliases.alias_to_stable_key);
  assert.equal(candidate.baseGeoAliasToStableKey["alias-99999"], "key-99999");
  assert.equal(candidate.baseGeoAliasToStableKey.Final, "CITY");
  assert.deepEqual(candidate.baseGeoLocales.CITY, expected.cityLocalizationPatch.geo.CITY);
});

test("prepared city publication adopts dictionary references without enumerating their entries", () => {
  const dictionary = () => new Proxy({}, { ownKeys() { throw new Error("publication copied dictionary entries"); } });
  const candidate = { worldCities: { features: [] }, cityAliases: {},
    baseGeoLocales: dictionary(), baseGeoAliasToStableKey: dictionary(),
    locales: { ui: {}, geo: dictionary() }, geoAliasToStableKey: dictionary() };
  const state = { cityLayerRevision: 8 };
  commitPreparedBaseCitySupportData(state, candidate);
  for (const field of ["baseGeoLocales", "baseGeoAliasToStableKey", "locales", "geoAliasToStableKey"]) assert.equal(state[field], candidate[field]);
  assert.equal(state.worldCitiesData, candidate.worldCities);
  assert.equal(state.baseCityLocalizationReady, true);
  assert.equal(state.baseCityDataState, "loaded");
  assert.equal(state.cityLayerRevision, 9);
});
