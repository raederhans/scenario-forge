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
  commitPreparedBaseCitySupportData, commitPreparedFullLocalizationData,
  isCityRevisionFromLocalizationPublication,
} from "../js/core/state/content_state.js";
import { prepareScenarioLocalizationState } from "../js/core/scenario_localization_state.js";
import { applyScenarioChunkCityExternalEffectState } from "../js/core/state/actions/scenario_presentation_actions.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

function localizationFixture(runtimeState) {
  const source = readFileSync(new URL("../js/core/scenario_localization_state.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  return vm.runInNewContext(`${source}\n({ syncScenarioLocalizationState, syncScenarioLocalizationStateAsync })`, {
    runtimeState, buildCityLocalizationPatch, normalizeCityText,
    applyScenarioChunkCityExternalEffectState, copyLocalizationEntries, prepareLocalizationCandidate,
    isCityRevisionFromLocalizationPublication,
    console: { info() {} }, globalThis,
  });
}

const syncFixture = (snapshot) => localizationFixture(snapshot).syncScenarioLocalizationState;

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

function optionalCityFixture() {
  const snapshot = {
    activeScenarioId: "optional-city", cityLayerRevision: 0,
    baseGeoLocales: Object.fromEntries(Array.from({ length: 768 }, (_, i) => [`base-${i}`, { en: `Base ${i}` }])),
    baseGeoAliasToStableKey: { alias: "base-0" },
    worldCitiesData: { features: [{ id: "source", properties: { host_feature_id: "HOST" } }] },
    ruCityOverrides: null, scenarioCityOverridesData: null,
    scenarioGeoLocalePatchData: { geo: { EXPLICIT: { en: "Explicit" } } },
    locales: { ui: { old: "UI" }, geo: { old: { en: "Old" } } },
    geoAliasToStableKey: { old: "old" },
  };
  const payload = { cities: { source: { city_id: "source", display_name: { en: "New city" } } } };
  let clock = 0;
  return { snapshot, payload, options: { nowMs: () => ++clock, sliceBudgetMs: 1 } };
}

test("async optional cities publish complete equivalent tables and reuse only a confirmed result", async () => {
  const { snapshot, payload, options } = optionalCityFixture();
  let copied = 0;
  Object.defineProperty(snapshot.baseGeoLocales, "count-copy", { enumerable: true, get() { copied++; return { en: "Count" }; } });
  const expected = { ...snapshot, locales: { ...snapshot.locales } };
  syncFixture(expected)({ cityOverridesPayload: payload });
  copied = 0;
  const api = localizationFixture(snapshot);
  const previousLocales = snapshot.locales;
  const previousAliases = snapshot.geoAliasToStableKey;
  let yields = 0;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, yieldControl: async () => {
      yields++;
      assert.equal(snapshot.scenarioCityOverridesData, null);
      assert.equal(snapshot.cityLayerRevision, 0);
      assert.equal(snapshot.locales, previousLocales);
      assert.deepEqual(snapshot.locales.geo, { old: { en: "Old" } });
      assert.equal(snapshot.geoAliasToStableKey, previousAliases);
    },
  }), true);
  assert.ok(yields > 2);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.locales)), JSON.parse(JSON.stringify(expected.locales)));
  assert.deepEqual({ ...snapshot.geoAliasToStableKey }, { ...expected.geoAliasToStableKey });
  assert.equal(snapshot.scenarioCityOverridesData, payload);
  assert.equal(snapshot.cityLayerRevision, 1);
  assert.equal(copied, 1);
  const completedGeo = snapshot.locales.geo;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    yieldControl: async () => assert.fail("confirmed input must not copy or yield again"),
  }), true);
  api.syncScenarioLocalizationState({ cityOverridesPayload: payload });
  assert.equal(snapshot.locales.geo, completedGeo);
  assert.equal(copied, 1, "both async and sync rehydrate reuse the fully confirmed result");
});

test("async optional cities discard cancellation and a later retry publishes all entries", async () => {
  const { snapshot, payload, options } = optionalCityFixture();
  const api = localizationFixture(snapshot);
  const previousLocales = snapshot.locales;
  let current = true;
  let yields = 0;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, isCurrent: () => current,
    yieldControl: async () => { if (++yields === 2) current = false; },
  }), false);
  assert.equal(snapshot.locales, previousLocales);
  assert.deepEqual(snapshot.locales.geo, { old: { en: "Old" } });
  assert.equal(snapshot.scenarioCityOverridesData, null);
  assert.equal(snapshot.cityLayerRevision, 0);
  current = true;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, isCurrent: () => current, yieldControl: async () => {},
  }), true);
  assert.equal(snapshot.locales.geo.HOST.en, "New city");
  assert.equal(snapshot.locales.geo["base-767"].en, "Base 767");
});

