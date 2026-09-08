// Renderer runtime state defaults.
import {
  setInteractionInfrastructureStateFields as setInteractionInfrastructureActionStateFields,
} from "./actions/renderer_interaction_actions.js";
import {
  commitProjectedBoundsCacheState,
  commitRenderPassCacheState,
} from "./actions/renderer_cache_actions.js";
import {
  normalizeRenderPassCacheState,
} from "../renderer/render_pass_cache_state_normalizer.js";
import {
  captureExactAfterSettleControllerState as captureExactAfterSettleControllerActionState,
  ensureExactAfterSettleControllerState as ensureExactAfterSettleControllerActionState,
  isExactAfterSettleControllerActiveState as isExactAfterSettleControllerActiveActionState,
  isExactAfterSettleGenerationCurrentState as isExactAfterSettleGenerationCurrentActionState,
  resetExactAfterSettleControllerState as resetExactAfterSettleControllerActionState,
} from "./actions/renderer_exact_refresh_actions.js";
// 这里收口 map_renderer / sidebar 共享的运行时默认 shape，
// 避免 defer 标记、pass cache、诊断缓存和交互基础设施状态再次漂移。

export function createDefaultRendererInfrastructureState() {
  return {
    interactionInfrastructureReady: true,
    interactionInfrastructureBuildInFlight: false,
    interactionInfrastructureStage: "idle",
  };
}

export function createDefaultIntensityFieldToolState() {
  return {
    active: false,
    channelId: "physicalAtlas",
    subMode: "paint",
    brushRadiusDeg: 3,
    brushStrength: 1,
    selectedPointId: "",
  };
}

export function createDefaultExactAfterSettleControllerState() {
  return {
    generation: 0,
    phase: "idle",
    startedAt: 0,
    scheduledAt: 0,
    applyStartedAt: 0,
    applyFinishedAt: 0,
    scenarioId: "",
    selectionVersion: 0,
    topologyRevision: 0,
    dpr: 1,
    pixelWidth: 0,
    pixelHeight: 0,
    colorRevision: 0,
    contextFlagSignature: "",
    zoomToken: 0,
    transformBucket: "",
    pendingPlan: null,
    reason: "init",
  };
}

export function ensureSceneSnapshotState(target) {
  if (!target || typeof target !== "object") {
    return {
      sceneGeneration: 0,
      scenarioDataGeneration: 0,
      sceneScenarioId: "",
      sceneGenerationReason: "init",
      scenarioDataGenerationReason: "init",
    };
  }
  target.sceneGeneration = Math.max(0, Number(target.sceneGeneration || 0));
  target.scenarioDataGeneration = Math.max(0, Number(target.scenarioDataGeneration || 0));
  target.sceneScenarioId = String(target.sceneScenarioId || "");
  target.sceneGenerationReason = String(target.sceneGenerationReason || "init");
  target.scenarioDataGenerationReason = String(target.scenarioDataGenerationReason || "init");
  return target;
}

export function bumpSceneGenerationState(target, reason = "scene-update") {
  const state = ensureSceneSnapshotState(target);
  state.sceneGeneration = Math.max(0, Number(state.sceneGeneration || 0)) + 1;
  state.sceneGenerationReason = String(reason || "scene-update");
  return state.sceneGeneration;
}

export function bumpScenarioDataGenerationState(target, reason = "scenario-data-update") {
  const state = ensureSceneSnapshotState(target);
  state.scenarioDataGeneration = Math.max(0, Number(state.scenarioDataGeneration || 0)) + 1;
  state.scenarioDataGenerationReason = String(reason || "scenario-data-update");
  return state.scenarioDataGeneration;
}

