import assert from "node:assert/strict";
import test from "node:test";

import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";

test("synchronous validated cache scopes share one validation, revalidate replacements and end on throw", () => {
  const state = { renderPassCache: {} };
  let validations = 0;
  const owner = createRenderCacheOwner({ state, helpers: { ensureRenderPassCacheState: (target) => {
    validations += 1;
    target.renderPassCache ||= {};
    return target.renderPassCache;
  } } });
  assert.equal(owner.withValidatedCache((cache) => {
    assert.equal(owner.getRenderPassCacheState(), cache);
    owner.withValidatedCache((nested) => assert.equal(nested, cache));
    assert.equal(validations, 1);
    state.renderPassCache = {};
    assert.equal(owner.getRenderPassCacheState(), state.renderPassCache);
    assert.equal(validations, 2);
    assert.equal(owner.getRenderPassCacheState(), state.renderPassCache);
    return "frame";
  }), "frame");
  owner.getRenderPassCacheState();
  owner.getRenderPassCacheState();
  assert.equal(validations, 4, "no memoization survives the synchronous frame");
  assert.throws(() => owner.withValidatedCache(() => { throw Error("draw failed"); }), /draw failed/);
  const afterThrow = validations;
  owner.getRenderPassCacheState();
  assert.equal(validations, afterThrow + 1);
  assert.throws(() => owner.withValidatedCache(async () => {}), /synchronous/);
  assert.throws(() => owner.withValidatedCache(() => Promise.resolve()), /asynchronous/);
  const afterPromise = validations;
  owner.getRenderPassCacheState();
  assert.equal(validations, afterPromise + 1);
});
import {
  INTERACTION_COMPOSITE_PASS_NAMES,
  RENDER_PASS_NAMES,
} from "../js/core/map_renderer/render_pass_catalog.js";

function cloneZoomTransform(transform) {
  return transform && typeof transform === "object" ? { ...transform } : transform;
}

function createRenderPassCache(overrides = {}) {
  return {
    referenceTransform: { k: 1, x: 0, y: 0 },
    referenceTransforms: {},
    fullReferenceTransforms: {},
    canvases: {},
    layouts: {},
    signatures: {},
    contextScenarioLayerCache: {},
    dirty: Object.fromEntries(RENDER_PASS_NAMES.map((passName) => [passName, false])),
    reasons: Object.fromEntries(RENDER_PASS_NAMES.map((passName) => [passName, "clean"])),
    partialPoliticalDirtyIds: new Set(["feature-a"]),
    lastGoodFrame: {
      canvas: {},
      referenceTransform: { k: 1, x: 0, y: 0 },
      commitKey: { scenarioId: "base", selectionVersion: 1 },
      commitKeySignature: "base:1",
      committedFrameIdentity: { status: "committed" },
      metadata: { paintSource: "test" },
      valid: true,
      stale: false,
      capturedAt: 123,
      invalidatedAt: 0,
      reason: "frame",
      staleReason: "",
      rejectedReason: "",
      scenarioId: "base",
      sceneGeneration: 2,
      scenarioDataGeneration: 3,
      selectionVersion: 1,
      contextFlagSignature: "flags",
      topologyRevision: 4,
      colorRevision: 5,
      dpr: 2,
      pixelWidth: 800,
      pixelHeight: 600,
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
    },
    interactionComposite: {
      canvas: {},
      layout: null,
      referenceTransform: { k: 1, x: 0, y: 0 },
      signature: "old-signature",
      valid: true,
      capturedAt: 456,
      reason: "interaction",
      rejectedReason: "",
      scenarioId: "base",
      sceneGeneration: 2,
      scenarioDataGeneration: 3,
      selectionVersion: 1,
      contextFlagSignature: "flags",
      topologyRevision: 4,
      dpr: 2,
      pixelWidth: 800,
      pixelHeight: 600,
      colorRevision: 5,
      transformBucket: "z1",
      politicalDataStage: "fine",
      fullPoliticalReady: true,
      finePoliticalCacheReady: true,
    },
    ...overrides,
  };
}

