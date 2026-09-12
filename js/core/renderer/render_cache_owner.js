/**
 * Owns render pass cache / canvas cache / reference transform cache.
 * The owner also owns render-pass dirty/reason invalidation, reference-transform
 * clearing, last-good-frame invalidation, and interaction-composite invalidation
 * primitives. map_renderer.js keeps diagnostics, adjacent render side effects,
 * render pass orchestration, and visible-frame transactions.
 */
import { createRenderCacheValidationScope } from "./render_cache_validation_scope.js";
const LAST_GOOD_FRAME_VISUAL_INVALIDATION_PASS_NAMES = new Set([
  "political", "contextBase",
  "contextScenario",
  "effects",
]);
const RENDER_CACHE_OWNER_SUMMARY_VERSION = 1;

function composeRenderCacheValidationScope(state, ensureRenderPassCacheState, cloneZoomTransform, renderPassNames) {
  const owner = createRenderCacheValidationScope({
    getRoot: () => state.renderPassCache,
    ensure: () => ensureRenderPassCacheState(state, { cloneZoomTransform, renderPassNames }),
  });
  return owner;
}

export function createRenderCacheOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    interactionCompositePassNames = [],
    renderPassNames = [],
    renderPassOverscanRatioPerSide = 0,
    transformedFramePassNames = new Set(),
  } = constants;
  const {
    getContext = () => null,
  } = getters;
  const {
    cloneZoomTransform = (transform) => transform,
    ensureRenderPassCacheState = () => ({}),
    getTransformSignature = () => "",
    getVisibleFrameIdentity = () => ({}),
    areZoomTransformsEquivalent,
    withRenderTarget,
    prepareTargetContext,
  } = helpers;

  function normalizeReason(reason, fallback) {
    return String(reason || fallback);
  }

  function normalizeRenderPassRequest(passNames, { filterKnown = true } = {}) {
    const rawTargetPassNames = Array.isArray(passNames) ? passNames : [passNames];
    const requestedPassNames = rawTargetPassNames.filter(Boolean);
    const expandedTargetPassNames = requestedPassNames.flatMap((passName) => {
      if (passName === "context") {
        return ["contextBase", "contextScenario"];
      }
      return [passName];
    });
    const normalizedPassNames = expandedTargetPassNames.filter((passName) => {
      if (!passName) return false;
      return !filterKnown || renderPassNames.includes(passName);
    });
    const droppedPassNames = filterKnown
      ? expandedTargetPassNames.filter((passName) => passName && !renderPassNames.includes(passName))
      : [];
    return { requestedPassNames, normalizedPassNames, droppedPassNames };
  }

  function hasInteractionCompositePass(passNames) {
    return passNames.some((passName) => interactionCompositePassNames.includes(passName));
  }

  function createMutationSummary({
    operation, reason, changed = false,
    requestedPassNames = [], normalizedPassNames = [], droppedPassNames = [],
    effects = {}, legacy = {},
  }) {
    const referenceTransforms = effects.referenceTransforms || {
      clearedAll: false, sharedReferenceTransformCleared: false, passNames: [],
    };
    const lastGoodFrame = effects.lastGoodFrame || { invalidated: false, reason };
    const interactionComposite = effects.interactionComposite || { invalidated: false, reason };
    const hostFollowUps = effects.hostFollowUps || {
      needsRenderPassDiagnostics: false,
      needsPoliticalPathCacheInvalidation: false,
      needsInteractionBorderSnapshotInvalidation: false,
      needsContinuityMetric: false,
    };
    return {
      version: RENDER_CACHE_OWNER_SUMMARY_VERSION,
      operation,
      reason,
      requestedPassNames,
      normalizedPassNames,
      targetPassNames: normalizedPassNames,
      droppedPassNames,
      changed,
      effects: {
        lastGoodFrame,
        interactionComposite,
        referenceTransforms,
        hostFollowUps,
      },
      ...legacy,
    };
  }

  function getInteractionCompositeEffect(summary, reason) {
    return summary?.effects?.interactionComposite || {
      invalidated: !!summary?.invalidated,
      reason,
    };
  }

  const { getRenderPassCacheState, withValidatedCache } = composeRenderCacheValidationScope(
    state,
    ensureRenderPassCacheState, cloneZoomTransform, renderPassNames,
  );

  function invalidateLastGoodFrame(reason = "visual-invalidation") {
    const cache = getRenderPassCacheState();
    const frame = cache.lastGoodFrame;
    const normalizedReason = normalizeReason(reason, "visual-invalidation");
    if (!frame || typeof frame !== "object" || !frame.valid) {
      return { invalidated: false, reason: normalizedReason };
    }
    frame.stale = true;
    frame.invalidatedAt = Date.now();
    frame.staleReason = normalizedReason;
    frame.reason = normalizedReason;
    return { invalidated: true, reason: normalizedReason };
  }

  function clearLastGoodFrame(reason = "clear") {
    const cache = getRenderPassCacheState();
    const frame = cache.lastGoodFrame;
    const normalizedReason = normalizeReason(reason, "clear");
    if (!frame || typeof frame !== "object") {
      return createMutationSummary({
        operation: "clearLastGoodFrame",
        reason: normalizedReason,
        changed: false,
        effects: {
          lastGoodFrame: { cleared: false, invalidated: false, reason: normalizedReason },
        },
        legacy: { cleared: false },
      });
    }
    frame.valid = false;
    frame.stale = false;
    frame.referenceTransform = null;
    frame.commitKey = null;
    frame.commitKeySignature = "";
    frame.committedFrameIdentity = null;
    frame.metadata = null;
    frame.capturedAt = 0;
    frame.invalidatedAt = Date.now();
    frame.reason = normalizedReason;
    frame.staleReason = "";
    frame.rejectedReason = "";
    frame.scenarioId = "";
    frame.sceneGeneration = 0;
    frame.scenarioDataGeneration = 0;
    frame.selectionVersion = 0;
    frame.contextFlagSignature = "";
    frame.topologyRevision = 0;
    frame.colorRevision = 0;
    frame.dpr = 1;
    frame.pixelWidth = 0;
    frame.pixelHeight = 0;
    frame.politicalDataStage = "unknown";
    frame.fullPoliticalReady = false;
    frame.finePoliticalCacheReady = false;
    return createMutationSummary({
      operation: "clearLastGoodFrame",
      reason: normalizedReason,
      changed: true,
      effects: {
        lastGoodFrame: { cleared: true, invalidated: false, reason: normalizedReason },
      },
      legacy: { cleared: true },
    });
  }

  function invalidateInteractionComposite(reason = "interaction-composite-invalidation") {
    const cache = getRenderPassCacheState();
    const composite = cache.interactionComposite;
    const normalizedReason = normalizeReason(reason, "interaction-composite-invalidation");
    if (!composite || typeof composite !== "object") {
      return createMutationSummary({
        operation: "invalidateInteractionComposite",
        reason: normalizedReason,
        changed: false,
        effects: {
          interactionComposite: { invalidated: false, reason: normalizedReason },
        },
        legacy: { invalidated: false },
      });
    }
    composite.valid = false;
    composite.referenceTransform = null;
    composite.signature = "";
    composite.reason = normalizedReason;
    composite.rejectedReason = normalizedReason;
    return createMutationSummary({
      operation: "invalidateInteractionComposite",
      reason: normalizedReason,
      changed: true,
      effects: {
        interactionComposite: { invalidated: true, reason: normalizedReason },
      },
      legacy: { invalidated: true },
    });
  }

  function invalidateRenderPasses(passNames, reason = "unspecified") {
    const cache = getRenderPassCacheState();
    const normalizedReason = normalizeReason(reason, "unspecified");
    const { requestedPassNames, normalizedPassNames: targetPassNames, droppedPassNames } = normalizeRenderPassRequest(passNames);
    targetPassNames.forEach((passName) => {
      cache.dirty[passName] = true;
      cache.reasons[passName] = normalizedReason;
    });
    const lastGoodFrame = targetPassNames.some((passName) => LAST_GOOD_FRAME_VISUAL_INVALIDATION_PASS_NAMES.has(passName))
      ? invalidateLastGoodFrame(normalizedReason)
      : { invalidated: false, reason: normalizedReason };
    const interactionComposite = hasInteractionCompositePass(targetPassNames)
      ? getInteractionCompositeEffect(invalidateInteractionComposite(normalizedReason), normalizedReason)
      : { invalidated: false, reason: normalizedReason };
    return createMutationSummary({
      operation: "invalidateRenderPasses",
      reason: normalizedReason,
      requestedPassNames,
      normalizedPassNames: targetPassNames,
      droppedPassNames,
      changed: targetPassNames.length > 0,
      effects: {
        lastGoodFrame,
        interactionComposite,
        hostFollowUps: {
          needsRenderPassDiagnostics: targetPassNames.length > 0,
          needsPoliticalPathCacheInvalidation: targetPassNames.includes("political"),
          needsInteractionBorderSnapshotInvalidation: targetPassNames.includes("borders"),
          needsContinuityMetric: !!lastGoodFrame.invalidated,
        },
      },
      legacy: {
        lastGoodFrame,
        lastGoodFrameInvalidated: !!lastGoodFrame.invalidated,
        interactionComposite,
        interactionCompositeInvalidated: !!interactionComposite.invalidated,
      },
    });
  }

  function invalidateAllRenderPasses(reason = "unspecified") {
    return invalidateRenderPasses(renderPassNames, reason);
  }

  function getRenderPassOverscanRatio(passName) {
    return transformedFramePassNames.has(passName)
      ? renderPassOverscanRatioPerSide
      : 0;
  }

  function buildRenderPassLayout(passName) {
    const dpr = Math.max(state.dpr || 1, 1);
    const logicalWidth = Math.max(1, Number(state.width || 1));
    const logicalHeight = Math.max(1, Number(state.height || 1));
    const overscanRatio = getRenderPassOverscanRatio(passName);
    const offsetX = overscanRatio > 0 ? Math.ceil(logicalWidth * overscanRatio) : 0;
    const offsetY = overscanRatio > 0 ? Math.ceil(logicalHeight * overscanRatio) : 0;
    const paddedWidth = logicalWidth + offsetX * 2;
    const paddedHeight = logicalHeight + offsetY * 2;
    return {
      offsetX,
      offsetY,
      logicalWidth,
      logicalHeight,
      paddedWidth,
      paddedHeight,
      pixelWidth: Math.max(1, Math.floor(paddedWidth * dpr)),
      pixelHeight: Math.max(1, Math.floor(paddedHeight * dpr)),
      dpr,
    };
  }

  function getRenderPassLayout(passName) {
    const cache = getRenderPassCacheState();
    const layout = buildRenderPassLayout(passName);
    cache.layouts[passName] = layout;
    return layout;
  }

  function getContextScenarioLayerCacheEntry(layerName) {
    const cache = getRenderPassCacheState();
    const resolvedLayerName = String(layerName || "default").trim() || "default";
    const existing = cache.contextScenarioLayerCache?.[resolvedLayerName];
    if (existing && typeof existing === "object") {
      return existing;
    }
    const next = {
      canvas: null,
      signature: "",
      referenceTransform: null,
      renderedCount: 0,
    };
    cache.contextScenarioLayerCache[resolvedLayerName] = next;
    return next;
  }

  function ensureContextScenarioLayerCanvas(layerName) {
    const layerEntry = getContextScenarioLayerCacheEntry(layerName);
    if (!layerEntry.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      layerEntry.canvas = canvas;
    }
    const layout = getRenderPassLayout("contextScenario");
    if (layerEntry.canvas.width !== layout.pixelWidth || layerEntry.canvas.height !== layout.pixelHeight) {
      layerEntry.canvas.width = layout.pixelWidth;
      layerEntry.canvas.height = layout.pixelHeight;
      clearContextScenarioLayerIdentity(layerEntry);
    }
    return layerEntry.canvas;
  }

  function drawCachedContextScenarioLayer(layerName, currentTransform) {
    const layerEntry = getContextScenarioLayerCacheEntry(layerName);
    const layerCanvas = layerEntry.canvas;
    const referenceTransform = layerEntry.referenceTransform
      ? cloneZoomTransform(layerEntry.referenceTransform)
      : null;
    if (!layerCanvas || !referenceTransform) return false;
    const layout = getRenderPassLayout("contextScenario");
    if (layerCanvas.width !== layout.pixelWidth || layerCanvas.height !== layout.pixelHeight) {
      return false;
    }
    getContext().save();
    getContext().setTransform(1, 0, 0, 1, 0, 0);
    if (areZoomTransformsEquivalent(referenceTransform, currentTransform)) {
      getContext().drawImage(layerCanvas, 0, 0);
      getContext().restore();
      return true;
    }
    const current = cloneZoomTransform(currentTransform);
    const scaleRatio = current.k / Math.max(referenceTransform.k, 0.0001);
    const dx = current.x - (referenceTransform.x * scaleRatio);
    const dy = current.y - (referenceTransform.y * scaleRatio);
    const offsetX = Number(layout?.offsetX || 0);
    const offsetY = Number(layout?.offsetY || 0);
    getContext().translate(
      (dx + offsetX * (1 - scaleRatio)) * state.dpr,
      (dy + offsetY * (1 - scaleRatio)) * state.dpr,
    );
    getContext().scale(scaleRatio, scaleRatio);
    getContext().drawImage(layerCanvas, 0, 0);
    getContext().restore();
    return true;
  }

  function getContextScenarioLayerSnapshot(layerName) {
    const entry = getContextScenarioLayerCacheEntry(layerName);
    return Object.freeze({
      signature: entry.signature,
      renderedCount: entry.renderedCount,
      hasCanvas: !!entry.canvas,
      hasReferenceTransform: !!entry.referenceTransform,
    });
  }

  function clearContextScenarioLayerIdentity(entry) {
    entry.signature = "";
    entry.referenceTransform = null;
    entry.renderedCount = 0;
  }

  function renderContextScenarioLayer(layerName, currentTransform, { draw, getSignature }) {
    const entry = getContextScenarioLayerCacheEntry(layerName);
    const canvas = ensureContextScenarioLayerCanvas(layerName);
    // Rendering can clear or partially paint the canvas before throwing. Publish only on success.
    clearContextScenarioLayerIdentity(entry);
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const layout = getRenderPassLayout("contextScenario");
    let renderedCount = 0;
    withRenderTarget(context, () => {
      const k = prepareTargetContext(context, currentTransform, layout);
      renderedCount = draw(k);
    });
    const signature = getSignature();
    const referenceTransform = cloneZoomTransform(currentTransform);
    entry.signature = signature;
    entry.referenceTransform = referenceTransform;
    entry.renderedCount = renderedCount;
    return renderedCount;
  }

  function resizeRenderPassCanvases(passNames = renderPassNames) {
    const cache = getRenderPassCacheState();
    const names = Array.isArray(passNames) && passNames.length ? passNames : renderPassNames;
    names.forEach((passName) => {
      const layout = getRenderPassLayout(passName);
      const canvas = cache.canvases?.[passName];
      if (!canvas) return;
      if (canvas.width !== layout.pixelWidth) canvas.width = layout.pixelWidth;
      if (canvas.height !== layout.pixelHeight) canvas.height = layout.pixelHeight;
    });
  }

  function ensureRenderPassCanvas(passName) {
    const cache = getRenderPassCacheState();
    if (!cache.canvases[passName]) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      cache.canvases[passName] = canvas;
    }
    resizeRenderPassCanvases([passName]);
    return cache.canvases[passName];
  }

  function getMainTargetCanvasDimensions() {
    const context = getContext();
    const width = Math.max(1, Number(context?.canvas?.width || 1));
    const height = Math.max(1, Number(context?.canvas?.height || 1));
    return { width, height };
  }

  function ensureLastGoodFrameCanvas() {
    const cache = getRenderPassCacheState();
    if (!cache.lastGoodFrame.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      cache.lastGoodFrame.canvas = canvas;
    }
    const { width, height } = getMainTargetCanvasDimensions();
    const canvas = cache.lastGoodFrame.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return cache.lastGoodFrame.canvas;
  }

  function ensureInteractionCompositeCanvas() {
    const cache = getRenderPassCacheState();
    if (!cache.interactionComposite.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      cache.interactionComposite.canvas = canvas;
    }
    const { width, height } = getMainTargetCanvasDimensions();
    const canvas = cache.interactionComposite.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    cache.interactionComposite.layout = {
      pixelWidth: width,
      pixelHeight: height,
      dpr: Math.max(1, Number(state.dpr || 1)),
    };
    return cache.interactionComposite.canvas;
  }

  function ensureCompositeBufferCanvas() {
    const cache = getRenderPassCacheState();
    if (!cache.compositeBuffer?.canvas) {
      cache.compositeBuffer = cache.compositeBuffer && typeof cache.compositeBuffer === "object"
        ? cache.compositeBuffer
        : {};
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      cache.compositeBuffer.canvas = canvas;
    }
    const { width, height } = getMainTargetCanvasDimensions();
    const canvas = cache.compositeBuffer.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return cache.compositeBuffer.canvas;
  }

  function getPassReferenceTransform(passName) {
    const cache = getRenderPassCacheState();
    if (cache.referenceTransforms?.[passName]) {
      return cloneZoomTransform(cache.referenceTransforms[passName]);
    }
    return cache.referenceTransform ? cloneZoomTransform(cache.referenceTransform) : null;
  }

  function setPassReferenceTransform(passName, transform) {
    const cache = getRenderPassCacheState();
    cache.referenceTransforms[passName] = cloneZoomTransform(transform);
    cache.referenceTransform = cloneZoomTransform(transform);
  }

  function getPassFullReferenceTransform(passName) {
    const cache = getRenderPassCacheState();
    const transform = cache.fullReferenceTransforms?.[passName] || null;
    return transform ? cloneZoomTransform(transform) : null;
  }

  function setPassFullReferenceTransform(passName, transform) {
    const cache = getRenderPassCacheState();
    cache.fullReferenceTransforms[passName] = cloneZoomTransform(transform);
  }

  function hasPassFullReferenceTransform(passName) {
    const cache = getRenderPassCacheState();
    return !!cache.fullReferenceTransforms?.[passName];
  }

  function clearPassFullReferenceTransforms(passNames = null) {
    const cache = getRenderPassCacheState();
    if (!passNames) {
      cache.fullReferenceTransforms = {};
      return;
    }
    const rawTargetPassNames = Array.isArray(passNames) ? passNames : [passNames];
    rawTargetPassNames.forEach((passName) => {
      if (!passName) return;
      delete cache.fullReferenceTransforms[passName];
    });
  }

  function clearRenderPassReferenceTransforms(passNames = null) {
    const cache = getRenderPassCacheState();
    const normalizedReason = "clear-reference-transform";
    if (!passNames) {
      const sharedReferenceTransformCleared = !!cache.referenceTransform;
      cache.referenceTransform = null;
      cache.referenceTransforms = {};
      cache.contextScenarioLayerCache = {};
      clearPassFullReferenceTransforms();
      const interactionComposite = getInteractionCompositeEffect(
        invalidateInteractionComposite(normalizedReason),
        normalizedReason,
      );
      const targetPassNames = [...renderPassNames];
      return createMutationSummary({
        operation: "clearRenderPassReferenceTransforms",
        reason: normalizedReason,
        normalizedPassNames: targetPassNames,
        changed: true,
        effects: {
          interactionComposite,
          referenceTransforms: {
            clearedAll: true,
            sharedReferenceTransformCleared,
            passNames: targetPassNames,
          },
          hostFollowUps: {
            needsRenderPassDiagnostics: false,
            needsPoliticalPathCacheInvalidation: true,
            needsInteractionBorderSnapshotInvalidation: true,
            needsContinuityMetric: false,
          },
        },
        legacy: {
          clearedAll: true,
          interactionComposite,
          interactionCompositeInvalidated: !!interactionComposite.invalidated,
          politicalPathCacheInvalidated: true,
          interactionBorderSnapshotInvalidated: true,
        },
      });
    }
    const { requestedPassNames, normalizedPassNames: targetPassNames, droppedPassNames } = normalizeRenderPassRequest(passNames, { filterKnown: false });
    targetPassNames.forEach((passName) => {
      delete cache.referenceTransforms[passName];
    });
    clearPassFullReferenceTransforms(targetPassNames);
    const sharedReferenceTransformCleared = !!cache.referenceTransform;
    cache.referenceTransform = null;
    const interactionComposite = hasInteractionCompositePass(targetPassNames)
      ? getInteractionCompositeEffect(invalidateInteractionComposite(normalizedReason), normalizedReason)
      : { invalidated: false, reason: normalizedReason };
    const needsPoliticalPathCacheInvalidation = targetPassNames.includes("political");
    const needsInteractionBorderSnapshotInvalidation = targetPassNames.includes("borders");
    return createMutationSummary({
      operation: "clearRenderPassReferenceTransforms",
      reason: normalizedReason,
      requestedPassNames,
      normalizedPassNames: targetPassNames,
      droppedPassNames,
      changed: targetPassNames.length > 0 || sharedReferenceTransformCleared,
      effects: {
        interactionComposite,
        referenceTransforms: {
          clearedAll: false,
          sharedReferenceTransformCleared,
          passNames: targetPassNames,
        },
        hostFollowUps: {
          needsRenderPassDiagnostics: false,
          needsPoliticalPathCacheInvalidation,
          needsInteractionBorderSnapshotInvalidation,
          needsContinuityMetric: false,
        },
      },
      legacy: {
        clearedAll: false,
        interactionComposite,
        interactionCompositeInvalidated: !!interactionComposite.invalidated,
        politicalPathCacheInvalidated: needsPoliticalPathCacheInvalidation,
        interactionBorderSnapshotInvalidated: needsInteractionBorderSnapshotInvalidation,
      },
    });
  }

  function getInteractionCompositeSignature(cache = getRenderPassCacheState()) {
    return interactionCompositePassNames.map((passName) => [
      passName,
      String(cache.signatures?.[passName] || ""),
      getTransformSignature(getPassReferenceTransform(passName)),
    ].join("@")).join("|");
  }

  function getInteractionCompositeMismatchReasons(composite, currentTransform, cache = getRenderPassCacheState()) {
    if (!composite?.valid) return ["invalid"];
    if (!composite.canvas || !composite.referenceTransform) return ["missing-canvas-or-transform"];
    const mismatchReasons = [];
    if (composite.signature !== getInteractionCompositeSignature(cache)) {
      mismatchReasons.push("signature-mismatch");
    }
    const identity = getVisibleFrameIdentity(currentTransform);
    if (String(composite.scenarioId || "") !== identity.scenarioId) mismatchReasons.push("scenario-mismatch");
    if (Number(composite.sceneGeneration || 0) !== Number(identity.sceneGeneration || 0)) {
      mismatchReasons.push("scene-generation-mismatch");
    }
    if (Number(composite.scenarioDataGeneration || 0) !== Number(identity.scenarioDataGeneration || 0)) {
      mismatchReasons.push("scenario-data-generation-mismatch");
    }
    if (Number(composite.selectionVersion || 0) !== identity.selectionVersion) mismatchReasons.push("selection-version-mismatch");
    if (String(composite.contextFlagSignature || "") !== identity.contextFlagSignature) mismatchReasons.push("context-flag-mismatch");
    if (Number(composite.topologyRevision || 0) !== identity.topologyRevision) mismatchReasons.push("topology-revision-mismatch");
    if (Math.abs(Number(composite.dpr || 1) - identity.dpr) > 0.01) mismatchReasons.push("dpr-mismatch");
    if (Number(composite.pixelWidth || 0) !== identity.pixelWidth || Number(composite.pixelHeight || 0) !== identity.pixelHeight) {
      mismatchReasons.push("canvas-size-mismatch");
    }
    if (Number(composite.colorRevision || 0) !== identity.colorRevision) mismatchReasons.push("color-revision-mismatch");
    return mismatchReasons;
  }

  function getInteractionCompositeReuseDecision(
    currentTransform,
    cache = getRenderPassCacheState(),
    { allowSelectionTopologyContinuity = false } = {},
  ) {
    const composite = cache.interactionComposite || {};
    const mismatchReasons = getInteractionCompositeMismatchReasons(composite, currentTransform, cache);
    if (!mismatchReasons.length) {
      return { ok: true, mode: "strict", reason: "", reasons: [] };
    }
    const continuityReasons = new Set(["selection-version-mismatch", "topology-revision-mismatch"]);
    const canContinuityReuse = allowSelectionTopologyContinuity
      && mismatchReasons.every((reason) => continuityReasons.has(reason));
    if (canContinuityReuse) {
      return {
        ok: true,
        mode: "continuity",
        reason: mismatchReasons.join(","),
        reasons: mismatchReasons,
      };
    }
    return {
      ok: false,
      mode: "reject",
      reason: mismatchReasons[0] || "unknown",
      reasons: mismatchReasons,
    };
  }

  function canDrawInteractionComposite(currentTransform, cache = getRenderPassCacheState()) {
    const composite = cache.interactionComposite || {};
    const decision = getInteractionCompositeReuseDecision(currentTransform, cache, {
      allowSelectionTopologyContinuity: false,
    });
    if (decision.ok) return true;
    const rejectReason = decision.reason;
    if (composite && typeof composite === "object") {
      composite.rejectedReason = rejectReason;
    }
    if (rejectReason !== "invalid") {
      invalidateInteractionComposite(rejectReason);
    }
    return false;
  }

  return Object.freeze({
    withValidatedCache,
    scenarioLayerCache: Object.freeze({
      getSnapshot: getContextScenarioLayerSnapshot,
      render: renderContextScenarioLayer,
      draw: drawCachedContextScenarioLayer,
    }),
    canDrawInteractionComposite,
    clearLastGoodFrame,
    clearPassFullReferenceTransforms,
    clearRenderPassReferenceTransforms,
    ensureCompositeBufferCanvas,
    ensureInteractionCompositeCanvas,
    ensureLastGoodFrameCanvas,
    ensureRenderPassCanvas,
    getInteractionCompositeSignature,
    getInteractionCompositeReuseDecision,
    getPassFullReferenceTransform,
    getPassReferenceTransform,
    getRenderPassCacheState,
    getRenderPassLayout,
    hasPassFullReferenceTransform,
    invalidateAllRenderPasses,
    invalidateInteractionComposite,
    invalidateRenderPasses,
    resizeRenderPassCanvases,
    setPassFullReferenceTransform,
    setPassReferenceTransform,
  });
}