export function createDefaultRenderPassCacheState() {
  return {
    referenceTransform: null,
    referenceTransforms: {},
    fullReferenceTransforms: {},
    canvases: {},
    layouts: {},
    signatures: {},
    contextScenarioLayerCache: {},
    compositeBuffer: {
      canvas: null,
    },
    borderSnapshot: {
      canvas: null,
      layout: null,
      referenceTransform: null,
      valid: false,
      reason: "init",
    },
    lastGoodFrame: {
      canvas: null,
      referenceTransform: null,
      commitKey: null,
      commitKeySignature: "",
      committedFrameIdentity: null,
      metadata: null,
      valid: false,
      stale: false,
      capturedAt: 0,
      invalidatedAt: 0,
      reason: "init",
      staleReason: "",
      rejectedReason: "",
      scenarioId: "",
      selectionVersion: 0,
      contextFlagSignature: "",
      topologyRevision: 0,
      dpr: 1,
      pixelWidth: 0,
      pixelHeight: 0,
      sceneGeneration: 0,
      scenarioDataGeneration: 0,
      politicalDataStage: "unknown",
      fullPoliticalReady: false,
      finePoliticalCacheReady: false,
    },
    interactionComposite: {
      canvas: null,
      layout: null,
      referenceTransform: null,
      signature: "",
      valid: false,
      capturedAt: 0,
      reason: "init",
      scenarioId: "",
      selectionVersion: 0,
      contextFlagSignature: "",
      topologyRevision: 0,
      dpr: 1,
      pixelWidth: 0,
      pixelHeight: 0,
      colorRevision: 0,
      transformBucket: "",
      sceneGeneration: 0,
      scenarioDataGeneration: 0,
      politicalDataStage: "unknown",
      fullPoliticalReady: false,
      finePoliticalCacheReady: false,
    },
    partialPoliticalDirtyIds: new Set(),
    pendingPoliticalColorEditIds: new Set(),
    pendingPoliticalColorEditRevision: -1,
    pendingPoliticalColorEditScenarioId: "",
    pendingPoliticalColorEditReason: "",
    pendingPoliticalColorEditStartedAt: 0,
    pendingPoliticalColorEditInputLabel: "",
    pendingPoliticalColorEditFirstPixelRecorded: false,
    pendingPoliticalColorEditFirstPixelPaintSource: "",
    pendingPoliticalPatchOverlayTransformSignature: "",
    politicalPassSceneGeneration: 0,
    politicalPassScenarioDataGeneration: 0,
    politicalPassDataStage: "unknown",
    politicalPassFullReady: false,
    politicalPassFineCacheReady: false,
    politicalPathCache: new Map(),
    politicalPathCacheSignature: "",
    politicalPathCacheTransform: null,
    politicalPathWarmupQueue: [],
    politicalPathWarmupHandle: null,
    politicalPathWarmupSignature: "",
    politicalPathWarmupReason: "",
    contextScenarioReasonMismatchSignature: "",
    dirty: {
      background: true,
      political: true,
      hgoPreview: true,
      effects: true,
      contextBase: true,
      contextScenario: true,
      dayNight: true,
      borders: true,
    },
    reasons: {
      background: "init",
      political: "init",
      hgoPreview: "init",
      effects: "init",
      contextBase: "init",
      contextScenario: "init",
      dayNight: "init",
      borders: "init",
    },
    counters: {
      frames: 0,
      composites: 0,
      interactionCompositeBuilds: 0,
      interactionCompositeReuses: 0,
      interactionCompositeContinuityReuses: 0,
      transformedFrames: 0,
      drawCanvas: 0,
      backgroundPassRenders: 0,
      physicalBasePassRenders: 0,
      politicalPassRenders: 0,
      hgoPreviewPassRenders: 0,
      effectsPassRenders: 0,
      contextPassRenders: 0,
      contextBasePassRenders: 0,
      contextScenarioPassRenders: 0,
      contextScenarioReuseCount: 0,
      contextScenarioExactRefreshCount: 0,
      dayNightPassRenders: 0,
      borderPassRenders: 0,
      borderSnapshotRenders: 0,
      borderSnapshotReuses: 0,
      labelPassRenders: 0,
      hitCanvasRenders: 0,
      interactionHitCandidateCount: 0,
      interactionHitCanvasPreferredCount: 0,
      interactionSecondaryIndexDemandCount: 0,
      dynamicBorderRebuilds: 0,
      politicalPartialRepaints: 0,
      politicalPartialFallbacks: 0,
      politicalPartialCandidateCount: 0,
      politicalPartialPathCacheMisses: 0,
      politicalPartialPathBuild: 0,
      fillPatchFirstPixelCount: 0,
      politicalPathCacheBuild: 0,
      politicalPathWarmupBuild: 0,
      politicalPathWarmupSlices: 0,
      politicalPathWarmupCancels: 0,
      politicalRasterWorkerTimeoutCount: 0,
      politicalRasterWorkerRecycleCount: 0,
      politicalRasterWorkerStaleResponseCount: 0,
      blackFrameCount: 0,
      lastGoodFrameReuses: 0,
      continuityFrameReuses: 0,
      missingVisibleFrameCount: 0,
      missingVisibleFrameSkippedDuringInteraction: 0,
      waterAdaptiveStateResetCount: 0,
      contextScenarioReasonMismatchWarnings: 0,
    },
    lastFrame: null,
    lastAction: "",
    lastActionDurationMs: 0,
    lastActionAt: 0,
    perfOverlayEnabled: false,
    overlayElement: null,
  };
}

