import assert from "node:assert/strict";
import test from "node:test";
import { createScenarioRefreshRuntime } from "../js/core/map_renderer/scenario_refresh_runtime.js";

function createFixture(overrides = {}) {
  const state = {
    activeScenarioId: "tno_1962", runtimeChunkLoadState: { selectionVersion: 1 },
    activeScenarioMeshPack: { meshes: {} }, activeInteractionRecoveryTaskKey: "",
    interactionInfrastructureReady: true, interactionInfrastructureStage: "full-ready",
  };
  const deps = { runtimeState: state };
  for (const name of ["buildIndex", "buildSpatialIndexChunked", "rebuildPoliticalLandCollections",
    "rebuildRuntimeDerivedState", "rebuildPrimaryPoliticalDerivedState", "scheduleSecondarySpatialIndexBuild",
    "scheduleHitCanvasBuildIfNeeded", "ensureSovereigntyState", "refreshScenarioOpeningOwnerBorders",
    "invalidateBorderCache", "updateDynamicBorderStatusUI", "updateSpecialZonesPaths", "renderSpecialZoneEditorOverlay",
    "render", "recordRenderPerfMetric", "recordInteractionRecoveryTaskMetric", "markRendererTopologyChanged",
    "clearDeferredInternalBorderMeshCaches", "scheduleDeferredHeavyBorderMeshes", "resetScenarioWaterCacheAdaptiveState",
    "invalidateRenderPasses", "markAllOverlaysDirty", "updateZoomTranslateExtent", "clearLastGoodFrame",
    "clearRenderPassReferenceTransforms", "invalidateInteractionComposite"]) {
    deps[name] = () => {};
  }
  deps.setInteractionInfrastructureState = (stage, options) => {
    state.interactionInfrastructureReady = options.ready;
  };
  deps.beginInteractionRecoveryTask = (key) => {
    if (state.activeInteractionRecoveryTaskKey) return false;
    state.activeInteractionRecoveryTaskKey = key;
    return true;
  };
  deps.endInteractionRecoveryTask = (key) => {
    if (state.activeInteractionRecoveryTaskKey === key) state.activeInteractionRecoveryTaskKey = "";
  };
  deps.isInteractionRecoverySettled = () => !state.activeInteractionRecoveryTaskKey;
  deps.scheduleDeferredWork = callback => ({ callback });
  deps.cancelDeferredWork = (handle) => { if (handle) handle.cancelled = true; };
  deps.yieldToMain = () => Promise.resolve();
  deps.nowMs = () => 100;
  deps.syncScenarioSecondaryRegionIndexes = () => false;
  deps.isUsableMesh = () => false;
  const runtime = createScenarioRefreshRuntime({ ...deps, ...overrides });
  const promote = () => runtime.refreshMapDataForScenarioChunkPromotion({ suppressRender: true });
  return { state, runtime, promote };
}

test("an awaited spatial result for a replaced load state cannot update the new scenario", async () => {
  let release;
  const { state, runtime, promote } = createFixture({
    buildSpatialIndexChunked: () => new Promise(resolve => { release = resolve; }),
  });
  promote();
  const run = runtime.runDeferredScenarioChunkPromotionInfraRefresh({ promotionVersion: 1 });
  await Promise.resolve();
  const newPending = { reason: "new-scenario" };
  state.runtimeChunkLoadState = { pendingInfraPromotion: newPending };
  state.activeScenarioId = "hoi4_1939";
  release();
  assert.equal(await run, false);
  assert.equal(state.runtimeChunkLoadState.pendingInfraPromotion, newPending);
});
