import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import { createPoliticalPathCacheOwner } from "../js/core/renderer/political_path_cache_owner.js";

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
  stateOverrides = {},
  constantOverrides = {},
} = {}) {
  const state = { renderPassCache: cache, width: 400, height: 300, dpr: 2, ...stateOverrides };
  return {
    cache,
    owner: createRenderCacheOwner({
      state,
      constants: {
        interactionCompositePassNames: INTERACTION_COMPOSITE_PASS_NAMES,
        renderPassNames,
        ...constantOverrides,
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

test("interaction composite retains padded pass pixels while main-target snapshots keep viewport dimensions", () => {
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
    stateOverrides: { width: 960, height: 540, dpr: 1 },
    constantOverrides: { renderPassOverscanRatioPerSide: 0.15, transformedFramePassNames: new Set(INTERACTION_COMPOSITE_PASS_NAMES) },
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
      { width: 1248, height: 702 },
      { width: 960, height: 540 },
    ],
  );
  assert.deepEqual(cache.interactionComposite.layout, {
    offsetX: 144, offsetY: 81, logicalWidth: 960, logicalHeight: 540,
    paddedWidth: 1248, paddedHeight: 702,
    pixelWidth: 1248,
    pixelHeight: 702,
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


function createSurfaceOwner({
  cache = createRenderPassCache(),
  getterOverrides = {},
  budget = createRuntimeResourceBudget(),
} = {}) {
  const state = { renderPassCache: cache, width: 20, height: 10, dpr: 1 };
  const owner = createRenderCacheOwner({
    state,
    resourceBudget: budget,
    constants: {
      renderPassNames: RENDER_PASS_NAMES,
      interactionCompositePassNames: INTERACTION_COMPOSITE_PASS_NAMES,
    },
    getters: {
      getContext: () => ({ canvas: { width: state.width, height: state.height } }),
      ...getterOverrides,
    },
    helpers: {
      ensureRenderPassCacheState: (target) => target.renderPassCache,
      cloneZoomTransform,
      getTransformSignature: (transform) => JSON.stringify(transform),
      getVisibleFrameIdentity: () => ({
        scenarioId: "base", sceneGeneration: 2, scenarioDataGeneration: 3, selectionVersion: 1,
        contextFlagSignature: "flags", topologyRevision: 4, colorRevision: 5, dpr: 1,
        pixelWidth: state.width, pixelHeight: state.height,
      }),
      areZoomTransformsEquivalent: (left, right) => JSON.stringify(left) === JSON.stringify(right),
      withRenderTarget: (_context, callback) => callback(),
      prepareTargetContext: () => 1,
    },
  });
  return { owner, state, budget };
}

function withSurfaceDocument(callback) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => {
    assert.equal(tag, "canvas");
    return { width: 1, height: 1, getContext: () => ({}) };
  } };
  try { return callback(); } finally { globalThis.document = previous; }
}

test("surface accounting covers every internal canvas and deduplicates repeated references", () => {
  const shared = { width: 10, height: 5 };
  const layer = { width: 8, height: 4 };
  const lastGood = { width: 6, height: 3 };
  const interaction = { width: 4, height: 2 };
  const buffer = { width: 2, height: 1 };
  const border = { width: 3, height: 2 };
  const cache = createRenderPassCache({
    canvases: { political: shared, contextBase: shared },
    contextScenarioLayerCache: { water: { canvas: layer }, duplicate: { canvas: shared } },
    lastGoodFrame: { canvas: lastGood },
    interactionComposite: { canvas: interaction },
    compositeBuffer: { canvas: buffer },
    borderSnapshot: { canvas: border },
  });
  const { owner, budget } = createSurfaceOwner({ cache });
  assert.equal(owner.syncSurfaceResourceAccounting(), (50 + 32 + 18 + 8 + 2 + 6) * 4);
  assert.equal(budget.snapshot().categories.bitmaps, 464);
  assert.equal(budget.snapshot().ownerCount, 1);
  const revision = budget.snapshot().revision;
  owner.syncSurfaceResourceAccounting();
  assert.equal(budget.snapshot().revision, revision);
  shared.width = 20;
  assert.equal(owner.syncSurfaceResourceAccounting(), 664);
  const exportCanvas = { width: 100, height: 100 };
  cache.exportCanvas = exportCanvas;
  assert.equal(owner.releaseSurfaceCache(cache), true);
  assert.deepEqual([shared, layer, lastGood, interaction, buffer, border].map((canvas) => [canvas.width, canvas.height]),
    [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual([exportCanvas.width, exportCanvas.height], [100, 100]);
  assert.equal(budget.snapshot().estimatedBytes, 0);
  assert.equal(budget.snapshot().ownerCount, 0);
});

test("allocation and resizing keep pass, scenario, snapshot and composite estimates current", () => withSurfaceDocument(() => {
  const cache = createRenderPassCache({
    lastGoodFrame: { canvas: null }, interactionComposite: { canvas: null }, compositeBuffer: { canvas: null },
  });
  const { owner, state, budget } = createSurfaceOwner({ cache });
  owner.ensureRenderPassCanvas("political");
  assert.equal(budget.snapshot().categories.bitmaps, 800);
  owner.scenarioLayerCache.render("water", { x: 0, y: 0, k: 1 }, { draw: () => 1, getSignature: () => "water" });
  assert.equal(budget.snapshot().categories.bitmaps, 1600);
  owner.ensureLastGoodFrameCanvas();
  owner.ensureInteractionCompositeCanvas();
  owner.ensureCompositeBufferCanvas();
  assert.equal(budget.snapshot().categories.bitmaps, 4000);
  state.width = 40;
  owner.resizeRenderPassCanvases(["political"]);
  assert.equal(budget.snapshot().categories.bitmaps, 4800);
  owner.scenarioLayerCache.render("water", { x: 0, y: 0, k: 1 }, { draw: () => 1, getSignature: () => "resized" });
  owner.ensureLastGoodFrameCanvas();
  owner.ensureInteractionCompositeCanvas();
  owner.ensureCompositeBufferCanvas();
  assert.equal(budget.snapshot().categories.bitmaps, 8000);
  const oldWater = cache.contextScenarioLayerCache.water.canvas;
  owner.clearRenderPassReferenceTransforms();
  assert.deepEqual([oldWater.width, oldWater.height], [0, 0]);
  assert.equal(budget.snapshot().categories.bitmaps, 6400);
}));

test("inactive passes release backing and identity, then reactivate with a fresh dirty surface", () => withSurfaceDocument(() => {
  const political = { width: 20, height: 10 };
  const scenario = { width: 20, height: 10 };
  const water = { width: 20, height: 10 };
  const cache = createRenderPassCache({
    canvases: { political, contextScenario: scenario },
    layouts: { political: {}, contextScenario: {} },
    signatures: { political: "political", contextScenario: "scenario" },
    referenceTransforms: { political: { k: 1 }, contextScenario: { k: 1 } },
    fullReferenceTransforms: { contextScenario: { k: 1 } },
    contextScenarioLayerCache: { water: { canvas: water, signature: "water", referenceTransform: { k: 1 } } },
  });
  const { owner, budget } = createSurfaceOwner({ cache });
  owner.syncSurfaceResourceAccounting();
  assert.equal(owner.releaseInactivePassSurfaces(["political"]), true);
  assert.deepEqual([scenario.width, scenario.height, water.width, water.height], [0, 0, 0, 0]);
  assert.equal(cache.canvases.political, political);
  assert.equal(cache.canvases.contextScenario, undefined);
  assert.equal(cache.signatures.contextScenario, undefined);
  assert.equal(cache.layouts.contextScenario, undefined);
  assert.equal(cache.referenceTransforms.contextScenario, undefined);
  assert.equal(cache.fullReferenceTransforms.contextScenario, undefined);
  assert.deepEqual(cache.contextScenarioLayerCache, {});
  assert.equal(cache.dirty.contextScenario, true);
  assert.equal(cache.reasons.contextScenario, "pass-inactive");
  assert.equal(cache.interactionComposite.valid, false);
  assert.equal(cache.interactionComposite.reason, "pass-inactive");
  assert.equal(cache.lastGoodFrame.stale, true);
  assert.equal(budget.snapshot().categories.bitmaps, 800);
  assert.equal(owner.releaseInactivePassSurfaces(["political"]), false);
  assert.equal(owner.releaseInactivePassSurfaces(["political", "contextScenario"]), false);
  const reactivated = owner.ensureRenderPassCanvas("contextScenario");
  assert.notEqual(reactivated, scenario);
  assert.deepEqual([reactivated.width, reactivated.height], [20, 10]);
  assert.equal(cache.dirty.contextScenario, true, "allocating a surface does not publish rendered coverage");
  assert.equal(budget.snapshot().categories.bitmaps, 1600);
}));

test("root replacement releases old surfaces while protecting aliases in the new root", () => {
  const shared = { width: 20, height: 10 };
  const stale = { width: 10, height: 10 };
  const old = createRenderPassCache({ canvases: { political: shared, contextBase: stale } });
  const { owner, state, budget } = createSurfaceOwner({ cache: old });
  owner.syncSurfaceResourceAccounting();
  const replacement = createRenderPassCache({ canvases: { political: shared } });
  state.renderPassCache = replacement;
  assert.equal(owner.getRenderPassCacheState(), replacement);
  assert.deepEqual([stale.width, stale.height], [0, 0]);
  assert.deepEqual([shared.width, shared.height], [20, 10]);
  assert.deepEqual(old.canvases, {});
  assert.equal(budget.snapshot().categories.bitmaps, 800);
  state.renderPassCache = createRenderPassCache();
  owner.syncSurfaceResourceAccounting();
  assert.deepEqual([shared.width, shared.height], [0, 0]);
  assert.equal(budget.snapshot().estimatedBytes, 0);
});

test("nested export retention keeps visible surfaces accounted through restore and thrown rendering", () => {
  const visibleCanvas = { width: 20, height: 10 };
  const visible = createRenderPassCache({ canvases: { political: visibleCanvas } });
  const { owner, state, budget } = createSurfaceOwner({ cache: visible });
  owner.syncSurfaceResourceAccounting();
  const endOuter = owner.retainSurfaceCacheForScope(visible);
  const endInner = owner.retainSurfaceCacheForScope(visible);
  const temporaryCanvas = { width: 40, height: 20 };
  const temporary = createRenderPassCache({ canvases: { political: temporaryCanvas } });
  const exportCanvas = { width: 40, height: 20 };
  assert.throws(() => {
    try {
      state.renderPassCache = temporary;
      assert.equal(owner.syncSurfaceResourceAccounting(), 4000);
      assert.equal(owner.releaseSurfaceCache(visible), false, "retained visible root cannot be released by a temporary root cleanup");
      endInner();
      assert.equal(budget.snapshot().categories.bitmaps, 4000);
      throw Error("export draw failed");
    } finally {
      state.renderPassCache = visible;
      owner.releaseSurfaceCache(temporary);
      endOuter();
      endOuter();
    }
  }, /export draw failed/);
  assert.deepEqual([visibleCanvas.width, visibleCanvas.height], [20, 10]);
  assert.deepEqual([temporaryCanvas.width, temporaryCanvas.height], [0, 0]);
  assert.deepEqual([exportCanvas.width, exportCanvas.height], [40, 20]);
  assert.equal(budget.snapshot().categories.bitmaps, 800);
  assert.equal(state.renderPassCache, visible);
});

test("ending an abandoned retention scope releases the former root exactly once", () => {
  const visibleCanvas = { width: 20, height: 10 };
  const visible = createRenderPassCache({ canvases: { political: visibleCanvas } });
  const { owner, state, budget } = createSurfaceOwner({ cache: visible });
  const end = owner.retainSurfaceCacheForScope(visible);
  state.renderPassCache = createRenderPassCache();
  owner.syncSurfaceResourceAccounting();
  assert.equal(budget.snapshot().categories.bitmaps, 800);
  end();
  end();
  assert.deepEqual([visibleCanvas.width, visibleCanvas.height], [0, 0]);
  assert.equal(budget.snapshot().estimatedBytes, 0);
});

test("root release clears only unshared political path LRUs and preserves visible export aliases", () => {
  const visible = createRenderPassCache();
  const { owner, state, budget } = createSurfaceOwner({ cache: visible });
  const pathOwner = createPoliticalPathCacheOwner({}, {
    rendererSurfaceHost: { getProjection: () => null },
    getRenderPassCacheState: () => state.renderPassCache,
    cloneZoomTransform: (transform) => ({ ...transform }),
    recordRenderPerfMetric: () => {},
    resourceBudget: budget,
  });
  const addPathCacheEntry = (key) => {
    const handle = pathOwner.getPoliticalPathCacheHandle(
      { k: 1, x: 0, y: 0 },
      { resetIfMismatch: true },
    );
    handle.map.set(key, { path: {}, estimatedBytes: 512 });
    return handle.map;
  };

  const visiblePaths = addPathCacheEntry("visible");
  assert.equal(budget.snapshot().categories.projectedPaths, 512);
  const endVisibleRetention = owner.retainSurfaceCacheForScope(visible);

  const temporary = createRenderPassCache();
  state.renderPassCache = temporary;
  owner.syncSurfaceResourceAccounting();
  const temporaryPaths = addPathCacheEntry("temporary");
  assert.notEqual(temporaryPaths, visiblePaths);
  assert.equal(budget.snapshot().categories.projectedPaths, 1024);

  state.renderPassCache = visible;
  owner.syncSurfaceResourceAccounting();
  assert.equal(temporaryPaths.size, 0, "restoring the visible root releases the abandoned export LRU");
  assert.equal(visiblePaths.size, 1);
  assert.equal(budget.snapshot().categories.projectedPaths, 512);

  const visibleAlias = createRenderPassCache({ politicalPathCache: visiblePaths });
  state.renderPassCache = visibleAlias;
  owner.syncSurfaceResourceAccounting();
  assert.equal(visiblePaths.size, 1, "a new root alias cannot clear paths still held by the visible root");
  state.renderPassCache = visible;
  owner.syncSurfaceResourceAccounting();
  endVisibleRetention();
  assert.equal(budget.snapshot().categories.projectedPaths, 512);

  state.renderPassCache = createRenderPassCache();
  owner.syncSurfaceResourceAccounting();
  assert.equal(visiblePaths.size, 0, "replacing the final root clears its unshared LRU");
  assert.equal(budget.snapshot().categories.projectedPaths, undefined);
});

test("interaction signatures and invalidation use the current active pass list", () => {
  let active = ["political"];
  const cache = createRenderPassCache({
    signatures: { political: "P", contextScenario: "S" },
    referenceTransforms: { political: { k: 1, x: 0, y: 0 }, contextScenario: { k: 1, x: 0, y: 0 } },
  });
  const { owner } = createSurfaceOwner({ cache, getterOverrides: {
    getActiveInteractionCompositePassNames: () => active,
  } });
  const transform = { x: 0, y: 0, k: 1 };
  Object.assign(cache.interactionComposite, { canvas: { width: 20, height: 10 }, dpr: 1, pixelWidth: 20, pixelHeight: 10, referenceTransform: transform });
  const signature = owner.getInteractionCompositeSignature();
  cache.interactionComposite.signature = signature;
  assert.equal(owner.canDrawInteractionComposite(transform), true);
  assert.ok(signature.startsWith("political@P@"));
  assert.equal(signature.includes("contextScenario"), false);
  owner.invalidateRenderPasses(["contextScenario"], "inactive-data");
  assert.equal(cache.interactionComposite.valid, true);
  cache.signatures.contextScenario = "S2";
  assert.equal(owner.getInteractionCompositeSignature(), signature);
  assert.equal(owner.canDrawInteractionComposite(transform), true, "inactive signatures and dirty bits do not reject active composite reuse");
  active = ["political", "contextScenario"];
  assert.ok(owner.getInteractionCompositeSignature().includes("contextScenario@S2@"));
  assert.equal(owner.canDrawInteractionComposite(transform), false, "enabling a pass changes the composite signature");
  cache.interactionComposite.valid = true;
  owner.invalidateRenderPasses(["contextScenario"], "active-data");
  assert.equal(cache.interactionComposite.valid, false);
});

test("zero-sized composite backings cannot claim explicit viewport coverage", () => {
  const transform = { x: 0, y: 0, k: 1 };
  const cache = createRenderPassCache();
  const { owner } = createSurfaceOwner({ cache });
  Object.assign(cache.interactionComposite, {
    canvas: { width: 0, height: 0 },
    coverage: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    referenceTransform: transform, dpr: 1, pixelWidth: 20, pixelHeight: 10,
  });
  cache.interactionComposite.signature = owner.getInteractionCompositeSignature();
  assert.equal(owner.canDrawInteractionComposite(transform), false);
  assert.equal(cache.interactionComposite.reason, "coverage-mismatch");
});
