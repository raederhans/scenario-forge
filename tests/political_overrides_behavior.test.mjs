import assert from "node:assert/strict";
import test from "node:test";
import { state, registerRuntimeHook } from "../js/core/state.js";
import { undoHistory, redoHistory } from "../js/core/history_manager.js";
import { collectPresentOwnerTags } from "../js/core/legend_manager.js";
import { refreshColorState } from "../js/core/map_renderer/public.js";
import { getPoliticalIdentity, listAllianceOptions, listIdeologyOptions } from "../js/core/political_overrides.js";
import {
  createCustomAlliance, deleteCustomAlliance, resetCountryPolitical, setCountryAlliance, setCountryIdeology,
} from "../js/core/political_override_commands.js";
import {
  getPoliticalDisplayLegend, getPoliticalDisplayModeSignature, isPoliticalDisplayModeSupported, resolvePoliticalDisplayColor,
} from "../js/core/political_display_mode.js";

function setup() {
  const countries = { AA: { ruling_ideology: "democratic", alliance: "allies" }, BB: { ruling_ideology: "communism" } };
  const child = parent => ({ entry_kind: "releasable", parent_owner_tag: parent });
  Object.assign(state, {
    activeScenarioId: "sample", scenarioApplyInFlight: false, politicalDisplayMode: "country", currentLanguage: "en",
    scenarioBundleCacheById: { sample: { countriesPayload: { countries, alliances: { allies: { name_en: "Allies" } } } } },
    scenarioCountriesByTag: { AA: {}, BB: {}, CC: child("AA"), DD: child("CC"), P01: { project_country: true } },
    politicalOverrides: {}, politicalAlliances: {}, historyPast: [], historyFuture: [],
    landData: { features: [{ id: "land" }] }, landDataFull: null, scenarioBaselineOwnersByFeatureId: { land: "AA" },
    sovereignBaseColors: { AA: "#112233", BB: "#345678" }, visualOverrides: {}, colors: { land: "#112233" },
  });
  registerRuntimeHook(state, "refreshColorStateFn", refreshColorState);
}

test("political identity follows parent ideology overrides, preserves non-alignment and terminates cycles", () => {
  setup();
  assert.deepEqual(getPoliticalIdentity(state, "dd"), {
    alliance: null, ideology: "democratic", allianceSource: "none", ideologySource: "inherited",
  });
  state.politicalDisplayMode = "government";
  assert.equal(resolvePoliticalDisplayColor(state, "DD"), "#3b6fb6");
  const signature = getPoliticalDisplayModeSignature(state);
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag, CC: { releasable: true, parent_owner_tag: "DD" } };
  assert.equal(getPoliticalDisplayModeSignature(state), signature);
  assert.equal(getPoliticalIdentity(state, "DD").ideologySource, "none");
  assert.equal(resolvePoliticalDisplayColor(state, "DD"), "#d9d6cc");
  state.politicalOverrides = { DD: { ideology: "communism" }, AA: { alliance: null } };
  assert.notEqual(getPoliticalDisplayModeSignature(state), signature);
  assert.equal(resolvePoliticalDisplayColor(state, "CC"), "#c0392b");
  assert.deepEqual(getPoliticalIdentity(state, "AA"), {
    alliance: null, ideology: "democratic", allianceSource: "override", ideologySource: "scenario",
  });
  state.politicalDisplayMode = "alliance";
  assert.equal(resolvePoliticalDisplayColor(state, "AA"), resolvePoliticalDisplayColor({ ...state,
    politicalOverrides: { P01: { ideology: "democratic" } } }, "P01"));
});

test("political options and activation follow scenario data and the selected country's saved ideology", () => {
  setup();
  assert.deepEqual(listAllianceOptions(state), [{ id: "allies", label: "Allies", color: "#1f4e9c", custom: false }]);
  state.politicalOverrides = { P01: { ideology: "socialist" } };
  assert.deepEqual(listIdeologyOptions(state, "P01").map(o => o.id), ["democratic", "communism", "socialist"]);
  assert.deepEqual(listIdeologyOptions(state, "AA").map(o => o.id), ["democratic", "communism"]);
  for (const id of ["blank_base", "modern_world"]) {
    state.activeScenarioId = id;
    state.scenarioBundleCacheById[id] = { countriesPayload: { countries: {} } };
    state.politicalOverrides = {};
    state.politicalAlliances = {};
    assert.equal(isPoliticalDisplayModeSupported(state), false);
    assert.deepEqual(listIdeologyOptions(state, "P01").map(o => o.id), ["democratic", "fascism", "communism", "neutrality"]);
    assert.ok(setCountryIdeology("p01", "neutrality"));
    assert.equal(getPoliticalIdentity(state, "P01").ideologySource, "override");
    assert.equal(isPoliticalDisplayModeSupported(state), true);
    assert.ok(resetCountryPolitical("P01", "ideology"));
    assert.deepEqual(state.politicalOverrides, {});
    assert.ok(createCustomAlliance({ name: "League", color: "#def" }));
    assert.equal(isPoliticalDisplayModeSupported(state), true);
  }
  state.activeScenarioId = "missing";
  assert.equal(isPoliticalDisplayModeSupported(state), false);
});

test("prototype names in scenario data produce the unknown alliance and other government swatches", () => {
  setup();
  for (const id of ["constructor", "__proto__", "prototype"]) {
    state.scenarioBundleCacheById.sample.countriesPayload = { countries: { AA: { alliance: id, ruling_ideology: id } }, alliances: {} };
    for (const [mode, color] of [["alliance", "#7d6b9e"], ["government", "#b9b4a6"]]) {
      state.politicalDisplayMode = mode;
      assert.equal(resolvePoliticalDisplayColor(state, "AA"), color);
      assert.equal(getPoliticalDisplayLegend(state).entries[0].color, color);
    }
  }
});