export function createDefaultSidebarPerfState() {
  return {
    counters: {
      fullListRenders: 0,
      rowRefreshes: 0,
      inspectorRenders: 0,
      presetTreeRenders: 0,
      legendRenders: 0,
    },
  };
}

export function createDefaultProjectedBoundsCacheState() {
  return {
    projectedBoundsById: new Map(),
    sphericalFeatureDiagnosticsById: new Map(),
  };
}

export function createDefaultProjectedBoundsDiagnostics() {
  return {
    total: 0,
    byGeometryType: {},
    byReason: {},
  };
}

export function createDefaultRendererTransientRuntimeState() {
  return {
    dprStage: "idle",
    dprInteractiveScale: 0.72,
    dprLastStageSwitchAt: 0,
    TINY_AREA: 6,
    MOUSE_THROTTLE_MS: 16,
    lastMouseMoveTime: 0,
    hitCanvasDirty: true,
    hitCanvasTopologyRevision: 0,
    deferHitCanvasBuild: false,
    hitCanvasBuildScheduled: null,
    stagedMapDataToken: 0,
    stagedContextBaseHandle: null,
    stagedHitCanvasHandle: null,
    deferContextBasePass: false,
    deferContextBaseEnhancements: false,
    deferExactAfterSettle: false,
    exactAfterSettleHandle: null,
    exactAfterSettleController: createDefaultExactAfterSettleControllerState(),
    zoomRenderScheduled: false,
    pendingZoomTransform: null,
    zoomGestureStartTransform: null,
    zoomGestureScaleDelta: 0,
    zoomGestureEndedAt: 0,
    adaptiveSettleProfile: null,
    pendingExactPoliticalFastFrame: false,
    activeInteractionRecoveryTaskKey: "",
    activeInteractionRecoveryTaskStartedAt: 0,
    debugCountryCoverage: null,
    isInteracting: false,
    renderPhase: "idle",
    politicalRecoveryQuality: "progressive",
    firstVisibleFramePainted: false,
    phaseEnteredAt: 0,
    renderPhaseTimerId: null,
    pendingDayNightRefresh: false,
    colorRevision: 0,
    topologyRevision: 0,
    sceneGeneration: 0,
    scenarioDataGeneration: 0,
    sceneScenarioId: "",
    sceneGenerationReason: "init",
    scenarioDataGenerationReason: "init",
    renderPassCache: createDefaultRenderPassCacheState(),
    sidebarPerf: createDefaultSidebarPerfState(),
    ...createDefaultProjectedBoundsCacheState(),
  };
}

export function applyRendererSurfaceBridgeState(target, handles = {}) {
  if (!target || typeof target !== "object") {
    return false;
  }
  const source = handles && typeof handles === "object" ? handles : {};
  target.colorCanvas = source.mapCanvas ?? null;
  target.canvasLayers = source.canvasLayers ?? null;
  target.lineCanvas = null;
  target.colorCtx = source.context ?? null;
  target.politicalPatchCanvas = source.politicalPatchCanvas ?? null;
  target.politicalPatchCtx = source.politicalPatchContext ?? null;
  target.interactionOverlayCanvas = source.interactionOverlayCanvas ?? null;
  target.interactionOverlayCtx = source.interactionOverlayContext ?? null;
  target.lineCtx = null;
  return target;
}

