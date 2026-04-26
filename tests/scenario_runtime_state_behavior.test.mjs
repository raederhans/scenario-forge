import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultScenarioRuntimeState,
} from "../js/core/state/scenario_runtime_state.js";

test("scenario runtime factory seeds scenario-aware defaults", () => {
  const defaults = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });

  assert.equal(defaults.activeScenarioId, "tno_1962");
  assert.equal(defaults.activeScenarioChunks.scenarioId, "tno_1962");
  assert.equal(defaults.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(defaults.runtimeChunkLoadState.registryStatus, "ready");
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitStatus, "idle");
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitInFlight, false);
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitRunId, 0);
  assert.doesNotThrow(() => JSON.stringify(defaults.runtimeChunkLoadState));
});

test("scenario runtime factory returns fresh nested objects and maps", () => {
  const first = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });
  const second = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });

  first.activeScenarioChunks.loadedChunkIds.push("owners");
  first.activeScenarioChunks.mergedLayerPayloads.owners = null;
  first.runtimeChunkLoadState.inFlightByChunkId.owners = true;
  first.scenarioDistrictGroupByFeatureId.set("1", "district-a");
  first.scenarioHydrationHealthGate.status = "blocked";

  assert.deepEqual(second.activeScenarioChunks.loadedChunkIds, []);
  assert.deepEqual(second.activeScenarioChunks.mergedLayerPayloads, {});
  assert.deepEqual(second.runtimeChunkLoadState.inFlightByChunkId, {});
  assert.equal(second.scenarioDistrictGroupByFeatureId.size, 0);
  assert.equal(second.scenarioHydrationHealthGate.status, "idle");
});
