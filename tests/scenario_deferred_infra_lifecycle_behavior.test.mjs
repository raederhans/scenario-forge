import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioRefreshRuntime } from "../js/core/map_renderer/scenario_refresh_runtime.js";

function createFixture(overrides = {}) {
  const state = {
    activeScenarioId: "tno_1962", runtimeChunkLoadState: { selectionVersion: 1 },
    activeScenarioMeshPack: { meshes: {} }, activeInteractionRecoveryTaskKey: "",
    interactionInfrastructureReady: true, interactionInfrastructureStage: "full-ready",
  };
  const calls = [];
  const scheduled = [];
  const deps = { runtimeState: state };
  for (const name of ["buildIndex", "buildSpatialIndexChunked", "rebuildPoliticalLandCollections",
    "rebuildRuntimeDerivedState", "rebuildPrimaryPoliticalDerivedState", "scheduleSecondarySpatialIndexBuild",
    "scheduleHitCanvasBuildIfNeeded", "ensureSovereigntyState", "refreshScenarioOpeningOwnerBorders",
    "invalidateBorderCache", "updateDynamicBorderStatusUI", "updateSpecialZonesPaths", "renderSpecialZoneEditorOverlay",
    "render", "recordRenderPerfMetric", "recordInteractionRecoveryTaskMetric", "markRendererTopologyChanged",
    "clearDeferredInternalBorderMeshCaches", "scheduleDeferredHeavyBorderMeshes", "resetScenarioWaterCacheAdaptiveState",
    "invalidateRenderPasses", "markAllOverlaysDirty", "updateZoomTranslateExtent", "clearLastGoodFrame",
    "clearRenderPassReferenceTransforms", "invalidateInteractionComposite"]) {
    deps[name] = (...args) => { calls.push([name, ...args]); };
  }
  deps.setInteractionInfrastructureState = (stage, options) => {
    calls.push(["setInteractionInfrastructureState", stage, options]);
    state.interactionInfrastructureReady = options.ready;
  };
  deps.beginInteractionRecoveryTask = (key) => {
    if (state.activeInteractionRecoveryTaskKey) return false;
    state.activeInteractionRecoveryTaskKey = key;
    return true;
  };
  deps.endInteractionRecoveryTask = (key) => {
    calls.push(["endInteractionRecoveryTask", key]);
    if (state.activeInteractionRecoveryTaskKey === key) state.activeInteractionRecoveryTaskKey = "";
  };
  deps.isInteractionRecoverySettled = () => !state.activeInteractionRecoveryTaskKey;
  deps.scheduleDeferredWork = (callback) => {
    const handle = { callback, cancelled: false };
    scheduled.push(handle);
    return handle;
  };
  deps.cancelDeferredWork = (handle) => { if (handle) handle.cancelled = true; };
  deps.yieldToMain = () => Promise.resolve();
  deps.nowMs = () => 100;
  deps.syncScenarioSecondaryRegionIndexes = () => false;
  deps.isUsableMesh = () => false;
  const runtime = createScenarioRefreshRuntime({ ...deps, ...overrides });
  const promote = () => runtime.refreshMapDataForScenarioChunkPromotion({ suppressRender: true });
  return { state, calls, scheduled, runtime, promote };
}

test("complete shared political payload with legal interactive filtering skips full restoration", async () => {
  const leaf = { id: "leaf" }, shell = { id: "shell", properties: { interactive: false } };
  const full = { features: [leaf, shell] };
  const { state, runtime, calls, scheduled } = createFixture({
    buildInteractiveLandData: (collection) => ({ features: collection.features.filter((feature) => feature.properties?.interactive !== false) }),
  });
  state.scenarioPoliticalChunkData = full;
  state.scenarioPoliticalVisibleChunkData = full;
  state.landDataFull = full;
  state.landData = { features: [leaf] };
  state.colors = { leaf: "#112233", shell: "#112233" };
  runtime.refreshMapDataForScenarioChunkPromotion({ suppressRender: true,
    changedLayerKeys: ["political"], hasPoliticalPayloadChange: true });
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion.completePoliticalDerivedStateReady, true);
  assert.equal(await scheduled.at(-1).callback(), true);
  assert.ok(!calls.some(([name]) => name === "rebuildPoliticalLandCollections" || name === "rebuildRuntimeDerivedState"));
  const metric = calls.find(([method, name]) => method === "recordRenderPerfMetric" && name === "chunkPromotionDeferredInfraMs");
  assert.ok(metric);
  assert.equal(metric[3].restoredFullPoliticalChunkData, false);
});

