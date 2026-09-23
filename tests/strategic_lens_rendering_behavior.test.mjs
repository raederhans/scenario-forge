import assert from "node:assert/strict";
import test from "node:test";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { getStrategicFeatureInspection } from "../js/core/strategic_values_view_model.js";

function fixture() {
  return {
    activeScenarioId: "hoi4_1936", strategicChoroplethMetric: "steel",
    styleConfig: { strategicValues: { opacity: 1, palette: "blue" } },
    visualOverrides: { a: "#112233" },
    scenarioStrategicValuesData: {
      scenarioId: "hoi4_1936", baselineHash: "baseline",
      metrics: { steel: { min: 0, max: 10, p95: 10 } },
      buckets: { s1: { steel: 10 } }, bucketByFeature: { a: "s1" },
      resourcePoints: { type: "FeatureCollection", features: [] },
      diagnostics: { errors: [] },
    },
  };
}
test("strategic palette and opacity affect resolved colors and zero restores base", () => {
  const state = fixture();
  const color = () => resolveFeatureColor("a", { state }).color;
  assert.equal(color(), "#0369a1");
  state.styleConfig.strategicValues.palette = "rose";
  assert.equal(color(), "#be123c");
  state.styleConfig.strategicValues.opacity = 0.5;
  assert.equal(color(), "#681a38");
  state.styleConfig.strategicValues.opacity = 0;
  assert.equal(color(), "#112233");
});
test("missing values and foreign scenario data cannot paint a zero-value lens", () => {
  const state = fixture();
  for (const value of [null, undefined, "", "invalid"]) {
    state.scenarioStrategicValuesData.buckets.s1.steel = value;
    assert.equal(resolveFeatureColor("a", { state }).source, "visualOverrides");
  }
  state.scenarioStrategicValuesData.buckets.s1.steel = 0;
  assert.equal(resolveFeatureColor("a", { state }).source, "strategic:steel");
  state.scenarioStrategicValuesData.scenarioId = "hoi4_1939";
  assert.equal(resolveFeatureColor("a", { state }).source, "visualOverrides");
});
test("hover lookup distinguishes zero, absent metric and unmapped features", () => {
  const state = fixture();
  state.scenarioStrategicValuesData.buckets.s1.steel = 0;
  assert.equal(getStrategicFeatureInspection(state, "a").value, 0);
  assert.equal(getStrategicFeatureInspection(state, "a").hasValue, true);
  delete state.scenarioStrategicValuesData.buckets.s1.steel;
  assert.equal(getStrategicFeatureInspection(state, "a").hasValue, false);
  assert.equal(getStrategicFeatureInspection(state, "b").mapped, false);
  state.activeScenarioId = "tno_1962";
  assert.equal(getStrategicFeatureInspection(state, "a"), null);
});
