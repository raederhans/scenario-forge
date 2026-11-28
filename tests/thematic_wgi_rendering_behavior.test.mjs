import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { loadThematicWgiData } from "../js/core/thematic/thematic_wgi_data.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { normalizeThematicWgiStyle, getThematicWgiColor, getThematicWgiFeatureInspection } from "../js/core/thematic/thematic_wgi_view_model.js";

const fetchJson = async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const data = await loadThematicWgiData({ fetchJson });

function fixture() {
  return { activeScenarioId: "modern_world", currentLanguage: "en", width: 1000,
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) },
    thematicWgiRuntime: { status: "ready", data, revision: 1 },
    visualOverrides: { sample: "#123456" }, sovereignBaseColors: { US: "#abcdef" } };
}
const feature = (code, id = "sample") => ({ id, properties: { ISO_A2: code } });

test("historical colors follow the geographic reference of the baseline owner", () => {
  const state = { ...fixture(), activeScenarioId: "hoi4_1939",
    scenarioBaselineOwnersByFeatureId: { sample: "GER" },
    scenarioCountriesByTag: { GER: { base_iso2: "DE" } } };
  const observation = getThematicWgiFeatureInspection(state, feature("PL"));
  assert.equal(observation.joinKey, "DEU");
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("PL") }).color,
    getThematicWgiColor(data.byIsoA3.DEU));
});

test("thematic coloring preserves manual edits", () => {
  const state = fixture();
  const original = structuredClone(state.visualOverrides);
  resolveFeatureColor("sample", { state, feature: feature("US") });
  assert.deepEqual(state.visualOverrides, original);
  state.styleConfig.thematic.enabled = false;
  assert.equal(resolveFeatureColor("sample", { state, feature: feature("US") }).color, "#123456");
});

test("missing, unmatched and valid zero keep different colors and inspector states", () => {
  const state = fixture();
  const missing = feature("NC"), unmatched = feature("AQ");
  assert.equal(getThematicWgiFeatureInspection(state, missing).status, "missing");
  assert.equal(getThematicWgiFeatureInspection(state, unmatched).status, "unmatched");
  const colors = [missing, unmatched, feature("SO")].map((f) => resolveFeatureColor("sample", { state, feature: f }).color);
  assert.equal(new Set(colors).size, 3);
});
