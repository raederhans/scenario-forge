import test from "node:test";
import assert from "node:assert/strict";
import { findNearCountryColor } from "../js/core/near_country_color_hint.js";

const scenario = {
  activeScenarioId: "scene",
  scenarioCountriesByTag: { A: {}, GER: {} },
  sovereignBaseColors: { DE: "#aaaaab", A: "#aaaaac", GER: "#aaaaaa" },
};

test("an exact RGB match takes precedence over near matches and ignores ISO aliases", () => {
  const match = findNearCountryColor(scenario, "#AAA");
  assert.deepEqual(match, { code: "GER", color: "#aaaaaa", exact: true });
});

test("distant colors have no match", () => {
  assert.equal(findNearCountryColor(scenario, "#0000ff"), null);
});
