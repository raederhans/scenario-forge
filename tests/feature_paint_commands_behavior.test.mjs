import assert from "node:assert/strict";
import test from "node:test";

import { state } from "../js/core/state.js";
import { commitFeaturePaint } from "../js/core/feature_paint_commands.js";
import { redoHistory, undoHistory } from "../js/core/history_manager.js";
import { createReadonlyReferenceAssignments, getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { createDefaultRiverPaintState } from "../js/core/river_paint/partition_model.js";
import { applyRiverCellPaintState } from "../js/core/state/actions/river_paint_actions.js";
import { subscribeChanges } from "../js/core/state/changes.js";
import { readRegisteredRuntimeHookSource, registerRuntimeHook } from "../js/core/state/index.js";
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
  const previousRefresh = readRegisteredRuntimeHookSource(state, "refreshColorStateFn");
  Object.assign(state, initial);
  const effects = [], refreshes = [], historyRefreshes = [];
  const unsubscribe = subscribeChanges(({ domains }) => effects.push(...domains));
  registerRuntimeHook(state, "refreshColorStateFn", (options) => historyRefreshes.push(options));
  t.after(() => {
    unsubscribe();
    registerRuntimeHook(state, "refreshColorStateFn", previousRefresh);
    Object.assign(state, saved);
  });
  const refresh = (ids) => { refreshes.push([...ids]); effects.push("refresh"); };
  return { effects, refreshes, historyRefreshes, options: { kind: "feature-paint", refresh } };
}

test("overlapping batches use the final color and publish one refresh, dirty change and history entry", (t) => {
  const h = prepare(t, { erase: "#112233", untouched: "#654321" });
  const batches = [
    { ids: [" a ", "b", "a", "", "erase"], color: "#ABC" },
    { ids: ["b", "c"], color: "#123456" },
    { ids: ["erase"], color: null },
  ];
  const originalBatches = structuredClone(batches);
  const result = commitFeaturePaint(batches, { ...h.options, dirtyReason: "territory-paint" });

  assert.deepEqual(result, { featureIds: ["a", "b", "erase", "c"], changed: 4 });
  assert.deepEqual(state.visualOverrides, { untouched: "#654321", a: "#aabbcc", b: "#123456", c: "#123456" });
  assert.deepEqual(h.refreshes, [["a", "b", "erase", "c"]]);
  assert.deepEqual(h.effects, ["refresh", "dirty", "history"]);
  assert.equal(state.isDirty, true);
  assert.equal(state.dirtyRevision, 1);
  assert.equal(state.lastDirtyReason, "territory-paint");
  assert.equal(state.historyPast.length, 1);
  assert.equal(state.historyPast[0].kind, "feature-paint");
  assert.deepEqual(state.historyPast[0].before, { visualOverrides: { a: null, b: null, erase: "#112233", c: null } });
  assert.deepEqual(state.historyPast[0].meta, { affectsSovereignty: false });
  assert.deepEqual(batches, originalBatches);
});

test("fill and erase undo together without changing base colors, reference membership or recent colors", (t) => {
  const original = { a: "#112233", b: "#445566", untouched: "#778899" };
  const h = prepare(t, original);
  const protectedKeys = ["sovereignBaseColors", "countryPalette", "scenarioBaselineOwnersByFeatureId", "sovereigntyByFeatureId", "recentColors"];
  const protectedRefs = Object.fromEntries(protectedKeys.map((key) => [key, state[key]]));
  const protectedValues = structuredClone(protectedRefs);
  const { reference } = getMapDataBoundary(state);
  const assertProtected = () => {
    for (const key of protectedKeys) {
      assert.equal(state[key], protectedRefs[key], key);
      assert.deepEqual(state[key], protectedValues[key], key);
    }
    assert.deepEqual(reference.getScenarioGroupFeatureIds("BASE"), ["a", "b"]);
    assert.equal(reference.getScenarioGroupCode("c"), "OTHER");
  };
  const result = commitFeaturePaint([
    { ids: ["a"], color: null }, { ids: ["b", "c"], color: "#abcdef" },
  ], h.options);
  const painted = { b: "#abcdef", c: "#abcdef", untouched: "#778899" };
  assert.equal(result.changed, 3);
  assert.deepEqual(state.visualOverrides, painted);
  assertProtected();

  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, original);
  assert.equal(state.historyPast.length, 0);
  assert.equal(state.historyFuture.length, 1);
  assertProtected();
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.visualOverrides, painted);
  assert.equal(state.historyPast.length, 1);
  assert.equal(state.historyFuture.length, 0);
  assertProtected();
  assert.deepEqual(h.historyRefreshes, [
    { renderNow: false, featureIds: ["a", "b", "c"], inputLabel: "history-undo" },
    { renderNow: false, featureIds: ["a", "b", "c"], inputLabel: "history-redo" },
  ]);
});

