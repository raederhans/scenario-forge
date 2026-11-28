import assert from "node:assert/strict";
import test from "node:test";
import { createVisibleFrameIdentityPolicy } from "../js/core/renderer/visible_frame_identity_policy.js";

function fixture() {
  const state = {
    activeScenarioId: "scenario", sceneGeneration: 2, scenarioDataGeneration: 3,
    runtimeChunkLoadState: { selectionVersion: 4 }, topologyRevision: 5, colorRevision: 6,
    dpr: 2, zoomTransform: { x: 0, y: 0, k: 1 },
    scenarioPoliticalChunkData: { features: [{}] }, landData: { features: [{}] },
    firstVisibleFramePainted: true,
  };
  const cache = {
    politicalPassSceneGeneration: 2, politicalPassScenarioDataGeneration: 3,
    politicalPassDataStage: "coarse", politicalPassFineCacheReady: false,
  };
  const input = { beforeSnapshot: () => {} };
  const policy = createVisibleFrameIdentityPolicy(state, {
    ensureCurrentSceneSnapshot: () => input.beforeSnapshot(),
    getRenderPassCacheState: () => cache,
    getResolvedColorCountForSceneSnapshot: () => 1,
    rendererSurfaceHost: { getContext: () => ({ canvas: { width: 800, height: 600 } }) },
    cloneZoomTransform: (transform) => ({ ...transform }),
    getTransformBucketSignature: (transform) => `zoom:${transform.k}`,
  });
  return { state, cache, input, policy };
}

test("readiness follows live data and cache generations after snapshot preparation", () => {
  const { state, cache, input, policy } = fixture();
  assert.equal(policy.getVisibleFrameIdentity().politicalDataStage, "coarse");
  cache.politicalPassDataStage = "fine";
  cache.politicalPassFineCacheReady = true;
  assert.equal(policy.getVisibleFrameIdentity().finePoliticalCacheReady, true);
  input.beforeSnapshot = () => { state.scenarioDataGeneration++; };
  const stale = policy.getVisibleFrameIdentity();
  assert.equal(stale.politicalDataStage, "data-ready");
  assert.equal(stale.finePoliticalCacheReady, false);
});

test("base fallback is available before first paint", () => {
  const { state, policy } = fixture();
  assert.equal(policy.canDrawBaseVisibleFrameFallback(), false);
  state.firstVisibleFramePainted = false;
  assert.equal(policy.canDrawBaseVisibleFrameFallback(), true);
});
