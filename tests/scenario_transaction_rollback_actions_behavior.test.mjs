import assert from "node:assert/strict";
import test from "node:test";
import { captureScenarioTransactionRollbackSupplementalState } from "../js/core/state/actions/scenario_transaction_rollback_actions.js";
import { captureScenarioReadinessState, restoreScenarioReadinessState } from "../js/core/state/actions/scenario_readiness_actions.js";
import { setDefaultRuntimePoliticalTopologyState } from "../js/core/state/actions/scenario_chunk_promotion_actions.js";
import { cloneScenarioStateValue } from "../js/core/scenario/shared.js";

test("supplemental capture and restore detach nested topology data", () => {
  const target = {
    defaultRuntimePoliticalTopology: {
      capturedAt: new Date("2026-07-20T12:00:00.000Z"),
      topologyById: new Map([["main", { version: 1 }]]),
    },
  };
  const captured = captureScenarioTransactionRollbackSupplementalState(target, { cloneValue: cloneScenarioStateValue });
  assert.deepEqual(captured.values.defaultRuntimePoliticalTopology, {
    capturedAt: new Date("2026-07-20T12:00:00.000Z"),
    topologyById: new Map([["main", { version: 1 }]]),
  });
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology,
    target.defaultRuntimePoliticalTopology,
  );
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology.capturedAt,
    target.defaultRuntimePoliticalTopology.capturedAt,
  );
  assert.notEqual(
    captured.values.defaultRuntimePoliticalTopology.topologyById,
    target.defaultRuntimePoliticalTopology.topologyById,
  );
  setDefaultRuntimePoliticalTopologyState(target, captured.values.defaultRuntimePoliticalTopology);
  assert.equal(target.defaultRuntimePoliticalTopology, captured.values.defaultRuntimePoliticalTopology);
});

test("readiness restore deletes a key absent at capture", () => {
  const target = { detailDeferred: false };
  const snapshot = captureScenarioReadinessState(target);
  target.topologyDetail = { id: "stale" };
  restoreScenarioReadinessState(target, snapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(target, "topologyDetail"), false);
});
