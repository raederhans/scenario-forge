import assert from "node:assert/strict";
import test from "node:test";

import { state } from "../js/core/state.js";
import { commitFeaturePaint } from "../js/core/feature_paint_commands.js";
import { redoHistory, undoHistory } from "../js/core/history_manager.js";
import { createReadonlyReferenceAssignments } from "../js/core/map_data_boundary.js";
import { createDefaultRiverPaintState } from "../js/core/river_paint/partition_model.js";
import { applyRiverCellPaintState } from "../js/core/state/actions/river_paint_actions.js";
import { subscribeChanges } from "../js/core/state/changes.js";
import { makeFixture } from "./helpers/river_paint_fixture.mjs";

function prepare(t, visualOverrides = {}) {
  const initial = {
    visualOverrides: { ...visualOverrides },
    riverPaint: createDefaultRiverPaintState(),
    historyPast: [], historyFuture: [], historyMax: 80,
    isDirty: false, dirtyRevision: 0, lastDirtyReason: "",
    activeScenarioId: "paint-test", scenarioBaselineHash: "paint-baseline", landIndex: new Map(),
    sovereignBaseColors: { BASE: "#aabbcc" }, countryPalette: { BASE: "#aabbcc" },
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments({ a: "BASE", b: "BASE", c: "OTHER", untouched: "OTHER" }),
    sovereigntyByFeatureId: { a: "BASE", b: "BASE", untouched: "OTHER" },
    waterRegionOverrides: {}, specialRegionOverrides: {}, recentColors: ["#fedcba"],
  };
  const saved = Object.fromEntries(Object.keys(initial).map((key) => [key, state[key]]));
  Object.assign(state, initial);
  const effects = [];
  const unsubscribe = subscribeChanges(({ domains }) => effects.push(...domains));
  t.after(() => {
    unsubscribe();
    Object.assign(state, saved);
  });
  const refresh = () => effects.push("refresh");
  return { effects, options: { kind: "feature-paint", refresh } };
}

test("same-color parent paint records a river-only change and undo restores its child override", async (t) => {
  const h = prepare(t);
  const fixture = await makeFixture();
  const parentId = fixture.parent.id, cellId = fixture.cells[0].id;
  Object.assign(state, {
    activeScenarioId: fixture.state.activeScenarioId,
    scenarioBaselineHash: fixture.state.scenarioBaselineHash,
    landIndex: fixture.state.landIndex, riverPaint: fixture.state.riverPaint,
    visualOverrides: { [parentId]: "#ff0000", untouched: "#654321" },
  });
  assert.equal(applyRiverCellPaintState(state, cellId, "#0000ff").changed, true);
  const result = commitFeaturePaint([{ ids: [parentId], color: "#ff0000" }], h.options);

  assert.deepEqual(result, { featureIds: [parentId], changed: 0 });
  assert.deepEqual(state.riverPaint.overrides, {});
  assert.equal(state.dirtyRevision, 1);
  assert.equal(state.historyPast.length, 1);
  const entry = state.historyPast[0];
  assert.deepEqual(entry.before.visualOverrides, entry.after.visualOverrides);
  assert.equal(entry.before.riverPaintOverrides[cellId], "#0000ff");
  assert.equal(entry.after.riverPaintOverrides[cellId], null);
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.riverPaint.overrides, { [cellId]: "#0000ff" });
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.riverPaint.overrides, {});
  assert.deepEqual(state.visualOverrides, { [parentId]: "#ff0000", untouched: "#654321" });
  assert.equal(state.riverPaint.pack, fixture.pack);
});

test("an overwritten invalid color is ignored while an invalid final batch has no effects", (t) => {
  const h = prepare(t, { a: "#112233", untouched: "#778899" });
  const result = commitFeaturePaint([
    { ids: ["a"], color: "invalid" }, { ids: ["b", "a"], color: "#ABC" },
  ], h.options);
  assert.deepEqual(result, { featureIds: ["a", "b"], changed: 2 });
  assert.deepEqual(state.visualOverrides, { a: "#aabbcc", b: "#aabbcc", untouched: "#778899" });
  const beforeInvalid = { ...state.visualOverrides };
  const entry = state.historyPast[0];
  h.effects.length = 0;
  assert.throws(() => commitFeaturePaint([{ ids: ["a", "b"], color: "invalid" }], h.options), TypeError);
  assert.deepEqual(state.visualOverrides, beforeInvalid);
  assert.deepEqual(h.effects, []);
  assert.equal(state.dirtyRevision, 1);
  assert.deepEqual(state.historyPast, [entry]);
});