test("commands rebuild actual land colors only while a political display is active", () => {
  setup();
  const calls = [];
  registerRuntimeHook(state, "refreshColorStateFn", options => { calls.push(options); refreshColorState(options); });
  const colors = state.colors;
  assert.ok(setCountryIdeology("AA", "communism"));
  assert.equal(state.colors, colors);
  assert.deepEqual(calls, []);
  state.politicalDisplayMode = "alliance";
  assert.ok(setCountryAlliance("AA", null));
  assert.equal(state.colors.land, "#db9d92");
  assert.deepEqual(calls, [{ renderNow: true }]);
  assert.equal(setCountryAlliance("AA", null), false);
  assert.ok(resetCountryPolitical("AA", "alliance"));
  assert.deepEqual(state.politicalOverrides.AA, { ideology: "communism" });
  assert.equal(state.colors.land, "#1f4e9c");
  assert.ok(resetCountryPolitical("AA"));
  assert.deepEqual(state.politicalOverrides, {});

  state.scenarioBundleCacheById.sample.countriesPayload = { countries: {} };
  assert.ok(setCountryIdeology("AA", "communism"));
  assert.equal(state.colors.land, "#db9d92");
  assert.ok(resetCountryPolitical("AA"));
  assert.equal(state.colors.land, "#112233");
});

test("custom alliances reject reserved colors, limit the number of alliances and undo deletion atomically", () => {
  setup();
  for (const color of ["#1f4e9c", "#d9d6cc", "#b9b4a6", "#7d6b9e", "#c0392b", "#db9d92", "invalid"]) {
    assert.equal(createCustomAlliance({ name: "League", color }), false);
  }
  const id = createCustomAlliance({ name: "🌍".repeat(121), color: "#abc" });
  assert.equal(id, "custom_1");
  assert.deepEqual(state.politicalAlliances[id], { name: "🌍".repeat(120), color: "#aabbcc" });
  assert.equal(createCustomAlliance({ name: "Duplicate", color: "#aabbcc" }), false);
  assert.equal(deleteCustomAlliance("allies"), false);
  assert.ok(setCountryAlliance("P01", id));
  assert.ok(setCountryAlliance("AA", id));
  assert.ok(setCountryIdeology("AA", "communism"));
  state.politicalDisplayMode = "alliance";
  const signature = getPoliticalDisplayModeSignature(state);
  assert.equal(resolvePoliticalDisplayColor(state, "AA"), "#aabbcc");
  assert.deepEqual(getPoliticalDisplayLegend(state).entries[0], { color: "#aabbcc", label: "🌍".repeat(120) + " (1 countries)" });
  const past = state.historyPast.length;
  assert.ok(deleteCustomAlliance(id));
  assert.deepEqual(state.politicalOverrides, { P01: { alliance: null }, AA: { alliance: null, ideology: "communism" } });
  assert.equal(state.historyPast.length, past + 1);
  assert.equal(state.colors.land, "#db9d92");
  assert.ok(undoHistory());
  assert.equal(state.colors.land, "#aabbcc");
  assert.equal(getPoliticalIdentity(state, "P01").alliance, id);
  assert.ok(redoHistory());
  assert.deepEqual(state.politicalAlliances, {});
  const beforeCreate = getPoliticalDisplayModeSignature(state);
  for (let i = 0; i < 16; i++) {
    assert.equal(createCustomAlliance({ name: "Group", color: "#" + (i + 1).toString(16).padStart(6, "0") }), "custom_" + (i + 2));
  }
  assert.notEqual(getPoliticalDisplayModeSignature(state), beforeCreate);
  assert.notEqual(getPoliticalDisplayModeSignature(state), signature);
  assert.equal(createCustomAlliance({ name: "Extra", color: "#eee" }), false);
});

test("the cached political legend counts effective owners from the full land collection", () => {
  setup();
  state.politicalDisplayMode = "alliance";
  state.landDataFull = { features: ["land", "transfer", "anonymous"].map(id => ({ id })) };
  state.scenarioBaselineOwnersByFeatureId = { land: "AA", transfer: "AA", anonymous: "AA" };
  state.visualOverrides = { transfer: "#345678", anonymous: "#999999" };
  assert.deepEqual(collectPresentOwnerTags(state), new Set(["AA", "BB"]));
  const legend = getPoliticalDisplayLegend(state);
  assert.equal(legend.entries[0].label, "Allies (1 countries)");
  assert.equal(getPoliticalDisplayLegend(state), legend);
  state.visualOverrides.land = "#345678";
  state.colorRevision++;
  assert.deepEqual(collectPresentOwnerTags(state), new Set(["BB"]));
  assert.deepEqual(getPoliticalDisplayLegend(state).entries, [{ label: "No data", color: "#d9d6cc" }]);
});

test("river cells in full land inherit the parent baseline and count repainted cells separately", async () => {
  const { makeFixture } = await import("./helpers/river_paint_fixture.mjs");
  const { state: map, cells, parent } = await makeFixture();
  map.landDataFull = { features: [parent] };
  map.landData = { features: [] };
  map.landIndex = new Map();
  map.scenarioBaselineOwnersByFeatureId = { P: "AA" };
  map.sovereignBaseColors = { AA: "#112233", BB: "#445566" };
  map.riverPaint = { ...map.riverPaint, overrides: { [cells[1].id]: "#445566" } };
  assert.deepEqual(collectPresentOwnerTags(map), new Set(["AA", "BB"]));
});
