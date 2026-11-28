import test from "node:test";
import assert from "node:assert/strict";
import { resolvePoliticalDisplayColor, NO_DATA_COLOR } from "../js/core/political_display_mode.js";

const fixture = () => ({ activeScenarioId: "hoi4_1939", politicalDisplayMode: "country", currentLanguage: "zh",
  scenarioBundleCacheById: { hoi4_1939: { countriesPayload: { countries: {
    GER: { ruling_ideology: "fascism", alliance: "axis" }, ENG: { ruling_ideology: "democratic", alliance: "allies" },
    SOV: { ruling_ideology: "communism" }, NEU: { ruling_ideology: "neutrality" },
    EMPTY: {}, OTHER: { ruling_ideology: "unknown", alliance: "unknown" },
  }, alliances: { axis: { name_zh: "轴心国", name_en: "Axis", member_count: 10 }, allies: { name_zh: "同盟国", name_en: "Allies", member_count: 10 } } } } } });

test("HOI4 government and alliance colors including unaligned and missing identities", () => {
  const state = fixture();
  state.politicalDisplayMode = "government";
  for (const [tag, color] of Object.entries({ GER: "#7a4a26", ENG: "#3b6fb6", SOV: "#c0392b", NEU: "#8f8a6a", EMPTY: NO_DATA_COLOR, OTHER: "#b9b4a6" })) {
    assert.equal(resolvePoliticalDisplayColor(state, tag), color);
  }
  state.politicalDisplayMode = "alliance";
  for (const [tag, color] of Object.entries({ GER: "#2f2f2f", ENG: "#1f4e9c", SOV: "#db9d92", EMPTY: NO_DATA_COLOR, OTHER: "#7d6b9e" })) {
    assert.equal(resolvePoliticalDisplayColor(state, tag), color);
  }
  for (const tag of ["", "UNKNOWN", "color:#123456"]) assert.equal(resolvePoliticalDisplayColor(state, tag), NO_DATA_COLOR);
});

test("TNO ideologies use their specified palette", () => {
  const colors = { communist: "#a3201c", socialist: "#d9534f", progressivism: "#e8955a", liberalism: "#e3c449", liberal_conservatism: "#86b6d8", conservatism: "#2f6aa3", paternalism: "#6f8f58", despotism: "#8d7b68", fascism: "#7a4a26", national_socialism: "#3b3b3b", ultranationalism: "#5b3324" };
  const countries = Object.fromEntries(Object.keys(colors).map((id, i) => [`T${i}`, { ruling_ideology: id }]));
  const state = { activeScenarioId: "tno_1962", politicalDisplayMode: "government",
    scenarioBundleCacheById: { tno_1962: { countriesPayload: { countries } } } };
  for (const [tag, country] of Object.entries(countries)) {
    assert.equal(resolvePoliticalDisplayColor(state, tag), colors[country.ruling_ideology]);
  }
});
