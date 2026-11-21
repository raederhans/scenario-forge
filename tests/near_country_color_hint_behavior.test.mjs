import test from "node:test";
import assert from "node:assert/strict";
import { findNearCountryColor, getCountryColorHintText } from "../js/core/near_country_color_hint.js";
import { state } from "../js/core/state.js";

const scenario = {
  activeScenarioId: "scene",
  scenarioCountriesByTag: { A: {}, GER: { display_name_zh: "德国", display_name_en: "Germany" } },
  sovereignBaseColors: { DE: "#aaaaab", A: "#aaaaac", GER: "#aaaaaa" },
};

test("an exact RGB match takes precedence over near matches and ignores ISO aliases", () => {
  const match = findNearCountryColor(scenario, "#AAA");
  assert.deepEqual(match, { code: "GER", color: "#aaaaaa", exact: true });
  state.currentLanguage = "zh";
  assert.deepEqual(getCountryColorHintText(scenario, match), { message: "将并入德国", actionLabel: "" });
});

test("a near match offers the other country's exact color while editing a country", () => {
  const match = findNearCountryColor(scenario, "#aaaaac", "A");
  assert.deepEqual(match, { code: "GER", color: "#aaaaaa", exact: false });
  state.currentLanguage = "zh";
  assert.deepEqual(getCountryColorHintText(scenario, match), {
    message: "接近德国颜色，涂上会形成国界", actionLabel: "改用德国颜色",
  });
  state.currentLanguage = "en";
  assert.equal(getCountryColorHintText(scenario, match).actionLabel, "Use Germany's color");
});

test("distant colors and colors picked outside a scenario have no hint", () => {
  assert.equal(findNearCountryColor(scenario, "#0000ff"), null);
  assert.equal(findNearCountryColor({ ...scenario, activeScenarioId: "" }, "#aaaaaa"), null);
});
