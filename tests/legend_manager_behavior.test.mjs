import assert from "node:assert/strict";
import test from "node:test";
import { LegendManager } from "../js/core/legend_manager.js";
import { FileManager } from "../js/core/file_manager.js";
import { createDefaultColorState } from "../js/core/state/color_state.js";

test("projects without a saved mode default to direct area and explicit modes survive import", () => {
  assert.equal(LegendManager.getDefaultConfig().mode, "direct-area");
  assert.equal(FileManager.normalizeImportedProjectData({}).legendConfig.mode, "direct-area");
  for (const mode of ["weighted-random", "realm-area", "continent-area", "direct-area"]) {
    assert.equal(FileManager.normalizeImportedProjectData({ legendConfig: { mode } }).legendConfig.mode, mode);
  }
});

test("a new project starts in direct area mode", () => {
  assert.equal(LegendManager.getConfig(createDefaultColorState()).mode, "direct-area");
});

test("annexed land counts towards its paint owner and a shared color takes one ranked slot", () => {
  const shared = "#224466";
  const custom = "#abcdef";
  const owners = { a: "AAA", b: "BBB", c: "CCC", d: "CCC", e: "CCC", f: "CCC" };
  const state = {
    activeScenarioId: "legend-test",
    scenarioBaselineOwnersByFeatureId: owners,
    landData: { features: Object.keys(owners).map(id => ({ id, properties: { id } })) },
    scenarioCountriesByTag: {
      AAA: { display_name_en: "Alpha" }, BBB: { display_name_en: "Beta" }, CCC: { display_name_en: "Gamma" },
    },
    sovereignBaseColors: { A: shared, AAA: shared, BBB: shared, CCC: "#334455" },
    visualOverrides: { c: shared, d: shared, f: custom },
  };
  const result = LegendManager.generate(state, { maxItems: 3 });
  assert.deepEqual(result.entries.map(({ code, featureCount, color, label }) => [code, featureCount, color, label]), [
    ["AAA", 3, shared, "Alpha"], ["CCC", 1, "#334455", "Gamma"], ["color:" + custom, 1, custom, ""],
  ]);
  LegendManager.applyGeneratedLegend(state, result);
  assert.deepEqual(state.legendColorOrder, [shared, "#334455", custom]);
  assert.deepEqual(state.legendLabels, { [shared]: "Alpha", "#334455": "Gamma" });
});
