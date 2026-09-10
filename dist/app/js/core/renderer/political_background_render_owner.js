function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

export function createPoliticalBackgroundRenderOwner({
  surface,
  getters = {},
  helpers = {},
  effects = {},
  platform = {},
  constants = {},
} = {}) {
  if (!surface || typeof surface !== "object") {
    throw new TypeError("surface must be an object.");
  }
  const getRuntimeState = requireFunction(getters.getRuntimeState, "getters.getRuntimeState");
  const getDebugMode = requireFunction(getters.getDebugMode, "getters.getDebugMode");
  const state = new Proxy({}, {
    get: (_target, property) => getRuntimeState()?.[property],
  });
  const {
    getAtlantropaSeaPoliticalFillColor,
    getFeatureId,
    getSafeCanvasColor,
    isAtlantropaSeaFeature,
    getResolvedFeatureColor,
    getDisplayOwnerCode,
    getFeatureCountryCodeNormalized,
    isWorldBounds,
    getPoliticalPathCacheHandle,
    getPoliticalFeaturePathEntry,
    isPoliticalFeaturePathEntryCurrent,
    getTransformSignature,
    getPoliticalPathCacheSignature,
    getVisibleFrameIdentity,
    nowMs,
    getRenderPassCacheState,
    isInteractionRecoverySettled,
    isExactAfterSettleControllerActive,
    cloneZoomTransform,
    getLogicalCanvasDimensions,
    isAntarcticSectorFeature,
    isBaseGeographyScenarioFeature,
    shouldExcludePoliticalVisualFeature,
    shouldSkipFeature,
    getProjectedFeatureBounds,
    collectVisibleLandSpatialItems,
    screenRectToProjectedRect,
    collectLandSpatialItemsForProjectedRects,
    projectedBoundsIntersectScreenRects,
    getPoliticalRecoveryQuality,
    hasPendingPoliticalColorEdit,
    getAdmin0BackgroundFillColor,
    normalizeIntensityFieldsState,
    getRenderPassLayout,
    getProjectionRenderSignature,
    getOceanBaseFillColor,
  } = helpers;
  const {
    recordRenderPerfMetric,
    cancelDeferredWork,
    scheduleDeferredWork,
    invalidateRenderPasses,
    recordProgressivePoliticalFullCacheReadyDiagnostics,
    requestRendererRender,
    renderFallback,
    commitIntensityFieldsState,
    getIntensityFieldMaskOwner,
    applyOceanClipMask,
    drawOceanStyle,
    warn,
  } = effects;
  [
    getAtlantropaSeaPoliticalFillColor, getFeatureId, getSafeCanvasColor,
    isAtlantropaSeaFeature, getResolvedFeatureColor, getDisplayOwnerCode,
    getFeatureCountryCodeNormalized, isWorldBounds, getPoliticalPathCacheHandle,
    getPoliticalFeaturePathEntry, isPoliticalFeaturePathEntryCurrent, getTransformSignature, getPoliticalPathCacheSignature,
    getVisibleFrameIdentity, nowMs, getRenderPassCacheState, isInteractionRecoverySettled,
    isExactAfterSettleControllerActive, cloneZoomTransform, getLogicalCanvasDimensions,
    isAntarcticSectorFeature, isBaseGeographyScenarioFeature,
    shouldExcludePoliticalVisualFeature, shouldSkipFeature, getProjectedFeatureBounds,
    collectVisibleLandSpatialItems, screenRectToProjectedRect,
    collectLandSpatialItemsForProjectedRects, projectedBoundsIntersectScreenRects,
    getPoliticalRecoveryQuality, hasPendingPoliticalColorEdit, getAdmin0BackgroundFillColor,
    normalizeIntensityFieldsState, getRenderPassLayout, getProjectionRenderSignature,
    getOceanBaseFillColor, recordRenderPerfMetric, cancelDeferredWork, scheduleDeferredWork,
    invalidateRenderPasses, recordProgressivePoliticalFullCacheReadyDiagnostics,
    requestRendererRender, renderFallback, commitIntensityFieldsState,
    getIntensityFieldMaskOwner, applyOceanClipMask, drawOceanStyle,
    warn,
  ].forEach((candidate, index) => requireFunction(candidate, `dependency[${index}]`));
  const LAND_FILL_COLOR = String(constants.landFillColor || "#d8d2c4");
  const RENDER_PHASE_IDLE = String(constants.renderPhaseIdle || "idle");
  const POLITICAL_RECOVERY_QUALITY_PROGRESSIVE = String(
    constants.politicalRecoveryQualityProgressive || "progressive",
  );
  const POLITICAL_PROGRESSIVE_BACKGROUND_EXACT_ENTRY_LIMIT = Number(
    constants.progressiveBackgroundExactEntryLimit,
  ) || 2400;
  const POLITICAL_DEFERRED_FULL_CACHE_CPU_BUDGET_MS = Number(
    constants.deferredFullCacheCpuBudgetMs,
  ) || 10;
  const POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS = Number(
    constants.deferredFullCacheTimeoutMs,
  ) || 60;
  const SCENARIO_BACKGROUND_MERGE_MAX_AREA = Number(
    constants.scenarioBackgroundMergeMaxArea,
  ) || Math.PI * 2;
  const OCEAN_DEPTH_MASK_BLEND_MODE = String(constants.oceanDepthMaskBlendMode || "soft-light");
  const OCEAN_DEPTH_MASK_GRAY_MAP = Object.freeze({ ...(constants.oceanDepthMaskGrayMap || {}) });
  const OCEAN_MASK_MODE_TOPOLOGY = String(constants.oceanMaskModeTopology || "topology");
  let admin0MergedCache = { topologyRef: null, featureCount: 0, entries: [] };
  let scenarioPoliticalBackgroundCache = createScenarioPoliticalBackgroundCacheState();
  let scenarioPoliticalBackgroundDeferredFullCacheHandle = null;
  let scenarioPoliticalBackgroundDeferredFullCacheState = null;
  const suspiciousScenarioBackgroundMergeWarnings = new Set();

  function createScenarioPoliticalBackgroundCacheState(overrides = {}) {
    return {
      runtimeRef: null,
      scenarioId: "",
      viewMode: "ownership",
      oceanFillColor: "",
      sovereigntyRevision: 0,
      controllerRevision: 0,
      shellRevision: 0,
      colorRevision: 0,
      topologyRevision: 0,
      canvasWidth: 0,
      canvasHeight: 0,
      transformSignature: "",
      colorSignature: "",
      cacheKey: "",
      fullPassCacheKey: "",
      fullPassPathCacheSignature: "",
      fullPassTransformSignature: "",
      fullPassColorSignature: "",
      fullPassGroupCount: 0,
      fullPassEntryCount: 0,
      fullPassReusedPathCount: 0,
      fullPassBuiltPathCount: 0,
      fullPassPathlessEntryCount: 0,
      fullPassGroups: [],
      entries: [],
      ...overrides,
    };
  }

  function cancelScenarioPoliticalBackgroundDeferredFullCache(reason = "unspecified") {
    if (scenarioPoliticalBackgroundDeferredFullCacheHandle) {
      cancelDeferredWork(scenarioPoliticalBackgroundDeferredFullCacheHandle);
    }
    const hadState = !!scenarioPoliticalBackgroundDeferredFullCacheState
      || !!scenarioPoliticalBackgroundDeferredFullCacheHandle;
    scenarioPoliticalBackgroundDeferredFullCacheHandle = null;
    scenarioPoliticalBackgroundDeferredFullCacheState = null;
    if (hadState) {
      recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheCancel", 0, {
        reason: String(reason || "unspecified"),
        activeScenarioId: String(state.activeScenarioId || ""),
      });
    }
  }

  function shouldUseScenarioPoliticalBackgroundMerge() {
    const landCollection = getScenarioPoliticalBackgroundLandCollection();
    return Boolean(
      getDebugMode() === "PROD" &&
      state.activeScenarioId &&
      Array.isArray(landCollection?.features) &&
      landCollection.features.length
    );
  }

  function getScenarioPoliticalBackgroundLandCollection() {
    return state.landDataFull || state.landData;
  }

  function shouldFallbackScenarioPoliticalBackgroundMergeShape(
    mergedShape,
    { displayCode = "", fillColor = "", groupSize = 0 } = {}
  ) {
    const scenarioId = String(state.activeScenarioId || "").trim();
    const geoAreaFn = platform.d3?.geoArea;
    const geoBoundsFn = platform.d3?.geoBounds;
    if (typeof geoAreaFn !== "function") {
      return false;
    }
    let area = Number.NaN;
    let bounds = null;
    try {
      area = geoAreaFn(mergedShape);
      bounds = typeof geoBoundsFn === "function" ? geoBoundsFn(mergedShape) : null;
    } catch (_error) {
      area = Number.NaN;
      bounds = null;
    }
    const suspicious =
      !Number.isFinite(area) ||
      area > SCENARIO_BACKGROUND_MERGE_MAX_AREA ||
      isWorldBounds(bounds);
    if (!suspicious) {
      return false;
    }
    const viewMode = "ownership";
    const logKey = `${scenarioId}::${viewMode}::${displayCode}::${fillColor}`;
    if (!suspiciousScenarioBackgroundMergeWarnings.has(logKey)) {
      suspiciousScenarioBackgroundMergeWarnings.add(logKey);
      const areaText = Number.isFinite(area) ? area.toFixed(5) : "non-finite";
      warn(
        `[map_renderer] Scenario political background merge fallback engaged: scenario=${scenarioId || "(none)"} view=${viewMode} owner=${displayCode || "(unknown)"} fill=${fillColor || "(none)"} group=${groupSize} area=${areaText}`
      );
    }
    return true;
  }

  function getScenarioPoliticalBackgroundCacheKey({
    canvasWidth = 0,
    canvasHeight = 0,
  } = {}) {
    return [
      String(state.activeScenarioId || ""),
      "ownership",
      getAtlantropaSeaPoliticalFillColor(),
      Number(state.sovereigntyRevision || 0),
      0,
      Number(state.scenarioShellOverlayRevision || 0),
      Number(state.colorRevision || 0),
      Math.round(Number(canvasWidth || 0)),
      Math.round(Number(canvasHeight || 0)),
    ].join("::");
  }

  function resolvePoliticalBackgroundEntryMeta(
    entry,
    {
      useScenarioBackgroundMerge = shouldUseScenarioPoliticalBackgroundMerge(),
    } = {},
  ) {
    const feature = entry?.feature || null;
    const index = Number(entry?.index || 0);
    const resolvedId = String(entry?.id || getFeatureId(feature) || `feature-${index}`);
    const fillColor =
      (isAtlantropaSeaFeature(feature)
        ? getAtlantropaSeaPoliticalFillColor()
        : null) ||
      getSafeCanvasColor(state.colors?.[resolvedId], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(feature, resolvedId), null) ||
      LAND_FILL_COLOR;
    const displayCode = useScenarioBackgroundMerge
      ? (
        getDisplayOwnerCode(feature, resolvedId) ||
        getFeatureCountryCodeNormalized(feature) ||
        "__NONE__"
      )
      : (
        getFeatureCountryCodeNormalized(feature) ||
        "__NONE__"
      );
    return {
      feature,
      index,
      id: resolvedId,
      path: entry?.path || null,
      fillColor,
      displayCode,
      groupKey: `${displayCode}::${fillColor}`,
    };
  }

  function buildScenarioPoliticalBackgroundColorSignature(
    entries = [],
    {
      useScenarioBackgroundMerge = shouldUseScenarioPoliticalBackgroundMerge(),
    } = {},
  ) {
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const meta = resolvePoliticalBackgroundEntryMeta(entry, { useScenarioBackgroundMerge });
        return `${meta.groupKey}::${meta.id}`;
      })
      .join("|");
  }

  function drawPoliticalBackgroundFillsFromGroups(groups = []) {
    let groupCount = 0;
    (Array.isArray(groups) ? groups : []).forEach((group) => {
      const fillColor = String(group?.fillColor || "").trim() || LAND_FILL_COLOR;
      const mergedPath = group?.mergedPath || null;
      const groupEntries = Array.isArray(group?.entries) ? group.entries.filter(Boolean) : [];
      if (!groupEntries.length && !mergedPath) {
        return;
      }
      surface.getContext().fillStyle = fillColor;
      if (mergedPath) {
        surface.getContext().fill(mergedPath);
        groupCount += 1;
        return;
      }
      if (groupEntries.length && groupEntries.every((entry) => entry?.path)) {
        groupEntries.forEach((entry) => {
          surface.getContext().fill(entry.path);
        });
        groupCount += 1;
        return;
      }
      surface.getContext().beginPath();
      groupEntries.forEach((entry) => {
        if (entry?.feature) {
          surface.getPathCanvas()(entry.feature);
        }
      });
      surface.getContext().fill();
      groupCount += 1;
    });
    return groupCount;
  }

  function buildPoliticalBackgroundResolvedGroups(
    entries = [],
    {
      transform = state.zoomTransform || platform.d3?.zoomIdentity,
      useScenarioBackgroundMerge = shouldUseScenarioPoliticalBackgroundMerge(),
      allowBuildPaths = false,
    } = {},
  ) {
    const groupedEntries = new Map();
    let reusedPathCount = 0;
    let builtPathCount = 0;
    let pathlessEntryCount = 0;
    const pathCacheHandle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
    const pathCacheSizeBefore = pathCacheHandle?.map instanceof Map
      ? pathCacheHandle.map.size
      : 0;

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry?.feature?.geometry) return;
      const meta = resolvePoliticalBackgroundEntryMeta(entry, { useScenarioBackgroundMerge });
      let resolvedPath = meta.path || null;
      if (resolvedPath) {
        reusedPathCount += 1;
      } else if (pathCacheHandle?.valid && pathCacheHandle.map instanceof Map) {
        const cachedEntry = pathCacheHandle.map.get(meta.id);
        const hadCachedPath = isPoliticalFeaturePathEntryCurrent(cachedEntry, meta.feature);
        const pathEntry = hadCachedPath ? cachedEntry : allowBuildPaths ? getPoliticalFeaturePathEntry(meta.feature, {
          featureId: meta.id,
          transform,
          allowBuild: true,
          countBuild: true,
        }) : null;
        resolvedPath = pathEntry?.path || null;
        if (resolvedPath) {
          if (hadCachedPath) {
            reusedPathCount += 1;
          } else {
            builtPathCount += 1;
          }
        } else {
          pathlessEntryCount += 1;
        }
      } else {
        pathlessEntryCount += 1;
      }
      if (!groupedEntries.has(meta.groupKey)) {
        groupedEntries.set(meta.groupKey, {
          fillColor: meta.fillColor,
          entries: [],
        });
      }
      groupedEntries.get(meta.groupKey).entries.push({
        feature: meta.feature,
        path: resolvedPath,
      });
    });

    const groups = [];
    groupedEntries.forEach(({ fillColor, entries: groupEntries }, groupKey) => {
      const resolvedEntries = Array.isArray(groupEntries) ? groupEntries.filter(Boolean) : [];
      if (!resolvedEntries.length) return;
      let mergedPath = null;
      if (resolvedEntries.length === 1 && resolvedEntries[0]?.path) {
        mergedPath = resolvedEntries[0].path;
      } else if (
        platform.Path2D
        && typeof platform.Path2D.prototype?.addPath === "function"
        && resolvedEntries.every((item) => item?.path)
      ) {
        mergedPath = new platform.Path2D();
        resolvedEntries.forEach((item) => {
          mergedPath.addPath(item.path);
        });
      }
      groups.push({
        groupKey,
        fillColor,
        mergedPath,
        entries: resolvedEntries,
      });
    });

    return {
      groups,
      groupCount: groups.length,
      entryCount: Array.isArray(entries) ? entries.length : 0,
      reusedPathCount,
      builtPathCount,
      pathlessEntryCount,
      pathCacheSizeBefore,
      pathCacheSizeAfter: pathCacheHandle?.map instanceof Map ? pathCacheHandle.map.size : 0,
      pathCacheResetReason: String(pathCacheHandle?.resetSummary?.reason || ""),
      pathCacheResetPreviousSize: Math.max(0, Number(pathCacheHandle?.resetSummary?.previousSize || 0)),
      pathCacheResetPreviousReason: String(pathCacheHandle?.resetSummary?.previousReason || ""),
      pathCacheResetPreviousTransformK: Math.max(0, Number(pathCacheHandle?.resetSummary?.previousTransformK || 0)),
      pathCacheResetNextTransformK: Math.max(0, Number(pathCacheHandle?.resetSummary?.nextTransformK || 0)),
    };
  }

  function getScenarioPoliticalBackgroundFullPassIdentity(
    normalizedEntries = [],
    {
      transform = state.zoomTransform || platform.d3?.zoomIdentity,
    } = {},
  ) {
    const transformSignature = getTransformSignature(transform);
    const pathCacheSignature = getPoliticalPathCacheSignature(transform);
    const colorSignature = buildScenarioPoliticalBackgroundColorSignature(normalizedEntries);
    const sceneIdentity = getVisibleFrameIdentity(transform);
    const fullPassCacheKey = [
      sceneIdentity.scenarioId,
      sceneIdentity.sceneGeneration,
      sceneIdentity.scenarioDataGeneration,
      scenarioPoliticalBackgroundCache.cacheKey,
      transformSignature,
      pathCacheSignature,
      colorSignature,
      normalizedEntries.length,
    ].join("::");
    return {
      scenarioId: sceneIdentity.scenarioId,
      sceneGeneration: sceneIdentity.sceneGeneration,
      scenarioDataGeneration: sceneIdentity.scenarioDataGeneration,
      transformSignature,
      pathCacheSignature,
      colorSignature,
      fullPassCacheKey,
    };
  }

  function getScenarioPoliticalBackgroundFullPassGroups(
    entries = [],
    {
      transform = state.zoomTransform || platform.d3?.zoomIdentity,
      allowBuild = true,
      metricName = "scenarioPoliticalBackgroundCacheBuild",
      phase = "render",
      recoveryQuality = getPoliticalRecoveryQuality(),
    } = {},
  ) {
    const startedAt = nowMs();
    const normalizedEntries = Array.isArray(entries) ? entries.filter((entry) => entry?.feature?.geometry) : [];
    if (!normalizedEntries.length) {
      return {
        cacheHit: false,
        groupCount: 0,
        entryCount: 0,
        reusedPathCount: 0,
        builtPathCount: 0,
        pathlessEntryCount: 0,
        groups: [],
      };
    }
    const fullPassIdentity = getScenarioPoliticalBackgroundFullPassIdentity(normalizedEntries, { transform });
    const {
      transformSignature,
      pathCacheSignature,
      colorSignature,
      fullPassCacheKey,
    } = fullPassIdentity;
    if (
      scenarioPoliticalBackgroundCache.fullPassCacheKey === fullPassCacheKey
      && Array.isArray(scenarioPoliticalBackgroundCache.fullPassGroups)
      && scenarioPoliticalBackgroundCache.fullPassGroups.length
    ) {
      recordRenderPerfMetric("scenarioPoliticalBackgroundCacheReplay", nowMs() - startedAt, {
        cacheHit: true,
        groupCount: Number(scenarioPoliticalBackgroundCache.fullPassGroupCount || 0),
        entryCount: Number(scenarioPoliticalBackgroundCache.fullPassEntryCount || 0),
        reusedPathCount: Number(scenarioPoliticalBackgroundCache.fullPassReusedPathCount || 0),
        builtPathCount: Number(scenarioPoliticalBackgroundCache.fullPassBuiltPathCount || 0),
        pathlessEntryCount: Number(scenarioPoliticalBackgroundCache.fullPassPathlessEntryCount || 0),
        phase,
        recoveryQuality,
      });
      return {
        cacheHit: true,
        groupCount: Number(scenarioPoliticalBackgroundCache.fullPassGroupCount || 0),
        entryCount: Number(scenarioPoliticalBackgroundCache.fullPassEntryCount || 0),
        reusedPathCount: Number(scenarioPoliticalBackgroundCache.fullPassReusedPathCount || 0),
        builtPathCount: Number(scenarioPoliticalBackgroundCache.fullPassBuiltPathCount || 0),
        pathlessEntryCount: Number(scenarioPoliticalBackgroundCache.fullPassPathlessEntryCount || 0),
        phase,
        recoveryQuality,
        groups: scenarioPoliticalBackgroundCache.fullPassGroups,
      };
    }
    if (!allowBuild) {
      return {
        fullPassIdentity,
        cacheHit: false,
        cacheReady: false,
        groupCount: 0,
        entryCount: normalizedEntries.length,
        reusedPathCount: 0,
        builtPathCount: 0,
        pathlessEntryCount: 0,
        phase,
        recoveryQuality,
        groups: [],
      };
    }
    const resolvedGroups = buildPoliticalBackgroundResolvedGroups(normalizedEntries, {
      transform,
      useScenarioBackgroundMerge: true,
      allowBuildPaths: true,
    });
    scenarioPoliticalBackgroundCache = createScenarioPoliticalBackgroundCacheState({
      ...scenarioPoliticalBackgroundCache,
      transformSignature,
      colorSignature,
      fullPassCacheKey,
      fullPassPathCacheSignature: pathCacheSignature,
      fullPassTransformSignature: transformSignature,
      fullPassColorSignature: colorSignature,
      fullPassGroupCount: resolvedGroups.groupCount,
      fullPassEntryCount: resolvedGroups.entryCount,
      fullPassReusedPathCount: resolvedGroups.reusedPathCount,
      fullPassBuiltPathCount: resolvedGroups.builtPathCount,
      fullPassPathlessEntryCount: resolvedGroups.pathlessEntryCount,
      fullPassGroups: resolvedGroups.groups,
    });
    recordRenderPerfMetric(metricName, nowMs() - startedAt, {
      cacheHit: false,
      groupCount: resolvedGroups.groupCount,
      entryCount: resolvedGroups.entryCount,
      reusedPathCount: resolvedGroups.reusedPathCount,
      builtPathCount: resolvedGroups.builtPathCount,
      pathlessEntryCount: resolvedGroups.pathlessEntryCount,
      pathCacheSizeBefore: resolvedGroups.pathCacheSizeBefore,
      pathCacheSizeAfter: resolvedGroups.pathCacheSizeAfter,
      pathCacheResetReason: resolvedGroups.pathCacheResetReason,
      pathCacheResetPreviousSize: resolvedGroups.pathCacheResetPreviousSize,
      pathCacheResetPreviousReason: resolvedGroups.pathCacheResetPreviousReason,
      pathCacheResetPreviousTransformK: resolvedGroups.pathCacheResetPreviousTransformK,
      pathCacheResetNextTransformK: resolvedGroups.pathCacheResetNextTransformK,
      phase,
      recoveryQuality,
    });
    return {
      cacheHit: false,
      phase,
      recoveryQuality,
      ...resolvedGroups,
    };
  }

  function isScenarioPoliticalBackgroundFullPassCacheKeyReady(fullPassCacheKey = "") {
    return (
      !!fullPassCacheKey
      && scenarioPoliticalBackgroundCache.fullPassCacheKey === fullPassCacheKey
      && Array.isArray(scenarioPoliticalBackgroundCache.fullPassGroups)
      && scenarioPoliticalBackgroundCache.fullPassGroups.length > 0
    );
  }

  function recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred(deferredState) {
    if (!deferredState || deferredState.repaintDeferredRecorded) return;
    deferredState.repaintDeferredRecorded = true;
    recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred", 0, {
      phase: "idle",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      reason: "interaction-recovery-active",
      activeScenarioId: String(getRuntimeState().activeScenarioId || ""),
      renderPhase: String(getRuntimeState().renderPhase || ""),
      deferExactAfterSettle: !!getRuntimeState().deferExactAfterSettle,
    });
  }

  function isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(
    state,
    transform = getRuntimeState().zoomTransform || platform.d3?.zoomIdentity,
  ) {
    if (!state || typeof state !== "object") return false;
    const identity = getVisibleFrameIdentity(transform);
    const transformSignature = getTransformSignature(transform);
    return String(state.scenarioId || "") === identity.scenarioId
      && Number(state.sceneGeneration || 0) === Number(identity.sceneGeneration || 0)
      && Number(state.scenarioDataGeneration || 0) === Number(identity.scenarioDataGeneration || 0)
      && String(state.transformSignature || "") === transformSignature;
  }

  function runScenarioPoliticalBackgroundDeferredFullCacheSlice(deadline = null) {
    const deferredState = scenarioPoliticalBackgroundDeferredFullCacheState;
    scenarioPoliticalBackgroundDeferredFullCacheHandle = null;
    if (!deferredState || !Array.isArray(deferredState.entries) || !deferredState.entries.length) {
      scenarioPoliticalBackgroundDeferredFullCacheState = null;
      return false;
    }
    if (!isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(deferredState)) {
      cancelScenarioPoliticalBackgroundDeferredFullCache("scene-snapshot-mismatch");
      return false;
    }
    const normalizedEntries = deferredState.entries;
    if (isScenarioPoliticalBackgroundFullPassCacheKeyReady(deferredState.fullPassCacheKey)) {
      scenarioPoliticalBackgroundDeferredFullCacheState = null;
      return false;
    }
    const cache = getRenderPassCacheState();
    const recoverySettled = isInteractionRecoverySettled({ quietMs: 600 });
    // 交互恢复期只预热 full cache，不立刻请求重绘；这样滚轮/拖拽后的稳定帧不会被后台精细缓存打断。
    if (
      getRuntimeState().renderPhase !== RENDER_PHASE_IDLE
      || getRuntimeState().deferExactAfterSettle
      || isExactAfterSettleControllerActive()
      || !recoverySettled
      || cache.dirty?.political
    ) {
      scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork(
        runScenarioPoliticalBackgroundDeferredFullCacheSlice,
        { timeout: POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS },
      );
      if (!recoverySettled && deferredState.index >= normalizedEntries.length) {
        recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred(deferredState);
      }
      return false;
    }
    const transform = deferredState.transform || getRuntimeState().zoomTransform || platform.d3?.zoomIdentity;
    if (!isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(deferredState, transform)) {
      cancelScenarioPoliticalBackgroundDeferredFullCache("scene-snapshot-mismatch");
      return false;
    }

    const startedAt = nowMs();
    let processedCount = 0;
    let builtCount = 0;
    let reusedCount = 0;
    let pathlessCount = 0;
    const pathCacheHandle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
    while (deferredState.index < normalizedEntries.length) {
      if (processedCount > 0 && (nowMs() - startedAt) >= POLITICAL_DEFERRED_FULL_CACHE_CPU_BUDGET_MS) break;
      if (
        processedCount > 0
        && deadline
        && typeof deadline.timeRemaining === "function"
        && deadline.timeRemaining() <= 0
      ) {
        break;
      }
      const entry = normalizedEntries[deferredState.index];
      deferredState.index += 1;
      processedCount += 1;
      const featureId = entry?.id || getFeatureId(entry?.feature);
      if (!featureId || !entry?.feature?.geometry) {
        pathlessCount += 1;
        continue;
      }
      const cachedEntry = pathCacheHandle?.valid ? pathCacheHandle.map?.get(featureId) : null;
      const hadCachedPath = isPoliticalFeaturePathEntryCurrent(cachedEntry, entry.feature);
      const pathEntry = hadCachedPath ? cachedEntry : getPoliticalFeaturePathEntry(entry.feature, {
        featureId,
        transform,
        allowBuild: true,
        countBuild: true,
      });
      if (pathEntry?.path) {
        if (hadCachedPath) reusedCount += 1;
        else builtCount += 1;
      } else {
        pathlessCount += 1;
      }
    }

    deferredState.sliceCount = Number(deferredState.sliceCount || 0) + 1;
    deferredState.processedCount = Number(deferredState.processedCount || 0) + processedCount;
    deferredState.builtPathCount = Number(deferredState.builtPathCount || 0) + builtCount;
    deferredState.reusedPathCount = Number(deferredState.reusedPathCount || 0) + reusedCount;
    deferredState.pathlessEntryCount = Number(deferredState.pathlessEntryCount || 0) + pathlessCount;
    recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheSlice", nowMs() - startedAt, {
      phase: "idle",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      processedCount,
      builtPathCount: builtCount,
      reusedPathCount: reusedCount,
      pathlessEntryCount: pathlessCount,
      remainingCount: Math.max(0, normalizedEntries.length - deferredState.index),
      entryCount: normalizedEntries.length,
      sliceCount: deferredState.sliceCount,
      activeScenarioId: String(getRuntimeState().activeScenarioId || ""),
    });

    if (deferredState.index < normalizedEntries.length) {
      scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork(
        runScenarioPoliticalBackgroundDeferredFullCacheSlice,
        { timeout: POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS },
      );
      return builtCount > 0;
    }

    if (!isInteractionRecoverySettled({ quietMs: 600 })) {
      scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork(
        runScenarioPoliticalBackgroundDeferredFullCacheSlice,
        { timeout: POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS },
      );
      recordScenarioPoliticalBackgroundDeferredFullCacheReadyRepaintDeferred(deferredState);
      return false;
    }

    if (!isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(deferredState, transform)) {
      cancelScenarioPoliticalBackgroundDeferredFullCache("scene-snapshot-mismatch");
      return false;
    }

    const finalized = getScenarioPoliticalBackgroundFullPassGroups(normalizedEntries, {
      transform,
      allowBuild: true,
      metricName: "scenarioPoliticalBackgroundDeferredFullCacheBuild",
      phase: "idle",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
    });
    recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheComplete", nowMs() - Number(deferredState.startedAt || startedAt), {
      phase: "idle",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      entryCount: normalizedEntries.length,
      groupCount: Number(finalized?.groupCount || 0),
      builtPathCount: Number(deferredState.builtPathCount || 0),
      reusedPathCount: Number(deferredState.reusedPathCount || 0),
      pathlessEntryCount: Number(deferredState.pathlessEntryCount || 0),
      sliceCount: Number(deferredState.sliceCount || 0),
      activeScenarioId: String(getRuntimeState().activeScenarioId || ""),
    });
    scenarioPoliticalBackgroundDeferredFullCacheState = null;
    invalidateRenderPasses("political", "progressive-political-full-cache-ready");
    recordProgressivePoliticalFullCacheReadyDiagnostics(getRuntimeState(), {
      entryCount: normalizedEntries.length, groupCount: Number(finalized?.groupCount || 0), builtPathCount: Number(deferredState.builtPathCount || 0), reusedPathCount: Number(deferredState.reusedPathCount || 0), pathlessEntryCount: Number(deferredState.pathlessEntryCount || 0), sliceCount: Number(deferredState.sliceCount || 0),
    });
    const repaintRequested = requestRendererRender("progressive-political-full-cache-ready", {
      flush: false,
      fallback: renderFallback,
    });
    recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheReadyRepaintRequest", 0, {
      phase: "idle",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      reason: "progressive-political-full-cache-ready",
      repaintRequested: !!repaintRequested,
      activeScenarioId: String(getRuntimeState().activeScenarioId || ""),
    });
    return repaintRequested;
  }

  function scheduleScenarioPoliticalBackgroundDeferredFullCache(entries = [], {
    transform = state.zoomTransform || platform.d3?.zoomIdentity,
    reason = "progressive-recovery",
    fullPassIdentity = null,
  } = {}) {
    const normalizedEntries = Array.isArray(entries) ? entries.filter((entry) => entry?.feature?.geometry) : [];
    if (!normalizedEntries.length) return false;
    // The caller can share its cache lookup identity within this synchronous draw.
    // Deferred slices still validate the scene and recompute the final group identity.
    const identity = fullPassIdentity || getScenarioPoliticalBackgroundFullPassIdentity(normalizedEntries, { transform });
    if (isScenarioPoliticalBackgroundFullPassCacheKeyReady(identity.fullPassCacheKey)) return false;
    if (
      scenarioPoliticalBackgroundDeferredFullCacheState?.fullPassCacheKey === identity.fullPassCacheKey
      && isScenarioPoliticalBackgroundDeferredFullCacheStateCurrent(scenarioPoliticalBackgroundDeferredFullCacheState, transform)
      && scenarioPoliticalBackgroundDeferredFullCacheHandle
    ) {
      return true;
    }
    cancelScenarioPoliticalBackgroundDeferredFullCache("reschedule");
    scenarioPoliticalBackgroundDeferredFullCacheState = {
      fullPassCacheKey: identity.fullPassCacheKey,
      scenarioId: identity.scenarioId,
      sceneGeneration: identity.sceneGeneration,
      scenarioDataGeneration: identity.scenarioDataGeneration,
      transformSignature: identity.transformSignature,
      transform: cloneZoomTransform(transform),
      entries: normalizedEntries,
      index: 0,
      startedAt: nowMs(),
      reason: String(reason || "progressive-recovery"),
      sliceCount: 0,
      processedCount: 0,
      builtPathCount: 0,
      reusedPathCount: 0,
      pathlessEntryCount: 0,
    };
    scenarioPoliticalBackgroundDeferredFullCacheHandle = scheduleDeferredWork(
      runScenarioPoliticalBackgroundDeferredFullCacheSlice,
      { timeout: POLITICAL_DEFERRED_FULL_CACHE_TIMEOUT_MS },
    );
    recordRenderPerfMetric("scenarioPoliticalBackgroundDeferredFullCacheScheduled", 0, {
      phase: "deferred",
      recoveryQuality: POLITICAL_RECOVERY_QUALITY_PROGRESSIVE,
      entryCount: normalizedEntries.length,
      reason: String(reason || "progressive-recovery"),
      activeScenarioId: String(state.activeScenarioId || ""),
      sceneGeneration: Number(identity.sceneGeneration || 0),
      scenarioDataGeneration: Number(identity.scenarioDataGeneration || 0),
    });
    return true;
  }

  function buildScenarioPoliticalBackgroundEntries() {
    const startedAt = nowMs();
    if (!shouldUseScenarioPoliticalBackgroundMerge()) {
      recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
        cacheHit: false,
        entryCount: 0,
        featureCount: 0,
        skipped: true,
      });
      return [];
    }

    const landCollection = getScenarioPoliticalBackgroundLandCollection();
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    const featureCount = Array.isArray(landCollection?.features) ? landCollection.features.length : 0;
    const cacheKey = getScenarioPoliticalBackgroundCacheKey({
      canvasWidth,
      canvasHeight,
    });
    if (
      scenarioPoliticalBackgroundCache.runtimeRef === landCollection
      && scenarioPoliticalBackgroundCache.cacheKey === cacheKey
    ) {
      recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
        cacheHit: true,
        entryCount: scenarioPoliticalBackgroundCache.entries.length,
        featureCount,
      });
      return scenarioPoliticalBackgroundCache.entries;
    }

    const entries = [];
    (landCollection?.features || []).forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (!feature?.geometry) return;
      if (isAntarcticSectorFeature(feature, id)) return;
      if (isBaseGeographyScenarioFeature(feature)) return;
      if (shouldExcludePoliticalVisualFeature(feature, id)) return;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const projectedBounds = getProjectedFeatureBounds(feature, {
        featureId: id,
        allowCompute: true,
      });
      // This cache is reused across zoom transforms, so viewport filtering stays in the draw path.
      entries.push({
        feature,
        index,
        id,
        projectedBounds,
      });
    });
    if (!entries.length) {
      scenarioPoliticalBackgroundCache = createScenarioPoliticalBackgroundCacheState({
        runtimeRef: landCollection,
        scenarioId: state.activeScenarioId || "",
        viewMode: "ownership",
        oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
        sovereigntyRevision: Number(state.sovereigntyRevision || 0),
        shellRevision: Number(state.scenarioShellOverlayRevision || 0),
        colorRevision: Number(state.colorRevision || 0),
        canvasWidth,
        canvasHeight,
        cacheKey,
        entries: [],
      });
      recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
        cacheHit: false,
        entryCount: 0,
        featureCount,
      });
      return scenarioPoliticalBackgroundCache.entries;
    }

    scenarioPoliticalBackgroundCache = createScenarioPoliticalBackgroundCacheState({
      runtimeRef: landCollection,
      scenarioId: state.activeScenarioId || "",
      viewMode: "ownership",
      oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
      sovereigntyRevision: Number(state.sovereigntyRevision || 0),
      shellRevision: Number(state.scenarioShellOverlayRevision || 0),
      colorRevision: Number(state.colorRevision || 0),
      canvasWidth,
      canvasHeight,
      cacheKey,
      entries,
    });
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: false,
      entryCount: entries.length,
      featureCount,
    });
    return entries;
  }

  function buildScenarioPoliticalBackgroundEntriesFromSpatialItems(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      feature: item?.feature || null,
      index: Number(item?.drawOrder || 0),
      id: item?.id || "",
      projectedBounds: item
        ? {
          minX: Number(item.minX),
          minY: Number(item.minY),
          maxX: Number(item.maxX),
          maxY: Number(item.maxY),
        }
        : null,
    })).filter((entry) => (
      entry.feature?.geometry
      && entry.id
      && entry.projectedBounds
      && !shouldExcludePoliticalVisualFeature(entry.feature, entry.id)
    ));
  }

  function collectScenarioPoliticalBackgroundSpatialEntries({
    screenRects = null,
    transform = state.zoomTransform || platform.d3?.zoomIdentity,
    visibleItems = null,
  } = {}) {
    const landCollection = getScenarioPoliticalBackgroundLandCollection();
    if (landCollection !== state.landData) {
      return null;
    }
    if (Array.isArray(visibleItems)) {
      return buildScenarioPoliticalBackgroundEntriesFromSpatialItems(visibleItems);
    }
    if (!Array.isArray(state.spatialItems) || !state.spatialItems.length) {
      return null;
    }
    if (!Array.isArray(screenRects) || !screenRects.length) {
      const items = collectVisibleLandSpatialItems();
      return Array.isArray(items)
        ? buildScenarioPoliticalBackgroundEntriesFromSpatialItems(items)
        : null;
    }
    const projectedRects = screenRects
      .map((rect) => screenRectToProjectedRect(rect, transform))
      .filter(Boolean);
    if (!projectedRects.length) {
      return [];
    }
    const candidateResult = collectLandSpatialItemsForProjectedRects(projectedRects);
    if (!candidateResult || candidateResult.overflow) {
      return null;
    }
    return buildScenarioPoliticalBackgroundEntriesFromSpatialItems(candidateResult.items);
  }

  function drawScenarioPoliticalBackgroundFills({
    screenRects = null,
    transform = state.zoomTransform || platform.d3?.zoomIdentity,
    visibleItems = null,
    returnSummary = false,
  } = {}) {
    const politicalRecoveryQuality = getPoliticalRecoveryQuality();
    const entries =
      collectScenarioPoliticalBackgroundSpatialEntries({
        screenRects,
        transform,
        visibleItems,
      })
      || buildScenarioPoliticalBackgroundEntries();
    if (!entries.length) {
      return returnSummary
        ? {
          groupCount: 0,
          entryCount: 0,
          reusedPathCount: 0,
          builtPathCount: 0,
          pathlessEntryCount: 0,
          cacheHit: false,
          recoveryQuality: politicalRecoveryQuality,
          progressive: false,
        }
        : 0;
    }
    const normalizedScreenRects = Array.isArray(screenRects) && screenRects.length
      ? screenRects
      : null;
    const visibleEntries = normalizedScreenRects
      ? entries.filter(({ projectedBounds }) =>
        projectedBoundsIntersectScreenRects(projectedBounds, normalizedScreenRects, { transform })
      )
      : entries;
    const canUseFullPassCache = Array.isArray(visibleItems);
    const politicalDirtyReason = String(getRenderPassCacheState().reasons?.political || "");
    const pendingPoliticalColorEdit = hasPendingPoliticalColorEdit();
    const useProgressiveRecovery = (
      canUseFullPassCache
      && politicalRecoveryQuality === POLITICAL_RECOVERY_QUALITY_PROGRESSIVE
      && politicalDirtyReason !== "refresh-colors"
      && !pendingPoliticalColorEdit
      && visibleEntries.length > POLITICAL_PROGRESSIVE_BACKGROUND_EXACT_ENTRY_LIMIT
    );
    if (useProgressiveRecovery) {
      // Warm the grouped paths in the background. Until they are ready, the
      // foreground loop draws interactive features. Paint noninteractive shell
      // coverage here while waiting for the grouped cache. Modern admin0 is not a valid
      // political fallback for a scenario with different borders or owners.
      const cachedFullPass = getScenarioPoliticalBackgroundFullPassGroups(visibleEntries, {
        transform,
        allowBuild: false,
        phase: "render",
        recoveryQuality: politicalRecoveryQuality,
      });
      if (cachedFullPass.cacheHit) {
        const groupCount = drawPoliticalBackgroundFillsFromGroups(cachedFullPass.groups);
        return returnSummary
          ? {
            groupCount,
            entryCount: Number(cachedFullPass.entryCount || 0),
            reusedPathCount: Number(cachedFullPass.reusedPathCount || 0),
            builtPathCount: Number(cachedFullPass.builtPathCount || 0),
            pathlessEntryCount: Number(cachedFullPass.pathlessEntryCount || 0),
            cacheHit: true,
            recoveryQuality: politicalRecoveryQuality,
            progressive: true,
            deferredFullCacheReady: true,
            deferredFullCacheScheduled: false,
          }
          : groupCount;
      }
      const underlayStartedAt = nowMs();
      const foregroundIds = new Set((state.landData?.features || []).map(getFeatureId).filter(Boolean));
      const underlayEntries = visibleEntries.filter((entry) => !foregroundIds.has(getFeatureId(entry.feature) || entry.id));
      const underlaySummary = underlayEntries.length
        ? drawPoliticalBackgroundFillsForEntries(underlayEntries, {
          transform, useFullPassCache: false, returnSummary: true,
          recoveryQuality: politicalRecoveryQuality,
        })
        : { groupCount: 0, reusedPathCount: 0, builtPathCount: 0, pathlessEntryCount: 0 };
      const deferredFullCacheScheduled = scheduleScenarioPoliticalBackgroundDeferredFullCache(visibleEntries, {
        transform,
        reason: "progressive-recovery-background",
        fullPassIdentity: cachedFullPass.fullPassIdentity,
      });
      const durationMs = nowMs() - underlayStartedAt;
      recordRenderPerfMetric("scenarioPoliticalBackgroundProgressiveRecovery", durationMs, {
        phase: "render",
        recoveryQuality: politicalRecoveryQuality,
        entryCount: visibleEntries.length,
        underlayEntryCount: underlayEntries.length,
        exactEntryLimit: POLITICAL_PROGRESSIVE_BACKGROUND_EXACT_ENTRY_LIMIT,
        deferredFullCacheScheduled: !!deferredFullCacheScheduled,
        deferredFullCacheReady: false,
        activeScenarioId: String(state.activeScenarioId || ""),
      });
      return returnSummary
        ? {
          groupCount: underlaySummary.groupCount,
          entryCount: visibleEntries.length,
          underlayEntryCount: underlayEntries.length,
          reusedPathCount: underlaySummary.reusedPathCount,
          builtPathCount: underlaySummary.builtPathCount,
          pathlessEntryCount: underlaySummary.pathlessEntryCount,
          cacheHit: false,
          recoveryQuality: politicalRecoveryQuality,
          progressive: true,
          deferredFullCacheReady: false,
          deferredFullCacheScheduled: !!deferredFullCacheScheduled,
          coarseUnderlay: "scenario-features",
        }
        : underlaySummary.groupCount;
    }
    return drawPoliticalBackgroundFillsForEntries(visibleEntries, {
      transform,
      useFullPassCache: canUseFullPassCache,
      returnSummary,
      recoveryQuality: politicalRecoveryQuality,
    });
  }


  function buildAdmin0MergedShapes() {
    const topology = state.topologyPrimary || state.topology;
    if (!topology?.objects?.political || !platform.topojson?.merge) return [];

    const geometries = topology.objects.political.geometries || [];
    const currentFeatureCount = state.landData?.features?.length || 0;

    if (
      admin0MergedCache.topologyRef === topology &&
      admin0MergedCache.featureCount === currentFeatureCount
    ) {
      return admin0MergedCache.entries;
    }

    const byCountry = new Map();
    geometries.forEach((geom) => {
      const code = String(geom?.properties?.cntr_code || "").trim().toUpperCase();
      if (!code) return;
      if (!byCountry.has(code)) byCountry.set(code, []);
      byCountry.get(code).push(geom);
    });

    const entries = [];
    byCountry.forEach((geoms, code) => {
      try {
        const mergedShape = platform.topojson.merge(topology, geoms);
        const mergedFeature = {
          type: "Feature",
          properties: {
            id: `admin0-background-${code}`,
            cntr_code: code,
          },
          geometry: mergedShape,
        };
        entries.push({
          code,
          mergedShape,
          mergedFeature,
          projectedBounds: getProjectedFeatureBounds(mergedFeature, { allowCompute: true }),
        });
      } catch (_e) {
        // Skip countries that fail to merge
      }
    });

    admin0MergedCache = {
      topologyRef: topology,
      featureCount: currentFeatureCount,
      entries,
    };
    return entries;
  }

  function drawAdmin0BackgroundFills({
    screenRects = null,
    transform = state.zoomTransform || platform.d3?.zoomIdentity,
  } = {}) {
    const entries = buildAdmin0MergedShapes();
    if (!entries.length) return;

    entries.forEach(({ code, mergedShape, mergedFeature, projectedBounds }) => {
      if (code === "ATL") return;
      if (!projectedBoundsIntersectScreenRects(projectedBounds, screenRects, { transform })) {
        return;
      }
      const fillColor = getAdmin0BackgroundFillColor(code);

      surface.getContext().beginPath();
      surface.getPathCanvas()(mergedFeature || {
        type: "Feature",
        properties: {
          id: `admin0-background-${code}`,
          cntr_code: code,
        },
        geometry: mergedShape,
      });
      surface.getContext().fillStyle = fillColor;
      surface.getContext().fill();
    });
  }

  function drawOceanDepthMaskLayer() {
    if (!surface.getContext() || !surface.getProjection()) return null;
    const intensityFields = normalizeIntensityFieldsState(state.intensityFields);
    commitIntensityFieldsState(intensityFields);
    const channel = intensityFields.channels.oceanDepth;
    if (!channel?.enabled) return null;

    const layout = getRenderPassLayout("background");
    const widthPx = Number(layout?.pixelWidth || surface.getContext().canvas?.width || 0);
    const heightPx = Number(layout?.pixelHeight || surface.getContext().canvas?.height || 0);
    const startedAt = nowMs();
    const maskResult = getIntensityFieldMaskOwner().getMaskCanvas("oceanDepth", {
      transform: state.zoomTransform || platform.d3?.zoomIdentity,
      widthPx,
      heightPx,
      dpr: Number(layout?.dpr || state.dpr || 1),
      offsetX: Number(layout?.offsetX || 0),
      offsetY: Number(layout?.offsetY || 0),
      grayMap: OCEAN_DEPTH_MASK_GRAY_MAP,
      projectionKey: getProjectionRenderSignature(),
    });

    if (!maskResult?.canvas) {
      recordRenderPerfMetric("drawOceanDepthMaskLayer", nowMs() - startedAt, {
        drawn: false,
        reason: maskResult?.reason || "empty",
        cacheHit: !!maskResult?.cacheHit,
        renderedRunCount: Number(maskResult?.renderedRunCount || 0),
        renderedCellCount: Number(maskResult?.renderedCellCount || 0),
      });
      return maskResult || null;
    }

    surface.getContext().save();
    try {
      applyOceanClipMask(state.oceanMaskMode || OCEAN_MASK_MODE_TOPOLOGY);
      surface.getContext().globalCompositeOperation = OCEAN_DEPTH_MASK_BLEND_MODE;
      surface.getContext().globalAlpha = 1;
      surface.getContext().setTransform(1, 0, 0, 1, 0, 0);
      surface.getContext().drawImage(maskResult.canvas, 0, 0);
    } finally {
      surface.getContext().restore();
    }

    recordRenderPerfMetric("drawOceanDepthMaskLayer", nowMs() - startedAt, {
      drawn: true,
      blendMode: OCEAN_DEPTH_MASK_BLEND_MODE,
      cacheHit: !!maskResult.cacheHit,
      renderedRunCount: Number(maskResult.renderedRunCount || 0),
      renderedCellCount: Number(maskResult.renderedCellCount || 0),
    });
    return maskResult;
  }

  function drawBackgroundPass() {
    const oceanFillColor = getOceanBaseFillColor();
    surface.getContext().fillStyle = oceanFillColor;
    surface.getContext().beginPath();
    surface.getPathCanvas()({ type: "Sphere" });
    surface.getContext().fill();

    // The opaque sphere already covers every projected ocean polygon with
    // this same color. Reprojecting the coastline here adds no visible layer.
    drawOceanStyle();
    drawOceanDepthMaskLayer();
  }

  function drawPoliticalBackgroundFills(options = {}) {
    if (getDebugMode() !== "PROD") {
      return options.returnSummary
        ? {
          groupCount: 0,
          entryCount: 0,
          reusedPathCount: 0,
          builtPathCount: 0,
          pathlessEntryCount: 0,
          cacheHit: false,
        }
        : 0;
    }
    if (shouldUseScenarioPoliticalBackgroundMerge()) {
      return drawScenarioPoliticalBackgroundFills(options);
    }
    drawAdmin0BackgroundFills(options);
    return options.returnSummary
      ? {
        groupCount: 0,
        entryCount: 0,
        reusedPathCount: 0,
        builtPathCount: 0,
        pathlessEntryCount: 0,
        cacheHit: false,
      }
      : 0;
  }

  function drawPoliticalBackgroundFillsForEntries(entries = [], {
    transform = state.zoomTransform || platform.d3?.zoomIdentity,
    useFullPassCache = false,
    returnSummary = false,
    recoveryQuality = getPoliticalRecoveryQuality(),
  } = {}) {
    if (getDebugMode() !== "PROD") {
      return returnSummary
        ? {
          groupCount: 0,
          entryCount: 0,
          reusedPathCount: 0,
          builtPathCount: 0,
          pathlessEntryCount: 0,
          cacheHit: false,
          recoveryQuality,
        }
        : 0;
    }
    const useScenarioBackgroundMerge = shouldUseScenarioPoliticalBackgroundMerge();
    const groupSummary = useFullPassCache && useScenarioBackgroundMerge
      ? getScenarioPoliticalBackgroundFullPassGroups(entries, {
        transform,
        recoveryQuality,
        phase: "render",
      })
      : {
        cacheHit: false,
        recoveryQuality,
        ...buildPoliticalBackgroundResolvedGroups(entries, {
          transform,
          useScenarioBackgroundMerge,
          // These entries must be painted now. Persist each cold path so the
          // deferred full cache and subsequent frames reuse the same geometry.
          allowBuildPaths: true,
        }),
      };
    const groupCount = drawPoliticalBackgroundFillsFromGroups(groupSummary.groups);
    if (returnSummary) {
      return {
        groupCount,
        entryCount: Number(groupSummary.entryCount || 0),
        reusedPathCount: Number(groupSummary.reusedPathCount || 0),
        builtPathCount: Number(groupSummary.builtPathCount || 0),
        pathlessEntryCount: Number(groupSummary.pathlessEntryCount || 0),
        cacheHit: !!groupSummary.cacheHit,
        recoveryQuality,
        progressive: false,
      };
    }
    return groupCount;
  }
  return Object.freeze({
    drawBackgroundPass,
    drawPoliticalBackgroundFills,
    drawPoliticalBackgroundFillsForEntries,
    cancelScenarioPoliticalBackgroundDeferredFullCache,
    shouldFallbackScenarioPoliticalBackgroundMergeShape,
  });
}
