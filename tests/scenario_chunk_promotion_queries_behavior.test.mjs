import assert from "node:assert/strict";
import test from "node:test";
import { getScenarioChunkActiveMergeIds, isPendingScenarioChunkPromotionCurrent as isCurrent } from "../js/core/scenario/chunk_promotion_queries.js";

test("active merge IDs preserve loaded order, duplicates and protected detail without mutating inputs", () => {
  const loadedChunkIds = Object.freeze([" b ", "warm", " protected ", "b", "", null, 0, 4, "4"]);
  const inputs = Object.freeze({ loadedChunkIds,
    cacheOnlyChunkIds: Object.freeze([" warm ", "protected"]),
    retainedActiveChunkIds: Object.freeze(["protected", "not-loaded"]),
  });
  const result = getScenarioChunkActiveMergeIds(inputs);
  assert.deepEqual(result, ["b", "protected", "b", "4", "4"]);
  result.push("independent");
  assert.equal(loadedChunkIds.length, 9);
  assert.deepEqual(getScenarioChunkActiveMergeIds(inputs), ["b", "protected", "b", "4", "4"]);
});

test("active merge IDs skip sparse slots and treat missing or non-array selections as empty", () => {
  const loadedChunkIds = Object.freeze([, " first ", , "second"]);
  assert.deepEqual(getScenarioChunkActiveMergeIds({ loadedChunkIds }), ["first", "second"]);
  assert.deepEqual(getScenarioChunkActiveMergeIds({ loadedChunkIds, cacheOnlyChunkIds: {}, retainedActiveChunkIds: "first" }), ["first", "second"]);
  assert.deepEqual(getScenarioChunkActiveMergeIds({ loadedChunkIds: null }), []);
});

function fixture() {
  const pendingPromotion = Object.freeze({ selectionVersion: 3, scenarioApplyRequestId: 8 });
  const loadState = Object.freeze({ pendingPromotion, selectionVersion: 3, promotionCommitRunId: 2 });
  return Object.freeze({ pendingPromotion, loadState, currentLoadState: loadState,
    scenarioId: "alpha", activeScenarioId: "alpha", runId: 2, promotionCommitRunId: 2,
    currentScenarioApplyRequestId: 8, latestScenarioApplyRequestId: 8, latestScenarioApplyTargetId: "alpha" });
}

test("frozen promotion query preserves identities and accepts exactly current continuation", () => {
  const input = fixture();
  assert.equal(isCurrent(input), true);
  assert.equal(input.loadState.pendingPromotion, input.pendingPromotion);
  assert.equal(input.currentLoadState, input.loadState);
});

for (const [name, change] of [
  ["absent promotion", input => ({ pendingPromotion: null })],
  ["replaced load state", input => ({ currentLoadState: { ...input.loadState } })],
  ["replaced pending promotion", input => ({ pendingPromotion: { ...input.pendingPromotion } })],
  ["local run superseded", input => ({ promotionCommitRunId: 3 })],
  ["load run superseded", input => { const loadState = { ...input.loadState, promotionCommitRunId: 3 }; return { loadState, currentLoadState: loadState }; }],
  ["scenario changed", input => ({ activeScenarioId: "beta" })],
  ["scenario missing", input => ({ scenarioId: "" })],
  ["selection changed", input => { const loadState = { ...input.loadState, selectionVersion: 4 }; return { loadState, currentLoadState: loadState }; }],
  ["request changed", input => ({ currentScenarioApplyRequestId: 9 })],
  ["new request targets other scenario", input => ({ latestScenarioApplyRequestId: 9, latestScenarioApplyTargetId: "beta" })],
]) {
  test(`promotion query rejects ${name}`, () => {
    const input = fixture();
    assert.equal(isCurrent(Object.freeze({ ...input, ...change(input) })), false);
  });
}

test("legacy unset fences and same-scenario pending request preserve previous acceptance", () => {
  const input = fixture();
  assert.equal(isCurrent({ ...input, runId: 0, promotionCommitRunId: 99 }), true);
  assert.equal(isCurrent({ ...input, currentScenarioApplyRequestId: 0 }), true);
  assert.equal(isCurrent({ ...input, latestScenarioApplyRequestId: 9 }), true);
  assert.equal(isCurrent({ ...input, latestScenarioApplyRequestId: 9, latestScenarioApplyTargetId: "" }), true);
  const pendingPromotion = Object.freeze({ selectionVersion: 0, scenarioApplyRequestId: 0 });
  const loadState = Object.freeze({ ...input.loadState, pendingPromotion: null });
  assert.equal(isCurrent({ ...input, pendingPromotion, loadState, currentLoadState: loadState }), true);
});