test("unchanged edits preserve redo while only recordUnchanged retains refresh and dirty feedback", (t) => {
  const h = prepare(t, { a: "#112233" });
  commitFeaturePaint([{ ids: ["b"], color: "#445566" }], h.options);
  assert.equal(undoHistory(), true);
  const redoEntry = state.historyFuture[0];
  const revision = state.dirtyRevision;
  h.effects.length = 0;
  h.refreshes.length = 0;

  const batches = [{ ids: ["a"], color: "#112233" }];
  assert.deepEqual(commitFeaturePaint(batches, h.options), { featureIds: ["a"], changed: 0 });
  assert.deepEqual(h.effects, []);
  assert.deepEqual(h.refreshes, []);
  assert.equal(state.dirtyRevision, revision);
  assert.equal(state.historyPast.length, 0);
  assert.equal(state.historyFuture[0], redoEntry);

  assert.deepEqual(commitFeaturePaint(batches, { ...h.options, recordUnchanged: true }), { featureIds: ["a"], changed: 0 });
  assert.deepEqual(h.effects, ["refresh", "dirty"]);
  assert.deepEqual(h.refreshes, [["a"]]);
  assert.equal(state.dirtyRevision, revision + 1);
  assert.equal(state.historyPast.length, 0);
  assert.equal(state.historyFuture[0], redoEntry);
  assert.deepEqual(commitFeaturePaint([{ ids: ["", " "], color: "invalid" }], {
    ...h.options, recordUnchanged: true,
  }), { featureIds: [], changed: 0 });
  assert.deepEqual(h.effects, ["refresh", "dirty"]);
  assert.equal(state.dirtyRevision, revision + 1);
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.visualOverrides, { a: "#112233", b: "#445566" });
});

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
  assert.deepEqual(h.effects, ["refresh", "dirty", "history"]);
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
  assert.deepEqual(h.historyRefreshes.map(({ featureIds }) => featureIds), [[parentId], [parentId]]);
});

test("quick-fill metadata coalesces the exact leading click into one complete undo and redo", (t) => {
  const original = { a: "#112233", b: "#445566", untouched: "#778899" };
  const h = prepare(t, original);
  const color = "#AA7733";
  const leaf = { type: "leaf-click", featureId: "a", timeStamp: 100, color, scenarioId: state.activeScenarioId };
  const batch = { ...leaf, type: "double-click", timeStamp: 14000, leadingClickTimeStamp: leaf.timeStamp };
  commitFeaturePaint([{ ids: ["a"], color }], { ...h.options, kind: "fill-feature-color", gesture: leaf });
  assert.equal(state.historyPast.length, 1);
  commitFeaturePaint([{ ids: ["a", "b"], color }], { ...h.options, kind: "fill-parent-group", gesture: batch });

  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(state.historyPast[0].meta, { affectsSovereignty: false, quickFillGesture: batch });
  assert.deepEqual(state.historyPast[0].before, { visualOverrides: { a: original.a, b: original.b } });
  assert.deepEqual(state.historyPast[0].after, { visualOverrides: { a: "#aa7733", b: "#aa7733" } });
  assert.equal(undoHistory(), true);
  assert.deepEqual(state.visualOverrides, original);
  assert.equal(state.historyPast.length, 0);
  assert.equal(redoHistory(), true);
  assert.deepEqual(state.visualOverrides, { a: "#aa7733", b: "#aa7733", untouched: original.untouched });
  assert.equal(state.historyPast.length, 1);
});

test("an overwritten invalid color is ignored while an invalid final batch has no effects", (t) => {
  const h = prepare(t, { a: "#112233", untouched: "#778899" });
  const result = commitFeaturePaint([
    { ids: ["a"], color: "invalid" }, { ids: ["b", "a"], color: "#ABC" },
  ], h.options);
  assert.deepEqual(result, { featureIds: ["a", "b"], changed: 2 });
  assert.deepEqual(state.visualOverrides, { a: "#aabbcc", b: "#aabbcc", untouched: "#778899" });
  assert.deepEqual(h.effects, ["refresh", "dirty", "history"]);
  const beforeInvalid = { ...state.visualOverrides };
  const entry = state.historyPast[0];
  h.effects.length = 0;
  assert.throws(() => commitFeaturePaint([{ ids: ["a", "b"], color: "invalid" }], h.options), TypeError);
  assert.deepEqual(state.visualOverrides, beforeInvalid);
  assert.deepEqual(h.effects, []);
  assert.equal(state.dirtyRevision, 1);
  assert.deepEqual(state.historyPast, [entry]);
});
