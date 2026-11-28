import assert from "node:assert/strict";
import test from "node:test";
import { isPendingScenarioChunkPromotionCurrent as isCurrent } from "../js/core/scenario/chunk_promotion_queries.js";

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

test("promotion query rejects an old scenario or request", () => {
  for (const change of [{ activeScenarioId: "beta" }, { currentScenarioApplyRequestId: 9 }]) {

    const input = fixture();
    assert.equal(isCurrent(Object.freeze({ ...input, ...change })), false);
  }
});