function createOwner({
  cache = createRenderPassCache(),
  renderPassNames = RENDER_PASS_NAMES,
  identity = {},
  getTransformSignature = (transform) => transform ? `${transform.k}:${transform.x}:${transform.y}` : "none",
  getterOverrides = {},
  helperOverrides = {},
} = {}) {
  const state = { renderPassCache: cache };
  return {
    cache,
    owner: createRenderCacheOwner({
      state,
      constants: {
        interactionCompositePassNames: INTERACTION_COMPOSITE_PASS_NAMES,
        renderPassNames,
      },
      getters: {
        ...getterOverrides,
      },
      helpers: {
        cloneZoomTransform,
        ensureRenderPassCacheState: () => cache,
        getTransformSignature,
        getVisibleFrameIdentity: () => ({
          scenarioId: "base",
          sceneGeneration: 2,
          scenarioDataGeneration: 3,
          selectionVersion: 1,
          contextFlagSignature: "flags",
          topologyRevision: 4,
          dpr: 2,
          pixelWidth: 800,
          pixelHeight: 600,
          colorRevision: 5,
          ...identity,
        }),
        ...helperOverrides,
      },
    }),
  };
}

test("main-target canvas caches retain their identities while tracking the live target size", () => {
  const lastGoodFrameCanvas = { width: 1, height: 1 };
  const interactionCompositeCanvas = { width: 2, height: 2 };
  const compositeBufferCanvas = { width: 3, height: 3 };
  const cache = createRenderPassCache({
    lastGoodFrame: { canvas: lastGoodFrameCanvas },
    interactionComposite: { canvas: interactionCompositeCanvas },
    compositeBuffer: { canvas: compositeBufferCanvas },
  });
  const { owner } = createOwner({
    cache,
    getterOverrides: {
      getContext: () => ({ canvas: { width: 960, height: 540 } }),
    },
  });

  assert.equal(owner.ensureLastGoodFrameCanvas(), lastGoodFrameCanvas);
  assert.equal(owner.ensureInteractionCompositeCanvas(), interactionCompositeCanvas);
  assert.equal(owner.ensureCompositeBufferCanvas(), compositeBufferCanvas);
  assert.deepEqual(
    [lastGoodFrameCanvas, interactionCompositeCanvas, compositeBufferCanvas]
      .map(({ width, height }) => ({ width, height })),
    [
      { width: 960, height: 540 },
      { width: 960, height: 540 },
      { width: 960, height: 540 },
    ],
  );
  assert.deepEqual(cache.interactionComposite.layout, {
    pixelWidth: 960,
    pixelHeight: 540,
    dpr: 1,
  });
});

function assertSummaryEnvelope(result, operation, reason) {
  assert.equal(result.version, 1);
  assert.equal(result.operation, operation);
  assert.equal(result.reason, reason);
  assert.ok(Array.isArray(result.requestedPassNames));
  assert.ok(Array.isArray(result.normalizedPassNames));
  assert.ok(Array.isArray(result.targetPassNames));
  assert.ok(Array.isArray(result.droppedPassNames));
  assert.equal(result.targetPassNames, result.normalizedPassNames);
  assert.equal(typeof result.changed, "boolean");
  assert.equal(typeof result.effects, "object");
  assert.equal(typeof result.effects.hostFollowUps, "object");
}