test("parallel base localization and patch replacement restart preparation using the latest input", async () => {
  const { snapshot, payload, options } = optionalCityFixture();
  const api = localizationFixture(snapshot);
  let yields = 0;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, yieldControl: async () => {
      if (++yields !== 2) return;
      const baseGeoLocales = { LATEST: { en: "Full locale" } };
      const baseGeoAliasToStableKey = { latest: "LATEST" };
      const locales = { ui: { full: "Full UI" }, geo: { ...baseGeoLocales } };
      commitPreparedBaseCitySupportData(snapshot, {
        baseGeoLocales, baseGeoAliasToStableKey, locales, geoAliasToStableKey: { ...baseGeoAliasToStableKey },
        worldCities: snapshot.worldCitiesData, cityAliases: {},
      });
      commitPreparedFullLocalizationData(snapshot, {
        baseGeoLocales, baseGeoAliasToStableKey, locales, geoAliasToStableKey: { ...baseGeoAliasToStableKey },
        scenarioActive: true,
      });
      snapshot.scenarioGeoLocalePatchData = { geo: { EXPLICIT: { en: "Latest patch" } } };
    },
  }), true);
  assert.ok(yields >= 3, "replacement starts another host slice");
  assert.equal(snapshot.locales.geo.LATEST.en, "Full locale");
  assert.equal(snapshot.locales.geo["base-0"], undefined);
  assert.equal(snapshot.locales.geo.EXPLICIT.en, "Latest patch");
  assert.equal(snapshot.locales.geo.HOST.en, "New city");
  assert.equal(snapshot.geoAliasToStableKey.latest, "LATEST");
  assert.equal(snapshot.locales.ui.full, "Full UI");
  assert.equal(snapshot.cityLayerRevision, 3, "both real hydration commits and the city publication bump revisions");
});

test("city edits during async preparation cancel publication and preserve the edit", async () => {
  const { snapshot, payload, options } = optionalCityFixture();
  const api = localizationFixture(snapshot);
  const editedCity = { cities: { edit: { display_name: { en: "Edited" } } } };
  let yields = 0;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, yieldControl: async () => {
      if (++yields !== 2) return;
      snapshot.scenarioCityOverridesData = editedCity;
      snapshot.cityLayerRevision++;
    },
  }), false);
  assert.equal(snapshot.scenarioCityOverridesData, editedCity);
  assert.equal(snapshot.cityLayerRevision, 1);
  assert.deepEqual(snapshot.locales.geo, { old: { en: "Old" } });
});

test("a city revision edit after localization publication invalidates its continuation proof", async () => {
  const { snapshot, payload, options } = optionalCityFixture();
  const api = localizationFixture(snapshot);
  let yields = 0;
  assert.equal(await api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, {
    ...options, yieldControl: async () => {
      if (++yields !== 2) return;
      commitPreparedFullLocalizationData(snapshot, {
        baseGeoLocales: snapshot.baseGeoLocales, baseGeoAliasToStableKey: snapshot.baseGeoAliasToStableKey,
        locales: { ui: {}, geo: { FULL: { en: "Full" } } }, geoAliasToStableKey: {}, scenarioActive: true,
      });
      assert.equal(isCityRevisionFromLocalizationPublication(snapshot, 0), true);
      snapshot.cityLayerRevision++;
      assert.equal(isCityRevisionFromLocalizationPublication(snapshot, 0), false);
    },
  }), false);
  assert.equal(snapshot.scenarioCityOverridesData, null);
  assert.equal(snapshot.locales.geo.FULL.en, "Full");
  assert.equal(snapshot.cityLayerRevision, 2);
});

for (const changedInput of ["baseGeoLocales", "baseGeoAliasToStableKey", "scenarioGeoLocalePatchData", "worldCitiesData", "ruCityOverrides", "locales", "geoAliasToStableKey", "cityLayerRevision", "cities", "featureCollection"]) {
  test(`confirmed localization is rebuilt after ${changedInput} changes`, async () => {
    const { snapshot, payload, options } = optionalCityFixture();
    const api = localizationFixture(snapshot);
    const prepare = () => api.syncScenarioLocalizationStateAsync({ cityOverridesPayload: payload }, { ...options, yieldControl: async () => {} });
    await prepare();
    const previous = snapshot.locales.geo;
    if (changedInput === "cityLayerRevision") snapshot.cityLayerRevision++;
    else if (changedInput === "cities") payload.cities = { source: { city_id: "source", display_name: { en: "Changed city" } } };
    else if (changedInput === "featureCollection") payload.featureCollection = { type: "FeatureCollection", features: [] };
    else snapshot[changedInput] = { ...snapshot[changedInput] };
    assert.equal(await prepare(), true);
    assert.notEqual(snapshot.locales.geo, previous);
    if (changedInput === "cities") assert.equal(snapshot.locales.geo.HOST.en, "Changed city");
  });
}

test("scenario-scoped merges point member aliases at the merged feature only in that scenario", async () => {
  // RU_D, RU_E -> RU_MRG_S, then RU_MRG_S, RU_G -> RU_MRG_T, both scoped to TNO.
  const baseAliasMap = { Zmeinogorsky: "id::RU_D", "Old merge": "id::RU_MRG_S", Barnaul: "id::RU_F" };
  const overrides = { feature_merges: { RU_MRG_T: ["RU_D", "RU_E", "RU_G"] }, feature_redirects: { RU_MRG_S: "RU_MRG_T" } };
  const options = { yieldControl: async () => {} };
  const tno = await prepareScenarioLocalizationState({
    activeScenarioId: "tno_1962", activeScenarioManifest: { hierarchy_overrides: overrides },
  }, { baseGeoLocales: {}, baseAliasMap }, options);
  assert.deepEqual(tno.aliasToStableKey, { Zmeinogorsky: "id::RU_MRG_T", "Old merge": "id::RU_MRG_T", Barnaul: "id::RU_F" });
  const hoi4 = await prepareScenarioLocalizationState({ activeScenarioId: "hoi4_1936", activeScenarioManifest: {} },
    { baseGeoLocales: {}, baseAliasMap }, options);
  assert.deepEqual(hoi4.aliasToStableKey, baseAliasMap);
  assert.equal(baseAliasMap.Zmeinogorsky, "id::RU_D");
});
