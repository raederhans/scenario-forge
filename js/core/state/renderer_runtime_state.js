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

export function createDefaultRenderPassCacheState() {
  return {
    referenceTransform: null,
    referenceTransforms: {},
    canvases: {},
    layouts: {},
    signatures: {},
    contextScenarioLayerCache: {},
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
      capturedAt: 0,
      reason: "init",
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
    zoomRenderScheduled: false,
    pendingZoomTransform: null,
    zoomGestureStartTransform: null,
    zoomGestureScaleDelta: 0,
    zoomGestureEndedAt: 0,
    adaptiveSettleProfile: null,
    pendingExactPoliticalFastFrame: false,
    debugCountryCoverage: null,
    isInteracting: false,
    renderPhase: "idle",
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