test("invalidateRenderPasses normalizes string and array inputs", () => {
  const { cache, owner } = createOwner();

  const political = owner.invalidateRenderPasses("political", "unit-political");
  assertSummaryEnvelope(political, "invalidateRenderPasses", "unit-political");
  assert.deepEqual(political.requestedPassNames, ["political"]);
  assert.deepEqual(political.normalizedPassNames, ["political"]);
  assert.deepEqual(political.targetPassNames, ["political"]);
  assert.deepEqual(political.droppedPassNames, []);
  assert.equal(political.effects.lastGoodFrame.invalidated, true);
  assert.equal(political.effects.interactionComposite.invalidated, true);
  assert.equal(political.effects.hostFollowUps.needsRenderPassDiagnostics, true);
  assert.equal(political.effects.hostFollowUps.needsPoliticalPathCacheInvalidation, true);
  assert.equal(political.effects.hostFollowUps.needsContinuityMetric, true);
  assert.equal(cache.dirty.political, true);
  assert.equal(cache.reasons.political, "unit-political");
  assert.equal(cache.lastGoodFrame.stale, true);
  assert.equal(cache.lastGoodFrame.staleReason, "unit-political");
  assert.equal(cache.interactionComposite.valid, false);

  cache.interactionComposite.valid = true;
  const mixed = owner.invalidateRenderPasses(["context", "labels", "", "unknown"], "unit-array");
  assertSummaryEnvelope(mixed, "invalidateRenderPasses", "unit-array");
  assert.deepEqual(mixed.requestedPassNames, ["context", "labels", "unknown"]);
  assert.deepEqual(mixed.normalizedPassNames, ["contextBase", "contextScenario", "labels"]);
  assert.deepEqual(mixed.targetPassNames, ["contextBase", "contextScenario", "labels"]);
  assert.deepEqual(mixed.droppedPassNames, ["unknown"]);
  assert.equal(cache.dirty.contextBase, true);
  assert.equal(cache.reasons.contextScenario, "unit-array");
  assert.equal(cache.dirty.labels, true);
  assert.equal(cache.reasons.unknown, undefined);
});

test("invalidateAllRenderPasses uses the configured render pass names", () => {
  const renderPassNames = ["background", "political"];
  const { cache, owner } = createOwner({ renderPassNames });

  const result = owner.invalidateAllRenderPasses("unit-all");

  assertSummaryEnvelope(result, "invalidateRenderPasses", "unit-all");
  assert.deepEqual(result.requestedPassNames, renderPassNames);
  assert.deepEqual(result.normalizedPassNames, renderPassNames);
  assert.deepEqual(result.targetPassNames, renderPassNames);
  assert.equal(cache.dirty.background, true);
  assert.equal(cache.dirty.political, true);
  assert.equal(cache.dirty.labels, false);
  assert.equal(cache.reasons.background, "unit-all");
});

test("clearRenderPassReferenceTransforms clears all or selected reference transforms", () => {
  const cache = createRenderPassCache({
    referenceTransform: { k: 2, x: 10, y: 20 },
    referenceTransforms: {
      political: { k: 2, x: 10, y: 20 },
      labels: { k: 3, x: 30, y: 40 },
    },
    fullReferenceTransforms: {
      political: { k: 2, x: 10, y: 20 },
      labels: { k: 3, x: 30, y: 40 },
    },
    contextScenarioLayerCache: { scenario: true },
  });
  const { owner } = createOwner({ cache });

  const selected = owner.clearRenderPassReferenceTransforms(["political"]);
  assertSummaryEnvelope(selected, "clearRenderPassReferenceTransforms", "clear-reference-transform");
  assert.deepEqual(selected.requestedPassNames, ["political"]);
  assert.deepEqual(selected.normalizedPassNames, ["political"]);
  assert.deepEqual(selected.targetPassNames, ["political"]);
  assert.deepEqual(selected.droppedPassNames, []);
  assert.equal(selected.effects.referenceTransforms.clearedAll, false);
  assert.equal(selected.effects.referenceTransforms.sharedReferenceTransformCleared, true);
  assert.deepEqual(selected.effects.referenceTransforms.passNames, ["political"]);
  assert.equal(selected.effects.hostFollowUps.needsPoliticalPathCacheInvalidation, true);
  assert.equal(cache.referenceTransform, null);
  assert.equal(cache.referenceTransforms.political, undefined);
  assert.deepEqual(cache.referenceTransforms.labels, { k: 3, x: 30, y: 40 });
  assert.equal(cache.fullReferenceTransforms.political, undefined);
  assert.deepEqual(cache.fullReferenceTransforms.labels, { k: 3, x: 30, y: 40 });
  assert.equal(selected.politicalPathCacheInvalidated, true);
  assert.equal(selected.interactionCompositeInvalidated, true);

  const all = owner.clearRenderPassReferenceTransforms();
  assertSummaryEnvelope(all, "clearRenderPassReferenceTransforms", "clear-reference-transform");
  assert.equal(all.clearedAll, true);
  assert.equal(all.effects.referenceTransforms.clearedAll, true);
  assert.equal(all.effects.referenceTransforms.sharedReferenceTransformCleared, false);
  assert.deepEqual(all.effects.referenceTransforms.passNames, RENDER_PASS_NAMES);
  assert.equal(all.effects.hostFollowUps.needsInteractionBorderSnapshotInvalidation, true);
  assert.deepEqual(cache.referenceTransforms, {});
  assert.deepEqual(cache.fullReferenceTransforms, {});
  assert.deepEqual(cache.contextScenarioLayerCache, {});
  assert.equal(cache.interactionComposite.valid, false);
});