export function ensureRenderPassCacheState(
  target,
  {
    cloneZoomTransform = (value) => value,
    renderPassNames = [],
  } = {},
) {
  const defaults = createDefaultRenderPassCacheState();
  if (!target || typeof target !== "object") return defaults;
  const renderPassCacheDescriptor = Object.getOwnPropertyDescriptor(
    target,
    "renderPassCache",
  );
  if (
    !renderPassCacheDescriptor
    || !Object.hasOwn(renderPassCacheDescriptor, "value")
  ) {
    commitRenderPassCacheState(target, defaults);
  }
  const renderPassCache = normalizeRenderPassCacheState(target.renderPassCache, {
    defaults,
    cloneZoomTransform,
    renderPassNames,
  });
  if (renderPassCache !== target.renderPassCache) {
    commitRenderPassCacheState(target, renderPassCache);
  }
  return renderPassCache;
}

export function ensureExactAfterSettleControllerState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultExactAfterSettleControllerState();
  }
  ensureExactAfterSettleControllerActionState(target);
  return captureExactAfterSettleControllerActionState(target);
}

export function resetExactAfterSettleControllerState(target, { reason = "reset", generation = null } = {}) {
  if (!target || typeof target !== "object") {
    const controller = createDefaultExactAfterSettleControllerState();
    if (generation !== null && Number(controller.generation || 0) !== Number(generation || 0)) {
      return false;
    }
    return true;
  }
  return resetExactAfterSettleControllerActionState(target, {
    reason,
    generation,
  });
}

export function isExactAfterSettleGenerationCurrentState(target, generation, phase = "") {
  if (!target || typeof target !== "object") return false;
  return isExactAfterSettleGenerationCurrentActionState(target, generation, phase);
}

export function isExactAfterSettleControllerActiveState(target) {
  if (!target || typeof target !== "object") return false;
  return isExactAfterSettleControllerActiveActionState(target);
}

export function ensureSidebarPerfState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultSidebarPerfState();
  }
  const defaults = createDefaultSidebarPerfState();
  if (!target.sidebarPerf || typeof target.sidebarPerf !== "object") {
    target.sidebarPerf = defaults;
  }
  if (!target.sidebarPerf.counters || typeof target.sidebarPerf.counters !== "object") {
    target.sidebarPerf.counters = {};
  }
  Object.entries(defaults.counters).forEach(([counterName, initialValue]) => {
    if (!Number.isFinite(Number(target.sidebarPerf.counters[counterName]))) {
      target.sidebarPerf.counters[counterName] = initialValue;
    }
  });
  return target.sidebarPerf;
}

export function ensureProjectedBoundsCacheState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultProjectedBoundsCacheState();
  }
  const projectedBoundsDescriptor = Object.getOwnPropertyDescriptor(
    target,
    "projectedBoundsById",
  );
  const sphericalDiagnosticsDescriptor = Object.getOwnPropertyDescriptor(
    target,
    "sphericalFeatureDiagnosticsById",
  );
  const projectedBoundsById = projectedBoundsDescriptor
    && Object.hasOwn(projectedBoundsDescriptor, "value")
    ? projectedBoundsDescriptor.value
    : null;
  const sphericalFeatureDiagnosticsById = sphericalDiagnosticsDescriptor
    && Object.hasOwn(sphericalDiagnosticsDescriptor, "value")
    ? sphericalDiagnosticsDescriptor.value
    : null;
  if (
    projectedBoundsById instanceof Map
    && sphericalFeatureDiagnosticsById instanceof Map
  ) {
    return true;
  }
  const defaults = createDefaultProjectedBoundsCacheState();
  commitProjectedBoundsCacheState(target, {
    projectedBoundsById: projectedBoundsById instanceof Map
      ? projectedBoundsById
      : defaults.projectedBoundsById,
    sphericalFeatureDiagnosticsById: sphericalFeatureDiagnosticsById instanceof Map
      ? sphericalFeatureDiagnosticsById
      : defaults.sphericalFeatureDiagnosticsById,
  });
  return true;
}

export function resetProjectedBoundsCacheState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultProjectedBoundsCacheState();
  }
  const defaults = createDefaultProjectedBoundsCacheState();
  commitProjectedBoundsCacheState(target, defaults);
  return defaults;
}

// Compatibility behavior includes the historical invalid-target fallback.
export function setInteractionInfrastructureStateFields(target, stage, options) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return "idle";
  }
  return setInteractionInfrastructureActionStateFields(target, stage, options);
}
