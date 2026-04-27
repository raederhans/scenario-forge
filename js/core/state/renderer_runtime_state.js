// Renderer runtime state defaults.
// 这里收口 map_renderer / sidebar 共享的运行时默认 shape，
// 避免 defer 标记、pass cache、诊断缓存和交互基础设施状态再次漂移。

export function createDefaultRendererInfrastructureState() {
  return {
    interactionInfrastructureReady: true,
    interactionInfrastructureBuildInFlight: false,
    interactionInfrastructureStage: "idle",
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
    pendingPlan: null,
    reason: "init",
  };
}

export function ensureExactAfterSettleControllerState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultExactAfterSettleControllerState();
  }
  if (!target.exactAfterSettleController || typeof target.exactAfterSettleController !== "object") {
    target.exactAfterSettleController = createDefaultExactAfterSettleControllerState();
  }
  const controller = target.exactAfterSettleController;
  const defaults = createDefaultExactAfterSettleControllerState();
  Object.entries(defaults).forEach(([fieldName, initialValue]) => {
    if (!(fieldName in controller)) {
      controller[fieldName] = initialValue;
    }
  });
  return controller;
}

export function resetExactAfterSettleControllerState(target, { reason = "reset", generation = null } = {}) {
  const controller = ensureExactAfterSettleControllerState(target);
  if (generation !== null && Number(controller.generation || 0) !== Number(generation || 0)) {
    return false;
  }
  const nextGeneration = Number(controller.generation || 0) + 1;
  Object.assign(controller, createDefaultExactAfterSettleControllerState(), {
    generation: nextGeneration,
    reason: String(reason || "reset"),
  });
  return true;
}

export function isExactAfterSettleGenerationCurrentState(target, generation, phase = "") {
  const controller = target?.exactAfterSettleController;
  return !!controller
    && Number(controller.generation || 0) === Number(generation || 0)
    && (!phase || String(controller.phase || "") === phase);
}

export function isExactAfterSettleControllerActiveState(target) {
  const phase = String(target?.exactAfterSettleController?.phase || "idle");
  return ["scheduled", "applying", "awaiting-paint", "finalizing"].includes(phase);
}

export function createDefaultRenderPassCacheState() {
  return {
    referenceTransform: null,
    referenceTransforms: {},
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
      valid: false,
      stale: false,
      capturedAt: 0,
      invalidatedAt: 0,
      reason: "init",
      staleReason: "",
      rejectedReason: "",
      scenarioId: "",
      topologyRevision: 0,
      dpr: 1,
      pixelWidth: 0,
      pixelHeight: 0,
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
      topologyRevision: 0,
      dpr: 1,
      pixelWidth: 0,
      pixelHeight: 0,
    },
    partialPoliticalDirtyIds: new Set(),
    politicalPathCache: new Map(),
    politicalPathCacheSignature: "",
    politicalPathCacheTransform: null,
    politicalPathWarmupQueue: [],
    politicalPathWarmupHandle: null,
    politicalPathWarmupSignature: "",
    contextScenarioReasonMismatchSignature: "",
    dirty: {
      background: true,
      political: true,
      effects: true,
      contextBase: true,
      contextScenario: true,
      dayNight: true,
      borders: true,
    },
    reasons: {
      background: "init",
      political: "init",
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
      transformedFrames: 0,
      drawCanvas: 0,
      backgroundPassRenders: 0,
      physicalBasePassRenders: 0,
      politicalPassRenders: 0,
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
      politicalPathCacheBuild: 0,
      politicalPathWarmupBuild: 0,
      politicalPathWarmupSlices: 0,
      politicalPathWarmupCancels: 0,
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
    firstVisibleFramePainted: false,
    phaseEnteredAt: 0,
    renderPhaseTimerId: null,
    pendingDayNightRefresh: false,
    colorRevision: 0,
    topologyRevision: 0,
    renderPassCache: createDefaultRenderPassCacheState(),
    sidebarPerf: createDefaultSidebarPerfState(),
    ...createDefaultProjectedBoundsCacheState(),
  };
}

