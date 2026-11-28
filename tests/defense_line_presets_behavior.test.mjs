import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioDefenseLineEntries } from "../js/core/scenario/defense_line_presets.js";

const line = { id: "maginot", label_en: "Maginot Line", label_zh: "马其诺防线", points: [[5.601, 49.448], [5.761, 49.52]] };
const payload = { version: 1, scenarios: { hoi4_1936: [line] } };

test("builds ordinary defensive lines with independent coordinates", () => {
  const entries = buildScenarioDefenseLineEntries(payload, "hoi4_1936", [], { language: "en" });
  assert.deepEqual(entries, [{
    id: "preset_hoi4_1936_maginot", kind: "defensive_line", stylePreset: "defensive_line",
    label: "Maginot Line", points: line.points, stroke: null, width: 0, opacity: 1, attachedCounterIds: [],
  }]);
  entries[0].points[0][0] = 100;
  assert.equal(line.points[0][0], 5.601);
});

test("skips existing ids", () => {
  assert.deepEqual(buildScenarioDefenseLineEntries(payload, "hoi4_1936", [{ id: "preset_hoi4_1936_maginot" }]), []);
});
