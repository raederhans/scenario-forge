import test from "node:test";
import assert from "node:assert/strict";
import { normalizePoliticalDisplayMode, isPoliticalDisplayModeSupported, resolvePoliticalDisplayColor, getPoliticalDisplayModeSignature, getPoliticalDisplayLegend, NO_DATA_COLOR } from "../js/core/political_display_mode.js";
import { setPoliticalDisplayModeState } from "../js/core/state/actions/political_display_mode_actions.js";

const fixture = () => ({ activeScenarioId: "hoi4_1939", politicalDisplayMode: "country", currentLanguage: "zh",
  scenarioBundleCacheById: { hoi4_1939: { countriesPayload: { countries: {
    GER: { ruling_ideology: "fascism", alliance: "axis" }, ENG: { ruling_ideology: "democratic", alliance: "allies" },
    SOV: { ruling_ideology: "communism" }, NEU: { ruling_ideology: "neutrality" },
    EMPTY: {}, OTHER: { ruling_ideology: "unknown", alliance: "unknown" },
  }, alliances: { axis: { name_zh: "轴心国", name_en: "Axis", member_count: 1 }, allies: { name_zh: "同盟国", name_en: "Allies", member_count: 1 } } } } } });

test("country default, support and action only change runtime mode", () => {
  const state = fixture();
  assert.equal(normalizePoliticalDisplayMode("bad"), "country");
  assert.equal(isPoliticalDisplayModeSupported(state), true);
  assert.equal(resolvePoliticalDisplayColor(state, "GER"), null);
  assert.equal(getPoliticalDisplayLegend(state), null);
  const before = structuredClone(state);
  setPoliticalDisplayModeState(state, "alliance");
  assert.deepEqual(state, { ...before, politicalDisplayMode: "alliance" });
  state.activeScenarioId = "blank_base";
  assert.equal(isPoliticalDisplayModeSupported(state), false);
  assert.equal(resolvePoliticalDisplayColor(state, "GER"), null);
});

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
  const state = { activeScenarioId: "tno_1962", politicalDisplayMode: "government", scenarioBundleCacheById: { tno_1962: { countriesPayload: { countries: Object.fromEntries(Object.keys(colors).map((id) => [id, { ruling_ideology: id }])) } } } };
  for (const [id, color] of Object.entries(colors)) assert.equal(resolvePoliticalDisplayColor(state, id), color);
  assert.equal(getPoliticalDisplayLegend(state).entries.length, 12);
});

test("signature tracks mode, scenario and payload identity and suspends during apply", () => {
  const state = fixture();
  assert.equal(getPoliticalDisplayModeSignature(state), "");
  state.politicalDisplayMode = "alliance";
  const first = getPoliticalDisplayModeSignature(state);
  state.politicalDisplayMode = "government";
  const second = getPoliticalDisplayModeSignature(state);
  assert.notEqual(first, second);
  state.scenarioBundleCacheById.tno_1962 = state.scenarioBundleCacheById.hoi4_1939;
  state.activeScenarioId = "tno_1962";
  const third = getPoliticalDisplayModeSignature(state);
  assert.notEqual(second, third);
  state.scenarioBundleCacheById.tno_1962.countriesPayload = structuredClone(state.scenarioBundleCacheById.tno_1962.countriesPayload);
  assert.notEqual(third, getPoliticalDisplayModeSignature(state));
  state.scenarioApplyInFlight = true;
  assert.equal(getPoliticalDisplayModeSignature(state), "");
  assert.equal(resolvePoliticalDisplayColor(state, "GER"), null);
});

test("legend lists only present categories, member counts, other and no data", () => {
  const state = fixture();
  state.politicalDisplayMode = "alliance";
  let legend = getPoliticalDisplayLegend(state);
  assert.deepEqual(legend.entries.map((entry) => entry.label), ["轴心国（1 国）", "同盟国（1 国）", "unknown（1 国）", "无数据"]);
  assert.equal(legend.note, "未结盟国家按政体浅色显示");
  state.currentLanguage = "en";
  assert.equal(getPoliticalDisplayLegend(state).entries[0].label, "Axis (1 countries)");
  state.politicalDisplayMode = "government";
  legend = getPoliticalDisplayLegend(state);
  assert.deepEqual(legend.entries.map((entry) => entry.label), ["Fascism", "Democratic", "Communism", "Non-aligned", "Other", "No data"]);
});
