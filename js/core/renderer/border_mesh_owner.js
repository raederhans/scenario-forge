import {
  evaluateCoastlineTopologyDiagnostics,
} from "./border_mesh_diagnostics.js";
import {
  buildCountryParentBorderMeshes as buildCountryParentBorderMeshesFromSources,
  buildGlobalCoastlineMesh as buildGlobalCoastlineMeshFromSources,
  buildGlobalCountryBorderMesh as buildGlobalCountryBorderMeshFromSources,
  buildSourceBorderMeshes as buildSourceBorderMeshesFromSources,
  getSourceCountrySets as getSourceCountrySetsFromSelection,
  getSourceCountrySetsSteps,
} from "./border_mesh_source_selection.js";
import {
  buildDetailAdmBorderMesh as buildDetailAdmBorderMeshRuntime,
  buildDynamicBorderHash,
  simplifyCoastlineMesh as simplifyCoastlineMeshRuntime,
} from "./border_mesh_dynamic_runtime.js";
import {
  patchBorderMeshCacheState,
  replaceCachedCoastlineMeshesState,
  replaceCachedDetailAdmBordersState,
  setDynamicBordersDirtyState,
  setPendingDynamicBorderTimerState,
} from "../state/actions/renderer_cache_actions.js";

import { getBorderCountryAssignmentRevision, isAtlantropaCoastlineLandVisible } from "./border_mesh_queries.js";

