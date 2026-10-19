import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import {
  buildCityLocalizationPatch, normalizeCityFeatureCollection,
  normalizeCityText, normalizeScenarioCityOverridesPayload,
} from "../js/core/data_loader.js";
import {
  commitFullLocalizationData, copyLocalizationEntries,
  prepareFullLocalizationData, prepareLocalizationCandidate,
} from "../js/core/state/content_state.js";
import { prepareScenarioLocalizationState } from "../js/core/scenario_localization_state.js";
import { applyScenarioChunkCityExternalEffectState } from "../js/core/state/actions/scenario_presentation_actions.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

function syncFixture(runtimeState) {
  const source = readFileSync(new URL("../js/core/scenario_localization_state.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  return vm.runInNewContext(`${source}\nsyncScenarioLocalizationState`, {
    runtimeState, buildCityLocalizationPatch, normalizeCityText,
    applyScenarioChunkCityExternalEffectState, copyLocalizationEntries, prepareLocalizationCandidate,
    console: { info() {} }, globalThis,
  });
}

test("cooperative full localization matches the synchronous TNO merge including language fallbacks and aliases", async () => {
  const previousD3 = globalThis.d3;
  globalThis.d3 = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
  try {
    const worldCitiesData = normalizeCityFeatureCollection(read("../data/world_cities.geojson"));
    const baseCityAliasesData = read("../data/city_aliases.json");
    const full = read("../data/locales.json");
    const aliases = read("../data/geo_aliases.json").alias_to_stable_key;
    const manifest = read("../data/scenarios/tno_1962/manifest.json");
    const scenarioCityOverridesData = normalizeScenarioCityOverridesPayload(read("../data/scenarios/tno_1962/city_overrides.json"));
    const scenarioGeoLocalePatchData = read(`../${manifest.geo_locale_patch_url}`);
    const snapshot = {
      activeScenarioId: "tno_1962", currentLanguage: "zh", locales: { ui: { old: "Startup" }, geo: { old: { en: "Old" } } },
      worldCitiesData, baseCityAliasesData, scenarioCityOverridesData, scenarioGeoLocalePatchData,
      ruCityOverrides: read("../data/ru_city_overrides.geojson"),
    };
    const oldLocales = snapshot.locales;
    const cityPatch = buildCityLocalizationPatch({ cityCollection: worldCitiesData, cityAliases: baseCityAliasesData });
    const synchronous = { ...snapshot, locales: { ...oldLocales } };
    commitFullLocalizationData(synchronous, { uiLocales: full.ui,
      geoLocales: { ...full.geo, ...cityPatch.geo }, aliasToStableKey: { ...aliases, ...cityPatch.aliasToStableKey }, scenarioActive: true });
    syncFixture(synchronous)({ cityOverridesPayload: scenarioCityOverridesData, geoLocalePatchPayload: scenarioGeoLocalePatchData });

    let yields = 0;
    let clock = 0;
    const options = { nowMs: () => ++clock, sliceBudgetMs: 3, yieldControl: async () => {
      yields++;
      assert.equal(snapshot.locales, oldLocales);
      assert.equal(snapshot.locales.geo.old.en, "Old");
    } };
    const base = await prepareFullLocalizationData({ uiLocales: full.ui, geoLocales: full.geo, aliasToStableKey: aliases, cityPatch }, options);
    const final = await prepareScenarioLocalizationState(snapshot, { baseGeoLocales: base.baseGeoLocales, baseAliasMap: base.baseGeoAliasToStableKey }, options);
    assert.ok(yields > 10, "large dictionaries and the city scan must span several tasks");
    assert.deepEqual(base.baseGeoLocales, synchronous.baseGeoLocales);
    assert.deepEqual(base.baseGeoAliasToStableKey, synchronous.baseGeoAliasToStableKey);
    assert.deepEqual(base.uiLocales, synchronous.locales.ui);
    assert.deepEqual(final.geo, JSON.parse(JSON.stringify(synchronous.locales.geo)));
    assert.deepEqual(final.aliasToStableKey, { ...synchronous.geoAliasToStableKey });
    assert.notEqual(final.geo, base.baseGeoLocales);
    assert.notEqual(final.aliasToStableKey, base.baseGeoAliasToStableKey);
    assert.equal(snapshot.currentLanguage, "zh");
  } finally { globalThis.d3 = previousD3; }
});

test("city overrides preserve missing-language fallback, explicit patch priority and per-preparation centroid caching", async () => {
  const previousD3 = globalThis.d3;
  let centroidCalls = 0;
  globalThis.d3 = { geoContains: () => false, geoCentroid: (feature) => { centroidCalls++; return feature.geometry.coordinates; } };
  try {
    const snapshot = {
      worldCitiesData: { features: [0, 1].map((i) => ({ id: `city-${i}`, geometry: { type: "Point", coordinates: [40, 50] },
        properties: { country_code: "RU", host_feature_id: i ? "EXPLICIT" : "FALLBACK" } })) },
      ruCityOverrides: { features: [{ id: "NEAR", geometry: { type: "Point", coordinates: [40, 50] } },
        { id: "FAR", geometry: { type: "Point", coordinates: [140, -50] } }] },
      scenarioCityOverridesData: { cities: {
        one: { city_id: "city-0", display_name: { en: "English only" } },
        two: { city_id: "city-1", display_name: { zh: "仅中文" } },
      } }, scenarioGeoLocalePatchData: { geo: { EXPLICIT: { en: "Saved edit" } } },
    };
    const baseGeoLocales = { FALLBACK: { en: "Old", zh: "保留中文", fr: "French" }, EXPLICIT: { en: "Old", zh: "Old" } };
    const result = await prepareScenarioLocalizationState(snapshot, { baseGeoLocales }, { yieldControl: async () => {} });
    assert.deepEqual(result.geo.FALLBACK, { en: "English only", zh: "保留中文", fr: "French" });
    assert.deepEqual(result.geo.EXPLICIT, { en: "Saved edit" });
    assert.equal(centroidCalls, 2, "each Russian polygon centroid is calculated once per preparation");
    await prepareScenarioLocalizationState(snapshot, { baseGeoLocales }, { yieldControl: async () => {} });
    assert.equal(centroidCalls, 4, "a later preparation must not retain stale spatial data");
  } finally { globalThis.d3 = previousD3; }
});

test("cancellation at a dictionary slice discards the private candidate", async () => {
  const geoLocales = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [i, { en: `Name ${i}` }]));
  let current = true;
  let yields = 0;
  let clock = 0;
  const result = await prepareFullLocalizationData({ geoLocales }, {
    isCurrent: () => current, nowMs: () => ++clock, sliceBudgetMs: 1,
    yieldControl: async () => { if (++yields === 2) current = false; },
  });
  assert.equal(result, null);
  assert.equal(yields, 2);
  assert.equal(Object.keys(geoLocales).length, 2000);
});
