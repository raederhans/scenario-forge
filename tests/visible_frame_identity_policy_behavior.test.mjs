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
    dirty: { political: false }, reasons: { political: "refresh" },
    signatures: { political: "political::ocean-fill:#101820" },
  };
  const input = { colors: 1, context: { canvas: { width: 800, height: 600 } },
    reference: { x: 0, y: 0, k: 1 }, fullReference: null, beforeSnapshot: () => {} };
  const calls = [];
  const policy = createVisibleFrameIdentityPolicy(state, {
    ensureCurrentSceneSnapshot(reason) { calls.push(reason); input.beforeSnapshot(); },
    getRenderPassCacheState() { calls.push("cache"); return cache; },
    getResolvedColorCountForSceneSnapshot: () => input.colors,
    rendererSurfaceHost: { getContext: () => input.context },
    cloneZoomTransform: (transform) => ({ ...transform }),
    getTransformBucketSignature: (transform) => `zoom:${transform.k}`,
    getRenderPassSignature: () => "political::ocean-fill:#101820",
    getCachedPoliticalPassStaticSignature: (signature) => String(signature || ""),
    getOceanBaseFillColor: () => "#101820",
    getPassReferenceTransform: () => input.reference,
    getPassFullReferenceTransform: () => input.fullReference,
    areZoomTransformsEquivalent: (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.k === b.k,
  });
  return { state, cache, input, calls, policy };
}

test("readiness follows live data and cache generations after snapshot preparation", () => {
  const { state, cache, input, calls, policy } = fixture();
  assert.equal(policy.getVisibleFrameIdentity().politicalDataStage, "coarse");
  cache.politicalPassDataStage = "fine";
  cache.politicalPassFineCacheReady = true;
  assert.equal(policy.getVisibleFrameIdentity().finePoliticalCacheReady, true);
  input.beforeSnapshot = () => { state.sceneGeneration = 9; };
  calls.length = 0;
  const stale = policy.getVisibleFrameIdentity();
  assert.deepEqual(calls, ["visible-frame-identity", "cache"]);
  assert.equal(stale.sceneGeneration, 9);
  assert.equal(stale.politicalDataStage, "data-ready");
  assert.equal(stale.finePoliticalCacheReady, false);
  for (const remove of [() => { input.colors = 0; }, () => { state.landData = null; }, () => { state.scenarioPoliticalChunkData = null; }, () => { state.activeScenarioId = ""; }]) {
    remove();
    assert.equal(policy.getVisibleFrameIdentity().fullPoliticalReady, false);
    assert.equal(policy.getVisibleFrameIdentity().politicalDataStage, "not-ready");
    input.colors = 1; state.landData = { features: [{}] }; state.scenarioPoliticalChunkData = { features: [{}] };
  }
});

test("identity observes replaced state and surface handles and clones its transform", () => {
  const { state, input, policy } = fixture();
  const first = policy.getVisibleFrameIdentity();
  state.runtimeChunkLoadState = { selectionVersion: 12 };
  state.showStrategicResourceMarkers = true;
  state.scenarioStrategicValuesRevision = 7;
  state.strategicChoroplethMetric = "oil";
  state.contextLayerRevision = 8;
  input.context = { canvas: { width: 1600, height: 900 } };
  const next = policy.getVisibleFrameIdentity();
  assert.equal(next.selectionVersion, 12);
  assert.deepEqual([next.pixelWidth, next.pixelHeight, next.dpr], [1600, 900, 2]);
  for (const flag of ["strategic-resources:on", "strategic-rev:7", "strategic-metric:oil", "context-rev:8"]) assert.ok(next.contextFlagSignature.includes(flag));
  assert.notEqual(next.contextFlagSignature, first.contextFlagSignature);
  next.transform.k = 4;
  assert.equal(state.zoomTransform.k, 1);
  assert.equal(fixture().policy.getVisibleFrameIdentity().selectionVersion, 4);
  input.context = null; state.dpr = 0; state.runtimeChunkLoadState = null;
  const empty = policy.getVisibleFrameIdentity();
  assert.deepEqual([empty.pixelWidth, empty.pixelHeight, empty.dpr, empty.selectionVersion], [1, 1, 1, 0]);
  assert.ok(Object.isFrozen(policy));
});

test("committed identity separates stable keys and isolated metadata while preserving overrides", () => {
  const { policy, cache, state } = fixture();
  const first = policy.getCommittedFrameIdentity();
  const next = policy.getCommittedFrameIdentity(undefined, { reason: "edit", politicalDataStage: "custom" });
  assert.equal(policy.getCommittedFrameKeySignature(first.commitKey), policy.getCommittedFrameKeySignature(next.commitKey));
  assert.equal(next.metadata.politicalDataStage, "custom");
  assert.equal(next.metadata.reason, "edit");
  first.metadata.dirtyReasons.political = "changed";
  first.metadata.resourcesReady.politicalPassCurrent = false;
  first.metadata.referenceTransform.k = 10;
  first.commitKey.selectionVersion = -1;
  assert.equal(cache.reasons.political, "refresh");
  assert.equal(next.metadata.dirtyReasons.political, "refresh");
  assert.equal(next.metadata.resourcesReady.politicalPassCurrent, true);
  assert.equal(state.zoomTransform.k, 1);
  assert.equal(next.commitKey.selectionVersion, 4);
  assert.match(policy.getCommittedFrameKeySignature(next.commitKey), /::2\.00::800::600$/);
});

test("first political frame gates preserve dirty, signature and coarse versus fine reference order", () => {
  for (const [mutate, reason, expected] of [
    [() => {}, "exact-frame", ""],
    [() => {}, "base-visible-fallback", "base-visible-fallback"],
    [() => {}, undefined, "visible-frame-before-current-political-frame"],
    [({ state }) => { state.activeScenarioId = " "; }, "exact-frame", ""],
    [({ cache }) => { cache.dirty.political = true; cache.signatures.political = "bad"; }, "exact-frame", "dirty-political-pass"],
    [({ cache }) => { cache.signatures.political = "political::ocean-fill:#fff"; }, "exact-frame", "stale-ocean-fill"],
    [({ cache }) => { cache.signatures.political = "old::ocean-fill:#101820"; }, "exact-frame", "stale-political-signature"],
    [({ input }) => { input.reference = null; }, "exact-frame", "stale-political-reference-transform"],
    [({ input }) => { input.reference.k = 2; }, "exact-frame", "stale-political-reference-transform"],
    [({ cache }) => { cache.politicalPassDataStage = "fine"; cache.politicalPassFineCacheReady = true; }, "exact-frame", "stale-political-full-reference-transform"],
    [({ cache, input }) => { cache.politicalPassDataStage = "fine"; cache.politicalPassFineCacheReady = true; input.fullReference = { x: 0, y: 0, k: 1 }; }, "exact-frame", ""],
  ]) {
    const current = fixture(); mutate(current);
    assert.equal(current.policy.getFirstVisiblePoliticalFrameBlockReason(reason), expected);
  }
});

test("base fallback is available only before first paint or without land features", () => {
  const { state, policy } = fixture();
  assert.equal(policy.canDrawBaseVisibleFrameFallback(), false);
  state.firstVisibleFramePainted = false;
  assert.equal(policy.canDrawBaseVisibleFrameFallback(), true);
  state.firstVisibleFramePainted = true;
  for (const land of [null, {}, { features: [] }]) {
    state.landData = land;
    assert.equal(policy.canDrawBaseVisibleFrameFallback(), true);
  }
});
