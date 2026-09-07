import assert from "node:assert/strict";
import test from "node:test";

const RUNTIME_ACTIONS_PATH =
  "../js/core/state/actions/scenario_chunk_runtime_actions.js";
const PROMOTION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_chunk_promotion_actions.js";
const ACTIVATION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_activation_actions.js";
const PRESENTATION_ACTIONS_PATH =
  "../js/core/state/actions/scenario_presentation_actions.js";

const LOAD_STATE_PATCH_KEYS = Object.freeze([
  "shellStatus",
  "registryStatus",
  "refreshScheduled",
  "refreshTimerId",
  "selectionVersion",
  "pendingReason",
  "pendingDelayMs",
  "pendingScenarioApplyRequestId",
  "focusCountryOverride",
  "focusCountryOverrideSource",
  "focusCountryOverrideExpiresAt",
  "zoomEndChunkVisibleMetric",
  "lastZoomEndToChunkVisibleMetric",
  "zoomEndProtectedChunkIds",
  "zoomEndProtectedUntil",
  "zoomEndProtectedSelectionVersion",
  "zoomEndProtectedScenarioId",
  "zoomEndProtectedFocusCountry",
  "pendingVisualPromotion",
  "pendingInfraPromotion",
  "pendingPromotion",
  "promotionTimerId",
  "promotionScheduled",
  "promotionCommitInFlight",
  "promotionCommitRunId",
  "promotionCommitStatus",
  "promotionCommitScenarioId",
  "promotionCommitSelectionVersion",
  "promotionCommitReason",
  "promotionCommitStartedAt",
  "promotionCommitFinishedAt",
  "promotionCommitError",
  "pendingPostCommitRefresh",
  "promotionRetryCount",
  "lastPromotionRetryAt",
  "inFlightByChunkId",
  "errorByChunkId",
  "lastSelection",
  "scenarioApplyEpochBySelectionVersion",
  "scenarioApplyRequestIdBySelectionVersion",
  "layerSelectionSignatures",
  "mergedLayerPayloadCache",
]);

const OPTIONAL_LAYER_CONFIGS = Object.freeze({
  water: Object.freeze({ stateField: "scenarioWaterRegionsData", revisionField: "" }),
  special: Object.freeze({ stateField: "scenarioSpecialRegionsData", revisionField: "" }),
  scenario_atlantropa: Object.freeze({ stateField: "scenarioAtlantropaData", revisionField: "scenarioAtlantropaRevision" }),
  specialzonelayers: Object.freeze({ stateField: "specialZoneLayers", revisionField: "" }),
  relief: Object.freeze({ stateField: "scenarioReliefOverlaysData", revisionField: "scenarioReliefOverlayRevision" }),
  cities: Object.freeze({ stateField: "scenarioCityOverridesData", revisionField: "cityLayerRevision" }),
  strategicvalues: Object.freeze({ stateField: "scenarioStrategicValuesData", revisionField: "scenarioStrategicValuesRevision" }),
});

async function importExpectedModule(modulePath, label) {
  try {
    return await import(modulePath);
  } catch (error) {
    assert.fail(
      `${label} must exist and be importable at ${modulePath}: ${error?.message || error}`,
    );
  }
}