test("invalidateInteractionComposite resets validity and reason fields", () => {
  const { cache, owner } = createOwner();

  const result = owner.invalidateInteractionComposite("unit-composite");

  assertSummaryEnvelope(result, "invalidateInteractionComposite", "unit-composite");
  assert.equal(result.invalidated, true);
  assert.equal(result.effects.interactionComposite.invalidated, true);
  assert.equal(cache.interactionComposite.valid, false);
  assert.equal(cache.interactionComposite.referenceTransform, null);
  assert.equal(cache.interactionComposite.signature, "");
  assert.equal(cache.interactionComposite.reason, "unit-composite");
  assert.equal(cache.interactionComposite.rejectedReason, "unit-composite");
});

test("clearLastGoodFrame resets frame identity and retains clear reason", () => {
  const { cache, owner } = createOwner();

  const result = owner.clearLastGoodFrame("unit-clear");

  assertSummaryEnvelope(result, "clearLastGoodFrame", "unit-clear");
  assert.equal(result.cleared, true);
  assert.equal(result.effects.lastGoodFrame.cleared, true);
  assert.equal(cache.lastGoodFrame.valid, false);
  assert.equal(cache.lastGoodFrame.stale, false);
  assert.equal(cache.lastGoodFrame.referenceTransform, null);
  assert.equal(cache.lastGoodFrame.commitKey, null);
  assert.equal(cache.lastGoodFrame.commitKeySignature, "");
  assert.equal(cache.lastGoodFrame.committedFrameIdentity, null);
  assert.equal(cache.lastGoodFrame.metadata, null);
  assert.equal(cache.lastGoodFrame.reason, "unit-clear");
  assert.equal(cache.lastGoodFrame.scenarioId, "");
  assert.equal(cache.lastGoodFrame.sceneGeneration, 0);
  assert.equal(cache.lastGoodFrame.scenarioDataGeneration, 0);
  assert.equal(cache.lastGoodFrame.politicalDataStage, "unknown");
  assert.equal(cache.lastGoodFrame.fullPoliticalReady, false);
});

test("canDrawInteractionComposite uses owner-local invalidation on mismatch", () => {
  let helperCalled = false;
  const cache = createRenderPassCache({
    referenceTransforms: {
      political: { k: 1, x: 0, y: 0 },
      contextScenario: { k: 1, x: 0, y: 0 },
    },
    signatures: {
      political: "new-political",
      contextScenario: "new-context",
    },
  });
  const { owner } = createOwner({
    cache,
    helperOverrides: {
      invalidateInteractionComposite: () => {
        helperCalled = true;
      },
    },
  });

  const canDraw = owner.canDrawInteractionComposite({ k: 1, x: 0, y: 0 }, cache);

  assert.equal(canDraw, false);
  assert.equal(helperCalled, false);
  assert.equal(cache.interactionComposite.valid, false);
  assert.equal(cache.interactionComposite.reason, "signature-mismatch");
  assert.equal(cache.interactionComposite.rejectedReason, "signature-mismatch");
});

test("factory freezes its exact public API", () => {
  const { owner } = createOwner();

  assert.equal(Object.isFrozen(owner), true);
});
