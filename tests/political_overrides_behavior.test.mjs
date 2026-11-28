import assert from "node:assert/strict";
import test from "node:test";
import { state, registerRuntimeHook } from "../js/core/state.js";

import { collectPresentOwnerTags } from "../js/core/legend_manager.js";
import { refreshColorState } from "../js/core/map_renderer/public.js";
import { getPoliticalIdentity } from "../js/core/political_overrides.js";
import { resetCountryPolitical, setCountryAlliance, setCountryIdeology } from "../js/core/political_override_commands.js";
import { resolvePoliticalDisplayColor } from "../js/core/political_display_mode.js";

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

test("political identity inherits the parent ideology", () => {
  setup();
  assert.deepEqual(getPoliticalIdentity(state, "dd"), {
    alliance: null, ideology: "democratic", allianceSource: "none", ideologySource: "inherited",
  });
  state.politicalDisplayMode = "government";
  assert.equal(resolvePoliticalDisplayColor(state, "DD"), "#3b6fb6");
});

test("an explicit alliance override takes priority over the scenario alliance", () => {
  setup();
  assert.ok(setCountryIdeology("AA", "communism"));
  state.politicalDisplayMode = "alliance";
  assert.ok(setCountryAlliance("AA", null));
  assert.equal(state.colors.land, "#db9d92");
  assert.ok(resetCountryPolitical("AA", "alliance"));
  assert.equal(state.colors.land, "#1f4e9c");
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