test("scenario chunk runtime actions ensure, reset, and replace only the explicit root target", async () => {
  const {
    ensureScenarioChunkRuntimeState,
    replaceScenarioChunkRuntimeState,
    resetScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {
    sentinel: "preserved",
    activeScenarioChunks: { loadedChunkIds: "invalid" },
    runtimeChunkLoadState: { selectionVersion: -4, pendingReason: 7 },
  };
  const existingChunks = target.activeScenarioChunks;
  const existingLoadState = target.runtimeChunkLoadState;

  const ensured = ensureScenarioChunkRuntimeState(target, { scenarioId: " demo " });

  assert.equal(ensured, true);
  assert.equal(target.activeScenarioChunks, existingChunks);
  assert.equal(target.runtimeChunkLoadState, existingLoadState);
  assert.equal(target.activeScenarioChunks.scenarioId, "demo");
  assert.deepEqual(target.activeScenarioChunks.loadedChunkIds, []);
  assert.deepEqual(target.activeScenarioChunks.payloadByChunkId, {});
  assert.deepEqual(target.activeScenarioChunks.mergedLayerPayloads, {});
  assert.deepEqual(target.activeScenarioChunks.lruChunkIds, []);
  assert.equal(target.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(target.runtimeChunkLoadState.registryStatus, "ready");
  assert.equal(target.runtimeChunkLoadState.selectionVersion, 0);
  assert.equal(target.runtimeChunkLoadState.pendingReason, "");
  assert.equal(target.runtimeChunkLoadState.generation, 0);
  assert.equal(Object.hasOwn(target, "scenarioChunkLoadStateGeneration"), false);
  assert.equal(target.sentinel, "preserved");

  const previousChunks = target.activeScenarioChunks;
  const previousLoadState = target.runtimeChunkLoadState;
  const previousLoadStateGeneration =
    previousLoadState.generation;
  const reset = resetScenarioChunkRuntimeState(target, { scenarioId: " next " });
  assert.equal(reset, true);
  assert.notEqual(target.activeScenarioChunks, previousChunks);
  assert.notEqual(target.runtimeChunkLoadState, previousLoadState);
  assert.equal(target.activeScenarioChunks.scenarioId, "next");
  assert.equal(target.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(
    target.runtimeChunkLoadState.generation,
    previousLoadStateGeneration + 1,
  );
  const frozenLoadState = Object.freeze({
    ...target.runtimeChunkLoadState,
    sentinel: "frozen-snapshot",
  });
  const replacementChunks = { scenarioId: "replacement" };
  const replacementGeneration = target.runtimeChunkLoadState.generation + 1;
  replaceScenarioChunkRuntimeState(target, {
    activeScenarioChunks: replacementChunks,
    runtimeChunkLoadState: frozenLoadState,
  });
  assert.equal(target.activeScenarioChunks, replacementChunks);
  assert.notEqual(target.runtimeChunkLoadState, frozenLoadState);
  assert.deepEqual(target.runtimeChunkLoadState, {
    ...frozenLoadState,
    generation: replacementGeneration,
  });
  assert.equal(target.sentinel, "preserved");
});

test("scenario chunk runtime replacement propagates unexpected generation setter failures", async () => {
  const { replaceScenarioChunkRuntimeState } = await importExpectedModule(
    RUNTIME_ACTIONS_PATH,
    "scenario chunk runtime actions",
  );
  const setterFailure = new Error("generation setter failed");
  const replacementLoadState = {};
  Object.defineProperty(replacementLoadState, "generation", {
    configurable: true,
    enumerable: true,
    get() {
      return 4;
    },
    set() {
      throw setterFailure;
    },
  });
  const target = {
    activeScenarioChunks: { scenarioId: "before" },
    runtimeChunkLoadState: { generation: 3 },
  };
  const previousActiveScenarioChunks = target.activeScenarioChunks;
  const previousRuntimeChunkLoadState = target.runtimeChunkLoadState;
  const previousActiveScenarioChunksSnapshot = { ...previousActiveScenarioChunks };
  const previousRuntimeChunkLoadStateSnapshot = { ...previousRuntimeChunkLoadState };

  assert.throws(
    () => replaceScenarioChunkRuntimeState(target, {
      activeScenarioChunks: { scenarioId: "after" },
      runtimeChunkLoadState: replacementLoadState,
    }),
    (error) => error === setterFailure,
  );
  assert.equal(target.activeScenarioChunks, previousActiveScenarioChunks);
  assert.equal(target.runtimeChunkLoadState, previousRuntimeChunkLoadState);
  assert.deepEqual(target.activeScenarioChunks, previousActiveScenarioChunksSnapshot);
  assert.deepEqual(target.runtimeChunkLoadState, previousRuntimeChunkLoadStateSnapshot);
});

test("scenario chunk runtime defaults match the canonical factories and normalize invalid present fields", async () => {
  const {
    ensureScenarioChunkRuntimeState,
    resetScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const {
    createDefaultActiveScenarioChunksState,
    createDefaultRuntimeChunkLoadState,
  } = await import("../js/core/state/scenario_runtime_state.js");

  const resetTarget = {};
  resetScenarioChunkRuntimeState(resetTarget, { scenarioId: " demo " });
  assert.deepEqual(
    resetTarget.activeScenarioChunks,
    createDefaultActiveScenarioChunksState("demo"),
  );
  assert.deepEqual(
    resetTarget.runtimeChunkLoadState,
    {
      ...createDefaultRuntimeChunkLoadState({ scenarioId: "demo" }),
      generation: 1,
    },
  );

  const target = {
    activeScenarioChunks: {
      scenarioId: "demo",
      scenarioApplyEpoch: "invalid",
      scenarioApplyRequestId: -4,
      loadedChunkIds: {},
      payloadByChunkId: [],
      mergedLayerPayloads: [],
      lruChunkIds: {},
    },
    runtimeChunkLoadState: {
      shellStatus: 9,
      registryStatus: null,
      refreshScheduled: "yes",
      refreshTimerId: "invalid",
      selectionVersion: "12",
      pendingReason: 7,
      pendingDelayMs: "25",
      pendingScenarioApplyRequestId: "14",
      focusCountryOverrideExpiresAt: "33",
      zoomEndChunkVisibleMetric: "invalid",
      lastZoomEndToChunkVisibleMetric: [],
      zoomEndProtectedChunkIds: {},
      pendingVisualPromotion: "invalid",
      pendingInfraPromotion: [],
      pendingPromotion: "invalid",
      promotionTimerId: "invalid",
      pendingPostCommitRefresh: "invalid",
      promotionCommitRunId: "7",
      promotionCommitSelectionVersion: "8",
      promotionCommitStartedAt: "9",
      promotionCommitFinishedAt: "10",
      promotionRetryCount: "11",
      lastPromotionRetryAt: "12",
      inFlightByChunkId: [],
      errorByChunkId: null,
      scenarioApplyEpochBySelectionVersion: [],
      scenarioApplyRequestIdBySelectionVersion: null,
      layerSelectionSignatures: [],
      mergedLayerPayloadCache: null,
    },
  };
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  assert.equal(target.activeScenarioChunks.scenarioApplyEpoch, 0);
  assert.equal(target.activeScenarioChunks.scenarioApplyRequestId, 0);
  assert.deepEqual(target.activeScenarioChunks.loadedChunkIds, []);
  assert.deepEqual(target.activeScenarioChunks.payloadByChunkId, {});
  assert.deepEqual(target.activeScenarioChunks.mergedLayerPayloads, {});
  assert.deepEqual(target.activeScenarioChunks.lruChunkIds, []);
  assert.equal(target.runtimeChunkLoadState.shellStatus, "ready");
  assert.equal(target.runtimeChunkLoadState.registryStatus, "ready");
  assert.equal(target.runtimeChunkLoadState.refreshScheduled, false);
  assert.equal(target.runtimeChunkLoadState.refreshTimerId, null);
  assert.equal(target.runtimeChunkLoadState.selectionVersion, 12);
  assert.equal(target.runtimeChunkLoadState.pendingReason, "");
  assert.equal(target.runtimeChunkLoadState.pendingDelayMs, 25);
  assert.equal(target.runtimeChunkLoadState.pendingScenarioApplyRequestId, 14);
  assert.equal(target.runtimeChunkLoadState.focusCountryOverrideExpiresAt, 33);
  assert.equal(target.runtimeChunkLoadState.zoomEndChunkVisibleMetric, null);
  assert.equal(target.runtimeChunkLoadState.lastZoomEndToChunkVisibleMetric, null);
  assert.deepEqual(target.runtimeChunkLoadState.zoomEndProtectedChunkIds, []);
  assert.equal(target.runtimeChunkLoadState.pendingVisualPromotion, null);
  assert.equal(target.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(target.runtimeChunkLoadState.pendingPromotion, null);
  assert.equal(target.runtimeChunkLoadState.promotionTimerId, null);
  assert.equal(target.runtimeChunkLoadState.pendingPostCommitRefresh, null);
  assert.equal(target.runtimeChunkLoadState.promotionCommitRunId, 7);
  assert.equal(target.runtimeChunkLoadState.promotionCommitSelectionVersion, 8);
  assert.equal(target.runtimeChunkLoadState.promotionCommitStartedAt, 9);
  assert.equal(target.runtimeChunkLoadState.promotionCommitFinishedAt, 10);
  assert.equal(target.runtimeChunkLoadState.promotionRetryCount, 11);
  assert.equal(target.runtimeChunkLoadState.lastPromotionRetryAt, 12);
  assert.deepEqual(target.runtimeChunkLoadState.inFlightByChunkId, {});
  assert.deepEqual(target.runtimeChunkLoadState.errorByChunkId, {});
  assert.deepEqual(target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion, {});
  assert.deepEqual(target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion, {});
  assert.deepEqual(target.runtimeChunkLoadState.layerSelectionSignatures, {});
  assert.deepEqual(target.runtimeChunkLoadState.mergedLayerPayloadCache, {});
});

test("scenario chunk runtime actions preserve platform timer handles and clear generic objects", async () => {
  const {
    ensureScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const nodeTimerHandle = { ref() {} };
  const target = {
    runtimeChunkLoadState: {
      refreshTimerId: { timer: true },
      promotionTimerId: nodeTimerHandle,
    },
  };

  ensureScenarioChunkRuntimeState(target);

  assert.equal(target.runtimeChunkLoadState.refreshTimerId, null);
  assert.equal(target.runtimeChunkLoadState.promotionTimerId, nodeTimerHandle);

  target.runtimeChunkLoadState.refreshTimerId = 4;
  target.runtimeChunkLoadState.promotionTimerId = Number.NaN;
  ensureScenarioChunkRuntimeState(target);

  assert.equal(target.runtimeChunkLoadState.refreshTimerId, 4);
  assert.equal(target.runtimeChunkLoadState.promotionTimerId, null);
});

test("scenario chunk runtime actions derive promotion scheduling from the normalized timer handle", async () => {
  const {
    ensureScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const nodeTimerHandle = { ref() {} };
  const target = {
    runtimeChunkLoadState: {
      promotionTimerId: nodeTimerHandle,
      promotionScheduled: false,
    },
  };

  ensureScenarioChunkRuntimeState(target);

  assert.equal(target.runtimeChunkLoadState.promotionTimerId, nodeTimerHandle);
  assert.equal(target.runtimeChunkLoadState.promotionScheduled, true);

  target.runtimeChunkLoadState.promotionTimerId = null;
  target.runtimeChunkLoadState.promotionScheduled = true;
  ensureScenarioChunkRuntimeState(target);

  assert.equal(target.runtimeChunkLoadState.promotionTimerId, null);
  assert.equal(target.runtimeChunkLoadState.promotionScheduled, false);
});

test("scenario chunk load patching is finite and selection commits stay on the root target", async () => {
  const {
    SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS,
    commitScenarioChunkSelectionState,
    ensureScenarioChunkRuntimeState,
    patchScenarioChunkLoadState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = { sentinel: "preserved" };
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });

  assert.equal(Object.isFrozen(SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS), true);
  assert.deepEqual(SCENARIO_CHUNK_LOAD_STATE_PATCH_KEYS, LOAD_STATE_PATCH_KEYS);
  const lastSelection = { scenarioId: "demo", selectionVersion: 3 };
  patchScenarioChunkLoadState(target, {
    pendingReason: "zoom-end",
    pendingDelayMs: 25,
    focusCountryOverride: "FRA",
  });
  assert.equal(target.runtimeChunkLoadState.pendingReason, "zoom-end");
  assert.equal(target.runtimeChunkLoadState.pendingDelayMs, 25);
  assert.equal(target.runtimeChunkLoadState.focusCountryOverride, "FRA");
  assert.throws(
    () => patchScenarioChunkLoadState(target, { arbitraryRuntimeField: true }),
    /unknown scenario chunk load state key: arbitraryRuntimeField/,
  );

  commitScenarioChunkSelectionState(target, {
    selectionVersion: 3,
    scenarioApplyEpoch: 7,
    scenarioApplyRequestId: 11,
    lastSelection,
  });
  assert.equal(target.runtimeChunkLoadState.selectionVersion, 3);
  assert.equal(target.runtimeChunkLoadState.lastSelection, lastSelection);
  assert.equal(target.runtimeChunkLoadState.scenarioApplyEpochBySelectionVersion[3], 7);
  assert.equal(target.runtimeChunkLoadState.scenarioApplyRequestIdBySelectionVersion[3], 11);
  assert.equal(target.activeScenarioChunks.scenarioApplyEpoch, 7);
  assert.equal(target.activeScenarioChunks.scenarioApplyRequestId, 11);
  assert.equal(target.sentinel, "preserved");
});

test("scenario chunk load patch rejects a stale captured generation", async () => {
  const {
    ensureScenarioChunkRuntimeState,
    patchScenarioChunkLoadState,
    resetScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {};
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  const staleGeneration = patchScenarioChunkLoadState(
    target,
    { registryStatus: "loading" },
    { returnLoadStateGeneration: true },
  );
  assert.equal(staleGeneration, target.runtimeChunkLoadState.generation);

  resetScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  target.runtimeChunkLoadState.registryStatus = "current-generation-loading";

  assert.equal(
    patchScenarioChunkLoadState(
      target,
      { registryStatus: "ready" },
      { expectedLoadStateGeneration: staleGeneration },
    ),
    false,
  );
  assert.equal(target.runtimeChunkLoadState.registryStatus, "current-generation-loading");

  const currentGeneration = patchScenarioChunkLoadState(
    target,
    { registryStatus: "current-generation-loading" },
    { returnLoadStateGeneration: true },
  );
  assert.equal(typeof currentGeneration, "number");
  assert.equal(
    patchScenarioChunkLoadState(
      target,
      { registryStatus: "ready" },
      { expectedLoadStateGeneration: currentGeneration },
    ),
    true,
  );
  assert.equal(target.runtimeChunkLoadState.registryStatus, "ready");
});

test("scenario chunk load lifecycle records begin, success, failure, error clear, and finish", async () => {
  const {
    beginScenarioChunkLoadState,
    completeScenarioChunkLoadState,
    ensureScenarioChunkRuntimeState,
    failScenarioChunkLoadState,
    finishScenarioChunkLoadState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {};
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });

  assert.equal(beginScenarioChunkLoadState(target, " political-1 "), true);
  assert.equal(target.runtimeChunkLoadState.inFlightByChunkId["political-1"], true);
  target.runtimeChunkLoadState.errorByChunkId["political-1"] = "stale";
  assert.equal(completeScenarioChunkLoadState(target, "political-1"), true);
  assert.equal(Object.hasOwn(target.runtimeChunkLoadState.errorByChunkId, "political-1"), false);
  assert.equal(finishScenarioChunkLoadState(target, "political-1"), true);
  assert.equal(Object.hasOwn(target.runtimeChunkLoadState.inFlightByChunkId, "political-1"), false);

  beginScenarioChunkLoadState(target, "water-1");
  assert.equal(failScenarioChunkLoadState(target, "water-1", "network failed"), "network failed");
  assert.equal(target.runtimeChunkLoadState.errorByChunkId["water-1"], "network failed");
  finishScenarioChunkLoadState(target, "water-1");
  assert.equal(Object.hasOwn(target.runtimeChunkLoadState.inFlightByChunkId, "water-1"), false);
});

test("scenario chunk load lifecycle rejects stale generation observers after reset", async () => {
  const {
    beginScenarioChunkLoadState,
    captureScenarioChunkLoadStateContinuation,
    commitScenarioChunkSelectionState,
    completeScenarioChunkLoadState,
    ensureScenarioChunkRuntimeState,
    failScenarioChunkLoadState,
    finishScenarioChunkLoadState,
    resetScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {};
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  target.activeScenarioId = "demo";
  target.currentScenarioApplyRequestId = 12;
  const staleLoadState = target.runtimeChunkLoadState;
  const staleLoadStateGeneration =
    staleLoadState.generation;
  const staleContinuation =
    captureScenarioChunkLoadStateContinuation(target);

  resetScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  const currentLoadState = target.runtimeChunkLoadState;
  const currentLoadStateGeneration =
    currentLoadState.generation;
  const currentContinuation =
    captureScenarioChunkLoadStateContinuation(target);
  assert.equal(Object.isFrozen(currentContinuation), true);
  assert.equal(currentContinuation.loadStateGeneration, currentLoadStateGeneration);
  assert.equal(currentContinuation.activeScenarioId, "demo");
  assert.equal(currentContinuation.currentScenarioApplyRequestId, 12);
  assert.notEqual(
    currentContinuation.loadStateGeneration,
    staleContinuation.loadStateGeneration,
  );
  assert.notEqual(currentLoadState, staleLoadState);
  assert.notEqual(currentLoadStateGeneration, staleLoadStateGeneration);
  assert.equal(
    beginScenarioChunkLoadState(target, "political-1", {
      expectedLoadStateGeneration: currentLoadStateGeneration,
    }),
    true,
  );
  assert.equal(
    failScenarioChunkLoadState(
      target,
      "political-1",
      "current observer",
      { expectedLoadStateGeneration: currentLoadStateGeneration },
    ),
    "current observer",
  );
  const expectedInFlight = { ...currentLoadState.inFlightByChunkId };
  const expectedErrors = { ...currentLoadState.errorByChunkId };
  const expectedActiveScenarioChunks = structuredClone(target.activeScenarioChunks);
  const expectedCurrentLoadState = structuredClone(currentLoadState);

  assert.equal(
    commitScenarioChunkSelectionState(
      target,
      {
        selectionVersion: 7,
        scenarioApplyEpoch: 8,
        scenarioApplyRequestId: 9,
        lastSelection: { scenarioId: "stale" },
      },
      { expectedLoadStateGeneration: staleLoadStateGeneration },
    ),
    false,
  );
  assert.deepEqual(target.activeScenarioChunks, expectedActiveScenarioChunks);
  assert.deepEqual(currentLoadState, expectedCurrentLoadState);

  assert.equal(
    beginScenarioChunkLoadState(target, "political-1", {
      expectedLoadStateGeneration: staleLoadStateGeneration,
    }),
    false,
  );
  assert.equal(
    completeScenarioChunkLoadState(target, "political-1", {
      expectedLoadStateGeneration: staleLoadStateGeneration,
    }),
    false,
  );
  assert.equal(
    failScenarioChunkLoadState(
      target,
      "political-1",
      "stale observer",
      { expectedLoadStateGeneration: staleLoadStateGeneration },
    ),
    false,
  );
  assert.equal(
    finishScenarioChunkLoadState(target, "political-1", {
      expectedLoadStateGeneration: staleLoadStateGeneration,
    }),
    false,
  );
  assert.deepEqual(currentLoadState.inFlightByChunkId, expectedInFlight);
  assert.deepEqual(currentLoadState.errorByChunkId, expectedErrors);
});

test("scenario chunk generation fences reject missing or invalid continuation tokens before initialization", async () => {
  const {
    beginScenarioChunkLoadState,
    commitScenarioChunkSelectionState,
    completeScenarioChunkLoadState,
    ensureScenarioChunkRuntimeState,
    failScenarioChunkLoadState,
    finishScenarioChunkLoadState,
    patchScenarioChunkLoadState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const attempts = Object.freeze([
    Object.freeze({
      name: "patch",
      run: (target, expectedLoadStateGeneration) => patchScenarioChunkLoadState(
        target,
        { registryStatus: "stale-write" },
        { expectedLoadStateGeneration },
      ),
    }),
    Object.freeze({
      name: "selection",
      run: (target, expectedLoadStateGeneration) => commitScenarioChunkSelectionState(
        target,
        { selectionVersion: 9 },
        { expectedLoadStateGeneration },
      ),
    }),
    Object.freeze({
      name: "begin",
      run: (target, expectedLoadStateGeneration) => beginScenarioChunkLoadState(
        target,
        "political-1",
        { expectedLoadStateGeneration },
      ),
    }),
    Object.freeze({
      name: "complete",
      run: (target, expectedLoadStateGeneration) => completeScenarioChunkLoadState(
        target,
        "political-1",
        { expectedLoadStateGeneration },
      ),
    }),
    Object.freeze({
      name: "fail",
      run: (target, expectedLoadStateGeneration) => failScenarioChunkLoadState(
        target,
        "political-1",
        "stale observer",
        { expectedLoadStateGeneration },
      ),
    }),
    Object.freeze({
      name: "finish",
      run: (target, expectedLoadStateGeneration) => finishScenarioChunkLoadState(
        target,
        "political-1",
        { expectedLoadStateGeneration },
      ),
    }),
  ]);
  const malformedLoadStates = Object.freeze([
    Object.freeze({ name: "missing", assign: false, value: undefined }),
    Object.freeze({ name: "null", assign: true, value: null }),
    Object.freeze({ name: "array", assign: true, value: [] }),
    Object.freeze({ name: "missing-generation", assign: true, value: {} }),
    Object.freeze({ name: "negative-generation", assign: true, value: { generation: -1 } }),
    Object.freeze({ name: "string-generation", assign: true, value: { generation: "0" } }),
    Object.freeze({ name: "nan-generation", assign: true, value: { generation: Number.NaN } }),
  ]);

  for (const attempt of attempts) {
    for (const malformed of malformedLoadStates) {
      const target = { sentinel: "preserved" };
      if (malformed.assign) target.runtimeChunkLoadState = structuredClone(malformed.value);
      const before = structuredClone(target);
      assert.equal(
        attempt.run(target, 0),
        false,
        `${attempt.name} must reject ${malformed.name} current generation`,
      );
      assert.deepEqual(
        target,
        before,
        `${attempt.name} must not initialize or mutate ${malformed.name} state`,
      );
    }
  }

  const initializedTarget = {};
  ensureScenarioChunkRuntimeState(initializedTarget, { scenarioId: "demo" });
  const currentGeneration = initializedTarget.runtimeChunkLoadState.generation;
  const invalidExpectedGenerations = Object.freeze([
    String(currentGeneration),
    -1,
    Number.NaN,
    currentGeneration + 0.5,
    {},
    [],
  ]);
  for (const attempt of attempts) {
    for (const invalidExpectedGeneration of invalidExpectedGenerations) {
      const target = structuredClone(initializedTarget);
      const before = structuredClone(target);
      assert.equal(
        attempt.run(target, invalidExpectedGeneration),
        false,
        `${attempt.name} must reject invalid expected generation ${String(invalidExpectedGeneration)}`,
      );
      assert.deepEqual(target, before, `${attempt.name} must not mutate after an invalid expected generation`);
    }
  }
});

test("scenario chunk continuation captures request priority as frozen scalars", async () => {
  const {
    captureScenarioChunkLoadStateContinuation,
    ensureScenarioChunkRuntimeState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {
    activeScenarioId: "demo",
    currentScenarioApplyRequestId: 12,
    latestScenarioApplyRequestId: 18,
    latestScenarioApplyTargetId: "demo",
    currentScenarioApplyTargetId: "next-demo",
    scenarioApplyInFlight: true,
  };
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  const loadState = target.runtimeChunkLoadState;
  loadState.selectionVersion = 3;
  loadState.pendingScenarioApplyRequestId = 15;
  loadState.scenarioApplyRequestIdBySelectionVersion = { 3: 14 };
  loadState.lastSelection = { scenarioApplyRequestId: 13 };

  const pendingContinuation = captureScenarioChunkLoadStateContinuation(target);
  assert.equal(Object.isFrozen(pendingContinuation), true);
  assert.equal(pendingContinuation.latestScenarioApplyRequestId, 18);
  assert.equal(pendingContinuation.latestScenarioApplyTargetId, "demo");
  assert.equal(pendingContinuation.currentScenarioApplyTargetId, "next-demo");
  assert.equal(pendingContinuation.scenarioApplyInFlight, true);
  assert.equal(pendingContinuation.continuationScenarioApplyRequestId, 15);

  loadState.pendingScenarioApplyRequestId = 0;
  const currentContinuation = captureScenarioChunkLoadStateContinuation(target);
  assert.equal(currentContinuation.continuationScenarioApplyRequestId, 12);

  target.currentScenarioApplyRequestId = 0;
  const selectionContinuation = captureScenarioChunkLoadStateContinuation(target);
  assert.equal(selectionContinuation.continuationScenarioApplyRequestId, 14);

  loadState.scenarioApplyRequestIdBySelectionVersion[3] = 0;
  const lastSelectionContinuation = captureScenarioChunkLoadStateContinuation(target);
  assert.equal(lastSelectionContinuation.continuationScenarioApplyRequestId, 13);
});

test("scenario chunk payload actions own upsert order, LRU order, eviction, and merged payload commit", async () => {
  const {
    commitScenarioChunkPayloadEntriesState,
    evictScenarioChunkPayloadsState,
    setScenarioChunkMergedLayerPayloadsState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {};
  const politicalA = { layerKey: "political", payload: { id: "a" } };
  const water = { layerKey: "water", payload: { id: "water" } };
  const politicalB = { layerKey: "political", payload: { id: "b" } };

  commitScenarioChunkPayloadEntriesState(target, [
    { chunkId: " political ", payload: politicalA },
    { chunkId: "water", payload: water },
    { chunkId: "political", payload: politicalB },
    { chunkId: "", payload: { ignored: true } },
  ]);
  assert.deepEqual(target.activeScenarioChunks.loadedChunkIds, ["political", "water"]);
  assert.equal(target.activeScenarioChunks.payloadByChunkId.political, politicalB);
  assert.equal(target.activeScenarioChunks.payloadByChunkId.water, water);
  assert.deepEqual(target.activeScenarioChunks.lruChunkIds, ["water", "political"]);

  const merged = { political: { features: [] }, water: null };
  assert.equal(setScenarioChunkMergedLayerPayloadsState(target, merged), merged);
  assert.equal(target.activeScenarioChunks.mergedLayerPayloads, merged);

  assert.deepEqual(evictScenarioChunkPayloadsState(target, [" water ", "missing"]), ["water"]);
  assert.deepEqual(target.activeScenarioChunks.loadedChunkIds, ["political"]);
  assert.deepEqual(target.activeScenarioChunks.lruChunkIds, ["political"]);
  assert.equal(Object.hasOwn(target.activeScenarioChunks.payloadByChunkId, "water"), false);
});

test("pending promotion identity replacement uses an expected-object fence and frozen replacement", async () => {
  const {
    ensureScenarioChunkRuntimeState,
    replaceScenarioChunkPendingPromotionIdentityState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = {};
  ensureScenarioChunkRuntimeState(target);
  const pending = { scenarioId: "demo", selectionVersion: 2, reason: "refresh" };
  target.runtimeChunkLoadState.pendingPromotion = pending;

  assert.equal(
    replaceScenarioChunkPendingPromotionIdentityState(
      target,
      { ...pending },
      { scenarioApplyEpoch: 7 },
    ),
    null,
  );
  assert.equal(target.runtimeChunkLoadState.pendingPromotion, pending);
  const replacement = replaceScenarioChunkPendingPromotionIdentityState(
    target,
    pending,
    { scenarioApplyEpoch: 7, scenarioApplyRequestId: 11 },
  );
  assert.equal(Object.isFrozen(replacement), true);
  assert.deepEqual(replacement, {
    scenarioId: "demo",
    selectionVersion: 2,
    reason: "refresh",
    scenarioApplyEpoch: 7,
    scenarioApplyRequestId: 11,
  });
  assert.equal(target.runtimeChunkLoadState.pendingPromotion, replacement);
  assert.equal(pending.scenarioApplyEpoch, undefined);

  target.runtimeChunkLoadState.pendingPromotion = null;
  const fromEmpty = replaceScenarioChunkPendingPromotionIdentityState(
    target,
    null,
    { scenarioId: "next", selectionVersion: 1 },
  );
  assert.deepEqual(fromEmpty, { scenarioId: "next", selectionVersion: 1 });
  assert.equal(Object.isFrozen(fromEmpty), true);
});

test("scenario chunk promotion queue, status, clear, and runtime hooks have explicit owners", async () => {
  const {
    clearScenarioChunkPromotionState,
    ensureScenarioChunkRuntimeState,
    queueScenarioChunkPromotionState,
    setScenarioChunkPromotionStatusState,
    setScenarioChunkRuntimeHooksState,
  } = await importExpectedModule(RUNTIME_ACTIONS_PATH, "scenario chunk runtime actions");
  const target = { sentinel: "preserved" };
  ensureScenarioChunkRuntimeState(target, { scenarioId: "demo" });
  const visualPromotion = { selectionVersion: 4, phase: "visual" };
  const infraPromotion = { selectionVersion: 4, phase: "infra" };
  const promotion = { selectionVersion: 4, scenarioId: "demo" };

  queueScenarioChunkPromotionState(target, {
    visualPromotion,
    infraPromotion,
    promotion,
  });
  assert.equal(target.runtimeChunkLoadState.pendingVisualPromotion, visualPromotion);
  assert.equal(target.runtimeChunkLoadState.pendingInfraPromotion, infraPromotion);
  assert.equal(target.runtimeChunkLoadState.pendingPromotion, promotion);
  setScenarioChunkPromotionStatusState(target, "promotion-commit-started", {
    inFlight: true,
    runId: 9,
    scenarioId: " demo ",
    selectionVersion: 4,
    reason: "zoom-end",
    startedAt: 100,
    finishedAt: 0,
    error: "",
  });
  assert.deepEqual(
    {
      status: target.runtimeChunkLoadState.promotionCommitStatus,
      inFlight: target.runtimeChunkLoadState.promotionCommitInFlight,
      runId: target.runtimeChunkLoadState.promotionCommitRunId,
      scenarioId: target.runtimeChunkLoadState.promotionCommitScenarioId,
      selectionVersion: target.runtimeChunkLoadState.promotionCommitSelectionVersion,
      reason: target.runtimeChunkLoadState.promotionCommitReason,
      startedAt: target.runtimeChunkLoadState.promotionCommitStartedAt,
      finishedAt: target.runtimeChunkLoadState.promotionCommitFinishedAt,
      error: target.runtimeChunkLoadState.promotionCommitError,
    },
    {
      status: "promotion-commit-started",
      inFlight: true,
      runId: 9,
      scenarioId: "demo",
      selectionVersion: 4,
      reason: "zoom-end",
      startedAt: 100,
      finishedAt: 0,
      error: "",
    },
  );

  target.runtimeChunkLoadState.promotionTimerId = { timer: true };
  target.runtimeChunkLoadState.promotionScheduled = true;
  target.runtimeChunkLoadState.promotionRetryCount = 2;
  target.runtimeChunkLoadState.lastPromotionRetryAt = 55;
  clearScenarioChunkPromotionState(target);
  assert.equal(target.runtimeChunkLoadState.promotionTimerId, null);
  assert.equal(target.runtimeChunkLoadState.promotionScheduled, false);
  assert.equal(target.runtimeChunkLoadState.pendingVisualPromotion, null);
  assert.equal(target.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(target.runtimeChunkLoadState.pendingPromotion, null);
  assert.equal(target.runtimeChunkLoadState.promotionRetryCount, 0);
  assert.equal(target.runtimeChunkLoadState.lastPromotionRetryAt, 0);

  const scheduleScenarioChunkRefreshFn = () => {};
  const awaitInitialScenarioChunkVisualPromotionFn = async () => {};
  setScenarioChunkRuntimeHooksState(target, {
    scheduleScenarioChunkRefreshFn,
    awaitInitialScenarioChunkVisualPromotionFn,
  });
  assert.equal(target.scheduleScenarioChunkRefreshFn, scheduleScenarioChunkRefreshFn);
  assert.equal(
    target.awaitInitialScenarioChunkVisualPromotionFn,
    awaitInitialScenarioChunkVisualPromotionFn,
  );
  assert.equal(target.sentinel, "preserved");
});

test("scenario chunk optional layers use one frozen finite mapping", async () => {
  const {
    SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS,
    applyScenarioChunkOptionalLayerState,
    getScenarioChunkOptionalLayerState,
  } = await importExpectedModule(ACTIVATION_ACTIONS_PATH, "scenario activation actions");
  const target = {};

  assert.equal(Object.isFrozen(SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS), true);
  assert.deepEqual(
    Object.keys(SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS),
    Object.keys(OPTIONAL_LAYER_CONFIGS),
  );
  for (const [layerKey, expected] of Object.entries(OPTIONAL_LAYER_CONFIGS)) {
    const actual = SCENARIO_CHUNK_OPTIONAL_LAYER_STATE_CONFIGS[layerKey];
    assert.equal(Object.isFrozen(actual), true, `${layerKey} config must be frozen`);
    assert.equal(actual.stateField, expected.stateField);
    assert.equal(actual.revisionField || "", expected.revisionField);
  }

  const reliefPayload = { features: [{ id: "relief-1" }] };
  const reliefResult = applyScenarioChunkOptionalLayerState(target, "relief", reliefPayload);
  assert.equal(target.scenarioReliefOverlaysData, reliefPayload);
  assert.equal(target.scenarioReliefOverlayRevision, 1);
  assert.equal(reliefResult.changed, true);
  assert.equal(getScenarioChunkOptionalLayerState(target, "relief"), reliefPayload);
  const unchangedReliefResult = applyScenarioChunkOptionalLayerState(target, "relief", reliefPayload);
  assert.equal(unchangedReliefResult.changed, false);
  assert.equal(target.scenarioReliefOverlayRevision, 1);

  const cityPayload = { cities: [{ id: "paris" }] };
  const cityResult = applyScenarioChunkOptionalLayerState(target, "cities", cityPayload);
  assert.equal(Object.hasOwn(target, "scenarioCityOverridesData"), false);
  assert.equal(Object.hasOwn(target, "cityLayerRevision"), false);
  assert.ok(cityResult.externalEffect);
  assert.equal(cityResult.externalEffect.payload, cityPayload);
  assert.equal(cityResult.externalEffect.finalizerToken, null);
  assert.throws(
    () => applyScenarioChunkOptionalLayerState(target, "unknown-layer", {}),
    /unknown scenario chunk optional layer: unknown-layer/,
  );
  assert.throws(
    () => getScenarioChunkOptionalLayerState(target, "unknown-layer"),
    /unknown scenario chunk optional layer: unknown-layer/,
  );
});

test("scenario chunk promotion snapshots restore exact values and absent properties", async () => {
  const {
    applyScenarioChunkOptionalLayerState,
    captureScenarioChunkPromotionState,
    restoreScenarioChunkPromotionState,
  } = await importExpectedModule(ACTIVATION_ACTIONS_PATH, "scenario activation actions");
  const { finalizeScenarioChunkCityExternalEffectState } = await importExpectedModule(
    PRESENTATION_ACTIONS_PATH,
    "scenario presentation actions",
  );
  const waterBefore = { features: [{ id: "water-before" }] };
  const target = {
    scenarioWaterRegionsData: waterBefore,
    scenarioReliefOverlayRevision: 8,
    scenarioCityOverridesData: { cities: [{ id: "before" }] },
    sentinel: "preserved",
  };

  const snapshot = captureScenarioChunkPromotionState(target, ["water", "relief", "cities"]);
  assert.equal(Object.isFrozen(snapshot), true);
  applyScenarioChunkOptionalLayerState(target, "water", { features: [] });
  applyScenarioChunkOptionalLayerState(target, "relief", { features: [{ id: "new" }] });
  const restoreResult = restoreScenarioChunkPromotionState(target, snapshot);

  assert.equal(target.scenarioWaterRegionsData, waterBefore);
  assert.equal(Object.hasOwn(target, "scenarioReliefOverlaysData"), false);
  assert.equal(target.scenarioReliefOverlayRevision, 8);
  assert.equal(restoreResult.externalEffects.length, 1);
  const [cityEffect] = restoreResult.externalEffects;
  assert.equal(cityEffect.type, "scenario-city-overrides");
  assert.deepEqual(cityEffect.payload, { cities: [{ id: "before" }] });
  target.scenarioCityOverridesData = cityEffect.payload;
  target.cityLayerRevision = 9;
  assert.equal(
    finalizeScenarioChunkCityExternalEffectState(target, cityEffect.finalizerToken),
    true,
  );
  assert.deepEqual(target.scenarioCityOverridesData, { cities: [{ id: "before" }] });
  assert.equal(Object.hasOwn(target, "cityLayerRevision"), false);
  assert.equal(target.sentinel, "preserved");
});

test("special-zone layer promotion delegates present commits and preserves absent rollback", async () => {
  const {
    applyScenarioChunkOptionalLayerState,
    captureScenarioChunkPromotionState,
    restoreScenarioChunkPromotionState,
  } = await importExpectedModule(ACTIVATION_ACTIONS_PATH, "scenario activation actions");
  const target = {};
  const absentSnapshot = captureScenarioChunkPromotionState(target, ["specialzonelayers"]);
  const scenarioLayers = {
    layers: [{ id: "scenario-zone", memberFeatureIds: ["a", "b"] }],
    activeLayerId: "scenario-zone",
  };

  const firstApply = applyScenarioChunkOptionalLayerState(
    target,
    "specialzonelayers",
    scenarioLayers,
  );
  assert.equal(firstApply.changed, true);
  assert.equal(target.specialZoneLayers, scenarioLayers);
  assert.equal(
    applyScenarioChunkOptionalLayerState(
      target,
      "specialzonelayers",
      scenarioLayers,
    ).changed,
    false,
  );
  assert.equal(Object.hasOwn(target, "specialZonesOverlayDirty"), false);

  const presentSnapshot = captureScenarioChunkPromotionState(target, ["specialzonelayers"]);
  applyScenarioChunkOptionalLayerState(target, "specialzonelayers", {
    layers: [{ id: "replacement-zone", memberFeatureIds: [] }],
    activeLayerId: "replacement-zone",
  });
  restoreScenarioChunkPromotionState(target, [presentSnapshot[0]]);
  assert.equal(target.specialZoneLayers, presentSnapshot[0].stateValue);
  assert.equal(target.specialZoneLayers.activeLayerId, "scenario-zone");
  assert.equal(Object.hasOwn(target, "specialZonesOverlayDirty"), false);

  applyScenarioChunkOptionalLayerState(target, "specialzonelayers", {
    layers: [{ id: "second-replacement-zone", memberFeatureIds: [] }],
    activeLayerId: "second-replacement-zone",
  });
  restoreScenarioChunkPromotionState(target, [...presentSnapshot]);
  assert.equal(target.specialZoneLayers, presentSnapshot[0].stateValue);

  restoreScenarioChunkPromotionState(target, absentSnapshot);
  assert.equal(Object.hasOwn(target, "specialZoneLayers"), false);
});

test("scenario city external-effect application is owned by presentation actions", async () => {
  const { applyScenarioChunkCityExternalEffectState } = await importExpectedModule(
    PRESENTATION_ACTIONS_PATH,
    "scenario presentation actions",
  );
  const previousPayload = { cities: [{ id: "before" }] };
  const nextPayload = { cities: [{ id: "after" }] };
  const target = {
    scenarioCityOverridesData: previousPayload,
    cityLayerRevision: 4,
  };

  assert.equal(applyScenarioChunkCityExternalEffectState(target, nextPayload), true);
  assert.equal(target.scenarioCityOverridesData, nextPayload);
  assert.equal(target.cityLayerRevision, 5);
  assert.equal(applyScenarioChunkCityExternalEffectState(target, undefined), true);
  assert.equal(target.scenarioCityOverridesData, nextPayload);
  assert.equal(target.cityLayerRevision, 6);
});

test("city rollback finalizer restores absent state and exact revision after external effects", async () => {
  const {
    captureScenarioChunkPromotionState,
    restoreScenarioChunkPromotionState,
  } = await importExpectedModule(ACTIVATION_ACTIONS_PATH, "scenario activation actions");
  const { finalizeScenarioChunkCityExternalEffectState } = await importExpectedModule(
    PRESENTATION_ACTIONS_PATH,
    "scenario presentation actions",
  );
  const target = { cityLayerRevision: 4 };
  const snapshot = captureScenarioChunkPromotionState(target, ["cities"]);
  const restoreResult = restoreScenarioChunkPromotionState(target, snapshot);
  const [effect] = restoreResult.externalEffects;

  target.scenarioCityOverridesData = null;
  target.cityLayerRevision = 5;
  assert.equal(finalizeScenarioChunkCityExternalEffectState(target, effect.finalizerToken), true);
  assert.equal(Object.hasOwn(target, "scenarioCityOverridesData"), false);
  assert.equal(target.cityLayerRevision, 4);
  assert.equal(finalizeScenarioChunkCityExternalEffectState(target, null), false);
});

test("promotion root capture and restore preserve explicit presence semantics", async () => {
  const {
    captureScenarioChunkPromotionRootState,
    restoreScenarioChunkPromotionRootState,
  } = await importExpectedModule(PROMOTION_ACTIONS_PATH, "scenario chunk promotion actions");
  const target = {
    scenarioPoliticalChunkData: null,
    scenarioDataGeneration: 8,
    scenarioChunkPromotionRenderLocked: false,
    sentinel: "preserved",
  };
  const snapshot = captureScenarioChunkPromotionRootState(target);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.values), true);
  assert.equal(Object.isFrozen(snapshot.presentKeys), true);
  assert.deepEqual(snapshot.presentKeys, [
    "scenarioPoliticalChunkData",
    "scenarioDataGeneration",
  ]);

  target.defaultRuntimePoliticalTopology = { changed: true };
  target.scenarioPoliticalChunkData = { changed: true };
  target.scenarioPoliticalVisibleChunkData = { changed: true };
  target.scenarioDataGeneration = 9;
  target.scenarioDataGenerationReason = "changed";
  target.scenarioChunkPromotionRenderLocked = true;
  assert.equal(restoreScenarioChunkPromotionRootState(target, snapshot), true);
  assert.equal(Object.hasOwn(target, "defaultRuntimePoliticalTopology"), false);
  assert.equal(target.scenarioPoliticalChunkData, null);
  assert.equal(Object.hasOwn(target, "scenarioPoliticalVisibleChunkData"), false);
  assert.equal(target.scenarioDataGeneration, 8);
  assert.equal(Object.hasOwn(target, "scenarioDataGenerationReason"), false);
  assert.equal(target.scenarioChunkPromotionRenderLocked, true);
  assert.equal(target.sentinel, "preserved");
  assert.throws(
    () => restoreScenarioChunkPromotionRootState(target, { scenarioDataGeneration: 1 }),
    /snapshot must contain values and presentKeys/,
  );
});

test("political payload generation, render lock, and default topology stay atomic on the target", async () => {
  const {
    bumpScenarioChunkDataGenerationState,
    commitScenarioPoliticalChunkPayloadState,
    setDefaultRuntimePoliticalTopologyState,
    setScenarioChunkPromotionRenderLockState,
  } = await importExpectedModule(PROMOTION_ACTIONS_PATH, "scenario chunk promotion actions");
  const target = {
    scenarioDataGeneration: 4,
    scenarioDataGenerationReason: "before",
    sentinel: "preserved",
  };
  const payload = { type: "FeatureCollection", features: [{ id: "all" }] };
  const visiblePayload = { type: "FeatureCollection", features: [{ id: "visible" }] };

  assert.equal(
    commitScenarioPoliticalChunkPayloadState(target, {
      payload,
      visiblePayload,
      generationReason: "zoom-end",
    }),
    5,
  );
  assert.equal(target.scenarioPoliticalChunkData, payload);
  assert.equal(target.scenarioPoliticalVisibleChunkData, visiblePayload);
  assert.equal(target.scenarioDataGeneration, 5);
  assert.equal(target.scenarioDataGenerationReason, "zoom-end");
  assert.equal(bumpScenarioChunkDataGenerationState(target, "optional-only"), 6);
  assert.equal(target.scenarioDataGenerationReason, "optional-only");

  assert.equal(setScenarioChunkPromotionRenderLockState(target, true), true);
  assert.equal(target.scenarioChunkPromotionRenderLocked, true);
  assert.equal(setScenarioChunkPromotionRenderLockState(target, false), false);
  assert.equal(target.scenarioChunkPromotionRenderLocked, false);
  const topology = { objects: { political: {} } };
  assert.equal(setDefaultRuntimePoliticalTopologyState(target, topology), topology);
  assert.equal(target.defaultRuntimePoliticalTopology, topology);
  const synchronizedTopology = { objects: { political: { synchronized: true } } };
  target.runtimePoliticalTopology = synchronizedTopology;
  assert.equal(setDefaultRuntimePoliticalTopologyState(target), undefined);
  assert.equal(target.defaultRuntimePoliticalTopology, synchronizedTopology);
  assert.equal(target.sentinel, "preserved");
});
test("optional payload action preserves bundle identity and rejects non-payload fields", async () => {
  const { commitScenarioOptionalLayerPayloadState } = await import(ACTIVATION_ACTIONS_PATH);
  const { SCENARIO_OPTIONAL_LAYER_CONFIGS } = await import("../js/core/scenario/optional_layer_runtime.js");
  const bundle = { optionalLayerSettledByKey: {}, manifest: { id: "stable" } };
  const target = { scenarioBundleCacheById: { example: bundle } };
  for (const [key, config] of Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)) {
    const payload = { features: [] };
    assert.equal(commitScenarioOptionalLayerPayloadState(target, "example", key, config.bundleField, payload), true);
    assert.equal(target.scenarioBundleCacheById.example, bundle);
    assert.equal(bundle[config.bundleField], payload);
    assert.equal(bundle.optionalLayerSettledByKey[key], true);
    assert.equal(commitScenarioOptionalLayerPayloadState(target, "example", key, config.bundleField, null, false), true);
    assert.equal(Object.hasOwn(bundle.optionalLayerSettledByKey, key), false);
  }
  const before = structuredClone(bundle);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "example", "water", "manifest", null), false);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "__proto__", "water", "waterRegionsPayload", null), false);
  assert.equal(commitScenarioOptionalLayerPayloadState(target, "missing", "water", "waterRegionsPayload", null), false);
  assert.deepEqual(bundle, before);
});