export function ensureRenderPassCacheState(
  target,
  {
    cloneZoomTransform = (value) => value,
    renderPassNames = [],
  } = {},
) {
  if (!target || typeof target !== "object") {
    return createDefaultRenderPassCacheState();
  }
  if (!target.renderPassCache || typeof target.renderPassCache !== "object") {
    target.renderPassCache = createDefaultRenderPassCacheState();
  }
  const cache = target.renderPassCache;
  const defaults = createDefaultRenderPassCacheState();
  cache.canvases = cache.canvases && typeof cache.canvases === "object" ? cache.canvases : defaults.canvases;
  cache.layouts = cache.layouts && typeof cache.layouts === "object" ? cache.layouts : defaults.layouts;
  cache.signatures = cache.signatures && typeof cache.signatures === "object" ? cache.signatures : defaults.signatures;
  cache.referenceTransforms = cache.referenceTransforms && typeof cache.referenceTransforms === "object"
    ? cache.referenceTransforms
    : defaults.referenceTransforms;
  cache.contextScenarioLayerCache = cache.contextScenarioLayerCache && typeof cache.contextScenarioLayerCache === "object"
    ? cache.contextScenarioLayerCache
    : defaults.contextScenarioLayerCache;
  cache.compositeBuffer = cache.compositeBuffer && typeof cache.compositeBuffer === "object"
    ? cache.compositeBuffer
    : { ...defaults.compositeBuffer };
  Object.entries(defaults.compositeBuffer).forEach(([fieldName, initialValue]) => {
    if (!(fieldName in cache.compositeBuffer)) {
      cache.compositeBuffer[fieldName] = initialValue;
    }
  });
  cache.borderSnapshot = cache.borderSnapshot && typeof cache.borderSnapshot === "object"
    ? cache.borderSnapshot
    : { ...defaults.borderSnapshot };
  cache.lastGoodFrame = cache.lastGoodFrame && typeof cache.lastGoodFrame === "object"
    ? cache.lastGoodFrame
    : { ...defaults.lastGoodFrame };
  Object.entries(defaults.lastGoodFrame).forEach(([fieldName, initialValue]) => {
    if (!(fieldName in cache.lastGoodFrame)) {
      cache.lastGoodFrame[fieldName] = initialValue;
    }
  });
  cache.interactionComposite = cache.interactionComposite && typeof cache.interactionComposite === "object"
    ? cache.interactionComposite
    : { ...defaults.interactionComposite };
  Object.entries(defaults.interactionComposite).forEach(([fieldName, initialValue]) => {
    if (!(fieldName in cache.interactionComposite)) {
      cache.interactionComposite[fieldName] = initialValue;
    }
  });
  cache.partialPoliticalDirtyIds = cache.partialPoliticalDirtyIds instanceof Set
    ? cache.partialPoliticalDirtyIds
    : defaults.partialPoliticalDirtyIds;
  cache.politicalPathCache = cache.politicalPathCache instanceof Map
    ? cache.politicalPathCache
    : defaults.politicalPathCache;
  cache.politicalPathCacheSignature = typeof cache.politicalPathCacheSignature === "string"
    ? cache.politicalPathCacheSignature
    : defaults.politicalPathCacheSignature;
  cache.politicalPathCacheTransform = cache.politicalPathCacheTransform
    ? cloneZoomTransform(cache.politicalPathCacheTransform)
    : defaults.politicalPathCacheTransform;
  cache.politicalPathWarmupQueue = Array.isArray(cache.politicalPathWarmupQueue)
    ? cache.politicalPathWarmupQueue
    : defaults.politicalPathWarmupQueue;
  cache.politicalPathWarmupHandle = cache.politicalPathWarmupHandle && typeof cache.politicalPathWarmupHandle === "object"
    ? cache.politicalPathWarmupHandle
    : defaults.politicalPathWarmupHandle;
  cache.politicalPathWarmupSignature = typeof cache.politicalPathWarmupSignature === "string"
    ? cache.politicalPathWarmupSignature
    : defaults.politicalPathWarmupSignature;
  cache.contextScenarioReasonMismatchSignature = typeof cache.contextScenarioReasonMismatchSignature === "string"
    ? cache.contextScenarioReasonMismatchSignature
    : defaults.contextScenarioReasonMismatchSignature;
  cache.dirty = cache.dirty && typeof cache.dirty === "object" ? cache.dirty : {};
  cache.reasons = cache.reasons && typeof cache.reasons === "object" ? cache.reasons : {};
  cache.counters = cache.counters && typeof cache.counters === "object" ? cache.counters : {};
  renderPassNames.forEach((passName) => {
    if (!(passName in cache.dirty)) {
      cache.dirty[passName] = true;
    }
    if (!(passName in cache.reasons)) {
      cache.reasons[passName] = "init";
    }
  });
  Object.entries(defaults.counters).forEach(([counterName, initialValue]) => {
    if (!Number.isFinite(Number(cache.counters[counterName]))) {
      cache.counters[counterName] = initialValue;
    }
  });
  if (!("lastFrame" in cache)) {
    cache.lastFrame = defaults.lastFrame;
  }
  if (typeof cache.lastAction !== "string") {
    cache.lastAction = defaults.lastAction;
  }
  if (!Number.isFinite(Number(cache.lastActionDurationMs))) {
    cache.lastActionDurationMs = defaults.lastActionDurationMs;
  }
  if (!Number.isFinite(Number(cache.lastActionAt))) {
    cache.lastActionAt = defaults.lastActionAt;
  }
  if (typeof cache.perfOverlayEnabled !== "boolean") {
    cache.perfOverlayEnabled = defaults.perfOverlayEnabled;
  }
  if (!("overlayElement" in cache)) {
    cache.overlayElement = defaults.overlayElement;
  }
  return cache;
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

export function resetProjectedBoundsCacheState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultProjectedBoundsCacheState();
  }
  const defaults = createDefaultProjectedBoundsCacheState();
  target.projectedBoundsById = defaults.projectedBoundsById;
  target.sphericalFeatureDiagnosticsById = defaults.sphericalFeatureDiagnosticsById;
  return defaults;
}

export function ensureSphericalFeatureDiagnosticsCache(target) {
  if (!target || typeof target !== "object") {
    return createDefaultProjectedBoundsCacheState().sphericalFeatureDiagnosticsById;
  }
  if (!(target.sphericalFeatureDiagnosticsById instanceof Map)) {
    target.sphericalFeatureDiagnosticsById = createDefaultProjectedBoundsCacheState().sphericalFeatureDiagnosticsById;
  }
  return target.sphericalFeatureDiagnosticsById;
}

export function setInteractionInfrastructureStateFields(
  target,
  stage,
  {
    ready = null,
    inFlight = null,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return "idle";
  }
  target.interactionInfrastructureStage = String(stage || "idle").trim() || "idle";
  if (ready != null) {
    target.interactionInfrastructureReady = !!ready;
  }
  if (inFlight != null) {
    target.interactionInfrastructureBuildInFlight = !!inFlight;
  }
  return target.interactionInfrastructureStage;
}