export function createBorderMeshOwner({
  state,
  constants = {},
  helpers = {},
} = {}) {
  const {
    coastlineEffectiveAreaMultiplier = 0.5,
    scenarioCoastlineMaxAreaDeltaRatio = 0.02,
    scenarioCoastlineMaxInteriorRingCount = 500,
    scenarioCoastlineMaxInteriorRingRatio = 0.25,
  } = constants;

  const {
    asFeatureLike,
    canonicalCountryCode,
    setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeoutFn = (timerId) => globalThis.clearTimeout(timerId),
    renderDynamicBorders = () => {},
    getDetailAdmMeshBuildState = () => ({ signature: "", status: "idle" }),
    setDetailAdmMeshBuildState = () => {},
    scheduleDeferredHeavyBorderMeshes = () => {},
    syncStaticMeshSnapshot = () => {},
    ensureSovereigntyState = () => {},
    getAdmin1Group,
    getEntityCountryCode,
    getEntityBorderMeshCountryCode = getEntityCountryCode,
    getFeatureCountryCodeNormalized,
    getFeatureBorderMeshCountryCodeNormalized = getFeatureCountryCodeNormalized,
    getFeatureId,
    getLatitudeAdjustedSimplifyEpsilon,
    getLineLength,
    getParentGroupForEntity,
    incrementPerfCounter = () => {},
    invalidateRenderPasses = () => {},
    isDynamicBordersEnabled = () => false,
    isAdmDetailTier,
    isUsableMesh,
    isWorldBounds,
    nowMs = () => 0,
    publishScenarioCoastlineDecision,
    recordRenderPerfMetric = () => {},
    sanitizePolyline,
    shouldExcludeOwnerBorderEntity,
    shouldExcludePoliticalInteractionFeature,
    simplifyPolylineEffectiveArea,
    getStaticMeshSourceCountries = () => ({ primary: new Set(), detail: new Set() }),
    getScenarioSurfaceVersionSignal = () => "",
    updateDynamicBorderStatusUI = () => {},
  } = helpers;

  // scenarioCoastlineSourceCache 只缓存“当前拓扑引用 + scenarioId”对应的海岸线来源判定，
  // 让 resolveCoastlineTopologySource 在同一帧内重复调用时复用 decision 结果，
  // 同时在 primaryRef/runtimeRef/scenarioId 任一变化时立即触发重判定。
  let scenarioCoastlineSourceCache = {
    primaryRef: null,
    runtimeRef: null,
    scenarioId: "",
    scenarioSurfaceVersionSignal: "",
    decision: null,
  };
  const scenarioCoastlineDecisionWarnings = new Set();
  const pendingDynamicBorderTimer = { handle: null };

  function clearPendingDynamicBorderTimer() {
    if (pendingDynamicBorderTimer.handle) {
      clearTimeoutFn(pendingDynamicBorderTimer.handle);
      pendingDynamicBorderTimer.handle = null;
      setPendingDynamicBorderTimerState(state, null);
    }
  }

  function markDynamicBordersDirty(reason = "") {
    const dirty = isDynamicBordersEnabled();
    setDynamicBordersDirtyState(state, dirty, dirty ? String(reason || "").trim() : "");
    updateDynamicBorderStatusUI();
  }

  function recomputeDynamicBordersNow({ renderNow = true, reason = "" } = {}) {
    clearPendingDynamicBorderTimer();
    const dynamicBordersEnabled = isDynamicBordersEnabled();
    if (!dynamicBordersEnabled) {
      setDynamicBordersDirtyState(state, false, "");
      updateDynamicBorderStatusUI();
      return false;
    }
    if (reason) setDynamicBordersDirtyState(state, dynamicBordersEnabled, String(reason));
    rebuildDynamicBorders();
    if (renderNow) renderDynamicBorders();
    return true;
  }

  function scheduleDynamicBorderRecompute(reason = "", delayMs = 150) {
    markDynamicBordersDirty(reason);
    clearPendingDynamicBorderTimer();
    const timerId = setTimeoutFn(() => {
      pendingDynamicBorderTimer.handle = null;
      setPendingDynamicBorderTimerState(state, null);
      recomputeDynamicBordersNow({ renderNow: true, reason });
    }, Math.max(0, Number(delayMs) || 0));
    pendingDynamicBorderTimer.handle = timerId;
    setPendingDynamicBorderTimerState(state, timerId);
  }

  function replaceDetailAdmBorders(meshes = []) {
    replaceCachedDetailAdmBordersState(state, meshes);
  }

  // The draw pass requests detail meshes; this owner retires stale cache entries
  // before scheduling their replacement so a snapshot cannot revive old borders.
  function reconcileDetailAdmBorders({ signature, detailCountries }) {
    const buildState = getDetailAdmMeshBuildState();
    if (signature !== buildState.signature) {
      const hadMeshes = state.cachedDetailAdmBorders.length > 0;
      replaceDetailAdmBorders();
      setDetailAdmMeshBuildState({
        signature,
        status: detailCountries.length ? "building" : "empty",
      });
      if (hadMeshes) syncStaticMeshSnapshot();
      if (detailCountries.length) scheduleDeferredHeavyBorderMeshes();
    } else if (!state.cachedDetailAdmBorders.length && buildState.status === "idle" && detailCountries.length) {
      setDetailAdmMeshBuildState({ signature, status: "building" });
      scheduleDeferredHeavyBorderMeshes();
    }
  }

  function rebuildDynamicBorders() {
    const startedAt = nowMs();
    incrementPerfCounter("dynamicBorderRebuilds");
    if (!isDynamicBordersEnabled()) {
      patchBorderMeshCacheState(state, { cachedDynamicBordersHash: null });
      setDynamicBordersDirtyState(state, false, "");
      clearPendingDynamicBorderTimer();
      updateDynamicBorderStatusUI();
      recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
        enabled: false,
      });
      return false;
    }

    ensureSovereigntyState();
    const nextHash = buildDynamicBorderHash({
      sovereigntyRevision: state.sovereigntyRevision,
      activeScenarioId: state.activeScenarioId,
      scenarioShellOverlayRevision: state.scenarioShellOverlayRevision,
    });
    if (state.cachedDynamicBordersHash === nextHash) {
      setDynamicBordersDirtyState(state, false, "");
      updateDynamicBorderStatusUI();
      recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
        enabled: true,
        cacheHit: true,
      });
      return true;
    }

    patchBorderMeshCacheState(state, { cachedDynamicBordersHash: nextHash });
    setDynamicBordersDirtyState(state, false, "");
    updateDynamicBorderStatusUI();
    invalidateRenderPasses("borders", "dynamic-borders");
    recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
      enabled: true,
      cacheHit: false,
    });
    return true;
  }

  function refreshScenarioOpeningOwnerBorders(reason = "") {
    const startedAt = nowMs();
    const enabled =
      !!String(state.activeScenarioId || "")
      && state.scenarioBorderMode === "scenario_owner_only"
      && (
        isUsableMesh(state.activeScenarioMeshPack?.meshes?.opening_owner_borders || null)
        || (!!state.runtimePoliticalTopology?.objects?.political
          && Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0)
      );
    invalidateRenderPasses("borders", reason || "scenario-opening-borders");
    recordRenderPerfMetric("refreshScenarioOpeningOwnerBorders", nowMs() - startedAt, {
      enabled,
    });
    return enabled;
  }

  const buildDetailAdmBorderMesh = (topology, includedCountries) =>
    buildDetailAdmBorderMeshRuntime({
      topology,
      includedCountries,
      asFeatureLike,
      shouldExcludePoliticalInteractionFeature,
      getEntityCountryCode: getEntityBorderMeshCountryCode,
      isAdmDetailTier,
    });

  function getSourceCountrySets() {
    return getSourceCountrySetsFromSelection({
      state,
      getFeatureCountryCodeNormalized: getFeatureBorderMeshCountryCodeNormalized,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
    });
  }

  async function prepareSourceCountrySets({
    fullCollection = state.landDataFull,
    landCollection = state.landData,
    isCurrent = () => true,
    yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
    nowMs: preparationNowMs = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    const sourceFeatures = Array.isArray(fullCollection?.features) && fullCollection.features.length
      ? fullCollection.features : (Array.isArray(landCollection?.features) ? landCollection.features : []);
    const iterator = getSourceCountrySetsSteps({
      state: { landData: { features: sourceFeatures } },
      getFeatureCountryCodeNormalized: getFeatureBorderMeshCountryCodeNormalized,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
    });
    let yieldCount = 0, maxSliceMs = 0, work = 0, sliceStartedAt = preparationNowMs();
    let current = isCurrent();
    try {
      while (current) {
        const next = iterator.next();
        if (next.done) {
          maxSliceMs = Math.max(maxSliceMs, preparationNowMs() - sliceStartedAt);
          if (!isCurrent()) break;
          return { status: "prepared", sourceCountries: next.value, sourceFeatures, maxSliceMs, yieldCount };
        }
        if (++work % 512 === 0) {
          const sliceMs = preparationNowMs() - sliceStartedAt;
          if (sliceMs >= 4) {
            maxSliceMs = Math.max(maxSliceMs, sliceMs);
            yieldCount++;
            await yieldControl();
            current = isCurrent();
            if (!current) break;
            sliceStartedAt = preparationNowMs();
          }
        }
      }
      return { status: "cancelled", sourceCountries: null, sourceFeatures, maxSliceMs, yieldCount };
    } finally {
      iterator.return();
    }
  }

  function buildCountryParentBorderMeshes(countryCode) {
    return buildCountryParentBorderMeshesFromSources({
      countryCode,
      state,
      canonicalCountryCode,
      getStaticMeshSourceCountries,
      getEntityCountryCode: getEntityBorderMeshCountryCode,
      getParentGroupForEntity,
      isUsableMesh,
    });
  }

  function buildSourceBorderMeshes(topology, includedCountries, { includeProvince = true, includeLocal = true } = {}) {
    return buildSourceBorderMeshesFromSources({
      topology,
      includedCountries,
      includeProvince,
      includeLocal,
      countryAssignmentRevision: getBorderCountryAssignmentRevision(state),
      canonicalCountryCode,
      asFeatureLike,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized: getFeatureBorderMeshCountryCodeNormalized,
      getAdmin1Group,
      isUsableMesh,
    });
  }

  function buildGlobalCountryBorderMesh(primaryTopology) {
    return buildGlobalCountryBorderMeshFromSources({
      primaryTopology,
      asFeatureLike,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
    });
  }

  // 海岸线来源判定使用 scenarioCoastlineSourceCache，key=primaryRef+runtimeRef+scenarioId。
  // 当 runtime land mask 的面积/洞数量超出阈值时强制回退 primary，
  // 这样可以避免异常场景蒙版污染 cachedCoastlines* 的可视化质量。
  function resolveCoastlineTopologySource() {
    const primaryTopology = state.topologyPrimary || state.topology || null;
    const runtimeTopology = state.runtimePoliticalTopology || null;
    const scenarioId = String(state.activeScenarioId || "").trim();
    const hasDedicatedCoastline = !!runtimeTopology?.objects?.scenario_coastline;
    const atlantropaLandVisible = isAtlantropaCoastlineLandVisible(state);
    const scenarioSurfaceVersionSignal = [
      String(getScenarioSurfaceVersionSignal() || ""),
      `coastline-land:${atlantropaLandVisible}`,
      `topology:${Number(state.topologyRevision || 0)}`,
    ].join("|");

    const cacheMatches =
      scenarioCoastlineSourceCache.primaryRef === primaryTopology &&
      scenarioCoastlineSourceCache.runtimeRef === runtimeTopology &&
      scenarioCoastlineSourceCache.scenarioId === scenarioId &&
      scenarioCoastlineSourceCache.scenarioSurfaceVersionSignal === scenarioSurfaceVersionSignal;
    if (cacheMatches && scenarioCoastlineSourceCache.decision) {
      return scenarioCoastlineSourceCache.decision;
    }
    const { decision } = evaluateCoastlineTopologyDiagnostics({
      primaryTopology,
      runtimeTopology: hasDedicatedCoastline && !atlantropaLandVisible ? null : runtimeTopology,
      scenarioId,
      runtimeObjectNames: hasDedicatedCoastline ? ["scenario_coastline"] : undefined,
      scenarioCoastlineMaxAreaDeltaRatio,
      scenarioCoastlineMaxInteriorRingCount,
      scenarioCoastlineMaxInteriorRingRatio,
      isWorldBounds,
    });
    const publishedDiagnostics = publishScenarioCoastlineDecision({
      ...decision,
      scenarioSurfaceVersionSignal,
    });
    const publishedDecision = {
      ...publishedDiagnostics,
      topology: decision.source === "scenario" ? runtimeTopology : primaryTopology,
    };

    if (scenarioId) {
      const logKey = `${scenarioId}::${publishedDecision.source}::${publishedDecision.reason}`;
      if (!scenarioCoastlineDecisionWarnings.has(logKey)) {
        scenarioCoastlineDecisionWarnings.add(logKey);
        console.info(
          `[map_renderer] Scenario coastline source ${publishedDecision.source}: scenario=${scenarioId} reason=${publishedDecision.reason} runtimeObject=${publishedDecision.runtimeObjectName || "(none)"} areaDelta=${(Number(publishedDecision.areaDeltaRatio) || 0).toFixed(5)} interiorRings=${Number(publishedDecision.runtimeInteriorRingCount || 0)} parts=${Number(publishedDecision.runtimePolygonPartCount || 0)}`
        );
      }
    }

    scenarioCoastlineSourceCache = {
      primaryRef: primaryTopology,
      runtimeRef: runtimeTopology,
      scenarioId,
      scenarioSurfaceVersionSignal,
      decision: publishedDecision,
    };
    return scenarioCoastlineSourceCache.decision;
  }

  function buildGlobalCoastlineMesh(primaryTopology) {
    return buildGlobalCoastlineMeshFromSources({
      topologyInput: primaryTopology,
      shouldExcludeOwnerBorderEntity,
    });
  }

  const simplifyCoastlineMesh = (mesh, { epsilon = 0, minLength = 0 } = {}) =>
    simplifyCoastlineMeshRuntime({
      mesh,
      epsilon,
      minLength,
      isUsableMesh,
      sanitizePolyline,
      getLatitudeAdjustedSimplifyEpsilon,
      coastlineEffectiveAreaMultiplier,
      simplifyPolylineEffectiveArea,
      getLineLength,
    });

  let coastlineMeshCache = null;
  function ensureCoastlineMeshes({ mid = {}, low = {} } = {}) {
    const decision = resolveCoastlineTopologySource();
    const topology = decision?.topology;
    const objectName = decision?.source === "scenario" ? decision.runtimeObjectName : decision?.primaryObjectName;
    const object = topology?.objects?.[objectName];
    const lodKey = [mid.epsilon || 0, mid.minLength || 0, low.epsilon || 0, low.minLength || 0].join("|");
    if (object && coastlineMeshCache?.topology === topology
      && coastlineMeshCache.object === object && coastlineMeshCache.arcs === topology.arcs
      && coastlineMeshCache.transform === topology.transform && coastlineMeshCache.lodKey === lodKey
      && coastlineMeshCache.meshFunction === globalThis.topojson?.mesh) {
      // A static-mesh reset clears the arrays, but does not invalidate unchanged
      // coastline geometry. Restore its LODs without decoding/simplifying again.
      replaceCachedCoastlineMeshesState(state, coastlineMeshCache.collections);
      return;
    }
    const mesh = buildGlobalCoastlineMesh(decision);
    const high = isUsableMesh(mesh) ? [mesh] : [];
    const midMesh = high.length ? simplifyCoastlineMesh(mesh, mid) : null;
    const lowMesh = high.length ? simplifyCoastlineMesh(mesh, low) : null;
    const midCollection = isUsableMesh(midMesh) ? [midMesh] : high;
    const collections = {
      cachedCoastlines: high,
      cachedCoastlinesHigh: high,
      cachedCoastlinesMid: midCollection,
      cachedCoastlinesLow: isUsableMesh(lowMesh) ? [lowMesh] : midCollection,
    };
    replaceCachedCoastlineMeshesState(state, collections);
    coastlineMeshCache = {
      topology, object, arcs: topology?.arcs, transform: topology?.transform, lodKey,
      meshFunction: globalThis.topojson?.mesh,
      collections,
    };
  }

  return Object.freeze({
    clearPendingDynamicBorderTimer,
    markDynamicBordersDirty,
    recomputeDynamicBordersNow,
    scheduleDynamicBorderRecompute,
    replaceDetailAdmBorders,
    reconcileDetailAdmBorders,
    rebuildDynamicBorders,
    refreshScenarioOpeningOwnerBorders,
    buildDetailAdmBorderMesh,
    getSourceCountrySets,
    prepareSourceCountrySets,
    buildCountryParentBorderMeshes,
    buildSourceBorderMeshes,
    buildGlobalCountryBorderMesh,
    resolveCoastlineTopologySource,
    buildGlobalCoastlineMesh,
    simplifyCoastlineMesh,
    ensureCoastlineMeshes,
  });
}
