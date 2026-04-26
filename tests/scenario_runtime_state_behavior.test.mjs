import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultScenarioRuntimeState,
} from "../js/core/state/scenario_runtime_state.js";
import {
  applyZoomEndChunkProtectionToSelection,
  protectZoomEndChunksForSelection,
} from "../js/core/scenario/chunk_runtime.js";

test("scenario runtime factory seeds scenario-aware defaults", () => {
  const defaults = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });

  assert.equal(defaults.activeScenarioId, "tno_1962");
  assert.equal(defaults.activeScenarioChunks.scenarioId, "tno_1962");
  assert.equal(defaults.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(defaults.runtimeChunkLoadState.registryStatus, "ready");
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitStatus, "idle");
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitInFlight, false);
  assert.equal(defaults.runtimeChunkLoadState.promotionCommitRunId, 0);
  assert.deepEqual(defaults.runtimeChunkLoadState.zoomEndProtectedChunkIds, []);
  assert.equal(defaults.runtimeChunkLoadState.zoomEndProtectedUntil, 0);
  assert.equal(defaults.runtimeChunkLoadState.zoomEndProtectedSelectionVersion, 0);
  assert.equal(defaults.runtimeChunkLoadState.zoomEndProtectedScenarioId, "");
  assert.equal(defaults.runtimeChunkLoadState.zoomEndProtectedFocusCountry, "");
  assert.doesNotThrow(() => JSON.stringify(defaults.runtimeChunkLoadState));
});

test("scenario runtime factory returns fresh nested objects and maps", () => {
  const first = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });
  const second = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" });

  first.activeScenarioChunks.loadedChunkIds.push("owners");
  first.activeScenarioChunks.mergedLayerPayloads.owners = null;
  first.runtimeChunkLoadState.inFlightByChunkId.owners = true;
  first.runtimeChunkLoadState.zoomEndProtectedChunkIds.push("political.detail.country.cd");
  first.scenarioDistrictGroupByFeatureId.set("1", "district-a");
  first.scenarioHydrationHealthGate.status = "blocked";

  assert.deepEqual(second.activeScenarioChunks.loadedChunkIds, []);
  assert.deepEqual(second.activeScenarioChunks.mergedLayerPayloads, {});
  assert.deepEqual(second.runtimeChunkLoadState.inFlightByChunkId, {});
  assert.deepEqual(second.runtimeChunkLoadState.zoomEndProtectedChunkIds, []);
  assert.equal(second.scenarioDistrictGroupByFeatureId.size, 0);
  assert.equal(second.scenarioHydrationHealthGate.status, "idle");
});

test("zoom-end detail chunk protection is one-shot and selection scoped", () => {
  const loadState = createDefaultScenarioRuntimeState({ scenarioId: "tno_1962" }).runtimeChunkLoadState;
  const normalizeScenarioIdFn = (value) => String(value || "").trim();

  protectZoomEndChunksForSelection(
    loadState,
    ["political.detail.country.cd", "political.detail.country.cd", "context.detail.water"],
    {
      scenarioId: "tno_1962",
      selectionVersion: 7,
      focusCountry: "cd",
      normalizeScenarioIdFn,
      nowMs: 1000,
    },
  );

  assert.deepEqual(loadState.zoomEndProtectedChunkIds, ["political.detail.country.cd"]);
  assert.equal(loadState.zoomEndProtectedUntil, 6000);
  assert.equal(loadState.zoomEndProtectedSelectionVersion, 7);
  assert.equal(loadState.zoomEndProtectedFocusCountry, "CD");

  const protectedSelection = {
    evictableChunkIds: ["political.detail.country.cd", "political.detail.country.mx"],
  };
  assert.equal(applyZoomEndChunkProtectionToSelection(protectedSelection, loadState, {
    scenarioId: "tno_1962",
    selectionVersion: 7,
    focusCountry: "CD",
    normalizeScenarioIdFn,
    nowMs: 1200,
  }), true);
  assert.deepEqual(protectedSelection.evictableChunkIds, ["political.detail.country.mx"]);
  assert.deepEqual(loadState.zoomEndProtectedChunkIds, []);

  protectZoomEndChunksForSelection(loadState, ["political.detail.country.cd"], {
    scenarioId: "tno_1962",
    selectionVersion: 8,
    focusCountry: "CD",
    normalizeScenarioIdFn,
    nowMs: 2000,
  });
  const changedSelection = { evictableChunkIds: ["political.detail.country.cd"] };
  assert.equal(applyZoomEndChunkProtectionToSelection(changedSelection, loadState, {
    scenarioId: "tno_1962",
    selectionVersion: 9,
    focusCountry: "CD",
    normalizeScenarioIdFn,
    nowMs: 2200,
  }), false);
  assert.deepEqual(changedSelection.evictableChunkIds, ["political.detail.country.cd"]);
  assert.deepEqual(loadState.zoomEndProtectedChunkIds, []);

  protectZoomEndChunksForSelection(loadState, ["political.detail.country.cd"], {
    scenarioId: "tno_1962",
    selectionVersion: 10,
    focusCountry: "CD",
    normalizeScenarioIdFn,
    nowMs: 3000,
  });
  const expiredSelection = { evictableChunkIds: ["political.detail.country.cd"] };
  assert.equal(applyZoomEndChunkProtectionToSelection(expiredSelection, loadState, {
    scenarioId: "tno_1962",
    selectionVersion: 10,
    focusCountry: "CD",
    normalizeScenarioIdFn,
    nowMs: 9001,
  }), false);
  assert.deepEqual(expiredSelection.evictableChunkIds, ["political.detail.country.cd"]);
  assert.deepEqual(loadState.zoomEndProtectedChunkIds, []);
});
