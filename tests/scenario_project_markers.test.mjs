import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildScenarioProjectMarkerEntries } from "../js/core/renderer/scenario_project_markers.js";

const manifest = JSON.parse(readFileSync(new URL("../data/scenarios/tno_1962/manifest.json", import.meta.url)));
const state = { activeScenarioId: "tno_1962", showScenarioAtlantropa: true };
const projection = ([x, y]) => [x * 2, y * 2];
const transform = { k: 3, apply: ([x, y]) => [x * 3 + 10, y * 3 + 20] };
const entries = () => buildScenarioProjectMarkerEntries(manifest, state, projection, transform);

test("project markers follow scenario visibility and screen projection", () => {
  assert.equal(entries().length, 3);
  assert.deepEqual(entries()[1].screenPoint, transform.apply(projection([32.35, 30.60])));
  for (const changes of [{ showScenarioAtlantropa: false }, { activeScenarioId: "hoi4_1936" }]) {
    assert.deepEqual(buildScenarioProjectMarkerEntries(manifest, { ...state, ...changes }, projection, transform), []);
  }
});
