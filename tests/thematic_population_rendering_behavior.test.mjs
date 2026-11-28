import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { THEMATIC_POPULATION_METRICS } from "../js/core/thematic/thematic_population_data.js";
import { getThematicIndicator, loadThematicIndicatorData } from "../js/core/thematic/thematic_indicator_catalog.js";
import { normalizeThematicWgiStyle, getThematicWgiColor, getThematicWgiFeatureInspection } from "../js/core/thematic/thematic_wgi_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";

const fetchJson = async (path) => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
};
const dataByMetric = new Map(await Promise.all(THEMATIC_POPULATION_METRICS.map(async ({ id }) => [id,
  await loadThematicIndicatorData({ metricId: id, fetchJson })])));

const THRESHOLDS = {
  wdi_population_total: [1e6, 1e7, 5e7, 1e8],
  wdi_population_density: [25, 100, 250, 1000],
  wdi_urban_population_share: [20, 40, 60, 80],
  wdi_population_65_plus_share: [5, 10, 15, 20],
  wdi_total_fertility_rate: [1.5, 2.1, 3, 5],
};
function fixture(metricId = "wdi_population_total", scenarioId = "modern_world") {
  return { activeScenarioId: scenarioId, currentLanguage: "en", width: 1000,
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId }) },
    thematicWgiRuntime: { status: "ready", data: dataByMetric.get(metricId), revision: 1 },
    visualOverrides: { sample: "#123456" },
    scenarioBaselineOwnersByFeatureId: { sample: "GER" }, scenarioCountriesByTag: { GER: { base_iso2: "DE" } } };
}
const feature = { id: "sample", properties: { ISO_A2: "AT" } };

test("population uses five fixed raw-value bins with exact boundaries", () => {
  for (const { id } of THEMATIC_POPULATION_METRICS) {
    const metric = getThematicIndicator(id);
    for (const [index, boundary] of THRESHOLDS[id].entries()) {
      assert.equal(getThematicWgiColor({ status: "value", value: boundary - 0.001, normalizedValue: 0, metricId: id }), metric.colors[index]);
      assert.equal(getThematicWgiColor({ status: "value", value: boundary, normalizedValue: 0, metricId: id }), metric.colors[index + 1]);
    }
  }
});

test("population zero and source gaps use distinct colors", () => {
  for (const { id } of THEMATIC_POPULATION_METRICS) {
    const metric = getThematicIndicator(id);
    for (const value of [0, null]) {
      const state = fixture(id);
      const data = state.thematicWgiRuntime.data;
      state.thematicWgiRuntime.data = { ...data, byIsoA3: { ...data.byIsoA3,
        AUT: { ...data.byIsoA3.AUT, value, normalizedValue: value,
          status: value === null ? "missing" : "value", sourceStatus: value === null ? "source_gap" : "observed" },
      } };
      const observation = getThematicWgiFeatureInspection(state, feature);
      assert.equal(observation.value, value);
      assert.equal(resolveFeatureColor("sample", { state, feature }).color, getThematicWgiColor(observation));
      if (value === null) {
        assert.notEqual(getThematicWgiColor(observation), metric.colors[0]);
      } else {
        assert.equal(getThematicWgiColor(observation), metric.colors[0]);
      }
    }
  }
});

test("special surfaces are excluded from population values", () => {
  const state = fixture("wdi_population_total", "tno_1962");
  for (const properties of [{ water_type: "sea" }, { special_type: "zone" }, { atl_color_rule: "land" }]) {
    assert.equal(getThematicWgiFeatureInspection(state, { ...feature, properties }), null);
  }
});