test("obsolete deferred callback cannot release or execute a replacement handle", async () => {
  const { runtime, scheduled, state } = createFixture();
  runtime.scheduleDeferredScenarioChunkPromotionInfraRefresh();
  const old = scheduled.at(-1);
  runtime.resetDeferredScenarioChunkPromotionState();
  runtime.scheduleDeferredScenarioChunkPromotionInfraRefresh();
  const replacement = scheduled.at(-1);
  await old.callback();
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  runtime.cancelDeferredScenarioChunkPromotionInfraRefresh();
  assert.equal(replacement.cancelled, true, "old callback must not drop the replacement handle");
});

test("deferred infra failure terminates its pending state and keeps the error observable", async () => {
  const failure = new Error("spatial build failed");
  const { state, calls, runtime } = createFixture({
    buildSpatialIndexChunked: async () => { throw failure; },
  });
  state.runtimeChunkLoadState.pendingInfraPromotion = { reason: "test" };
  await assert.rejects(runtime.runDeferredScenarioChunkPromotionInfraRefresh(), /spatial build failed/);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(state.interactionInfrastructureReady, false, "failed infrastructure must not publish ready");
  assert.ok(calls.some(([method, name, , details]) => method === "recordRenderPerfMetric"
    && name === "scenarioChunkPromotionInfraFailure"
    && details.error === failure.message));
});

test("old infra continuation cannot publish or finish a new run after reset reuses its version", async () => {
  const yields = [];
  const { state, calls, runtime, promote } = createFixture({
    yieldToMain: () => new Promise(resolve => yields.push(resolve)),
  });
  promote();
  const oldRun = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  assert.equal(yields.length, 1);
  runtime.resetDeferredScenarioChunkPromotionState();
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  promote();
  const newPending = state.runtimeChunkLoadState.pendingInfraPromotion;
  const newRun = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  assert.equal(yields.length, 2);
  calls.length = 0;
  yields[0]();
  assert.equal(await oldRun, false);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, newPending);
  assert.equal(state.activeInteractionRecoveryTaskKey, "scenario-chunk-promotion-infra");
  assert.equal(calls.length, 0, "stale run must neither mutate nor publish diagnostics");
  yields[1]();
  assert.equal(await newRun, true);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
});

test("cancelling an active infra run releases its marker and does not publish after its yield", async () => {
  let release;
  const { state, calls, runtime, promote } = createFixture({
    yieldToMain: () => new Promise(resolve => { release = resolve; }),
  });
  promote();
  const run = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  runtime.cancelDeferredScenarioChunkPromotionInfraRefresh();
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  assert.equal(state.interactionInfrastructureReady, false);
  calls.length = 0;
  release();
  assert.equal(await run, false);
  assert.equal(calls.length, 0);
});

test("scheduled rejection is observed once and a fresh promotion can recover", async (t) => {
  let fail = true;
  const warnings = t.mock.method(console, "warn", () => {});
  const { state, runtime, scheduled, promote } = createFixture({
    buildSpatialIndexChunked: async () => { if (fail) throw new Error("infra failure"); },
  });
  promote();
  assert.equal(await scheduled.at(-1).callback(), false);
  assert.equal(warnings.mock.callCount(), 1);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  assert.equal(state.interactionInfrastructureReady, false);
  fail = false;
  promote();
  assert.equal(await scheduled.at(-1).callback(), true);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, null);
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  assert.equal(state.interactionInfrastructureReady, true);
});

test("cancel releases its active marker even after the scenario load state changes", async () => {
  let release;
  const { state, runtime, promote } = createFixture({
    yieldToMain: () => new Promise(resolve => { release = resolve; }),
  });
  promote();
  const run = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  state.runtimeChunkLoadState = {};
  state.interactionInfrastructureReady = true;
  runtime.cancelDeferredScenarioChunkPromotionInfraRefresh();
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  assert.equal(state.interactionInfrastructureReady, true);
  release();
  assert.equal(await run, false);
});

test("an awaited spatial result for a replaced load state cannot update the new scenario", async () => {
  let release;
  const { state, calls, runtime, promote } = createFixture({
    buildSpatialIndexChunked: () => new Promise(resolve => { release = resolve; }),
  });
  promote();
  const run = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  await Promise.resolve();
  const newPending = { reason: "new-scenario" };
  state.runtimeChunkLoadState = { pendingInfraPromotion: newPending };
  state.activeScenarioId = "hoi4_1939";
  calls.length = 0;
  release();
  assert.equal(await run, false);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, newPending);
  assert.deepEqual(calls.map(([name]) => name), ["endInteractionRecoveryTask"]);
  assert.equal(state.activeInteractionRecoveryTaskKey, "");
  promote();
  const nextRun = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 2 });
  await Promise.resolve();
  release();
  assert.equal(await nextRun, true);
});
