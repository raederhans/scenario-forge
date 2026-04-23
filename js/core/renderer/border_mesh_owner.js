import {
  evaluateCoastlineTopologySource,
} from "./border_mesh_diagnostics.js";
import {
  buildCountryParentBorderMeshes as buildCountryParentBorderMeshesFromSources,
  buildGlobalCoastlineMesh as buildGlobalCoastlineMeshFromSources,
  buildGlobalCountryBorderMesh as buildGlobalCountryBorderMeshFromSources,
  buildSourceBorderMeshes as buildSourceBorderMeshesFromSources,
  getSourceCountrySets as getSourceCountrySetsFromSelection,
  resolveScenarioOpeningOwnerBorderSelection,
} from "./border_mesh_source_selection.js";
import {
  buildDetailAdmBorderMesh as buildDetailAdmBorderMeshRuntime,
  buildDynamicBorderHash,
  buildDynamicOwnerBorderMesh as buildDynamicOwnerBorderMeshRuntime,
  buildOwnerBorderMesh as buildOwnerBorderMeshRuntime,
  countUnresolvedOwnerBorderEntities as countUnresolvedOwnerBorderEntitiesRuntime,
  getDynamicBorderOwnershipContext,
  simplifyCoastlineMesh as simplifyCoastlineMeshRuntime,
} from "./border_mesh_dynamic_runtime.js";

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
    clearPendingDynamicBorderTimer = () => {},
    ensureSovereigntyState = () => {},
    getAdmin1Group,
    getEntityCountryCode,
    getFeatureCountryCodeNormalized,
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
    resolveOwnerBorderCode,
    sanitizePolyline,
    shouldExcludeOwnerBorderEntity,
    shouldExcludePoliticalInteractionFeature,
    simplifyPolylineEffectiveArea,
    getStaticMeshSourceCountries = () => ({ primary: new Set(), detail: new Set() }),
    updateDynamicBorderStatusUI = () => {},
  } = helpers;

  // scenarioCoastlineSourceCache 只缓存“当前拓扑引用 + scenarioId”对应的海岸线来源判定，
  // 让 resolveCoastlineTopologySource 在同一帧内重复调用时复用 decision 结果，
  // 同时在 primaryRef/runtimeRef/scenarioId 任一变化时立即触发重判定。
  let scenarioCoastlineSourceCache = {
    primaryRef: null,
    runtimeRef: null,
    scenarioId: "",
    decision: null,
  };
  let scenarioOpeningOwnerBorderCache = {
    runtimeRef: null,
    meshPackRef: null,
    scenarioId: "",
    baselineHash: "",
    baselineOwnersRef: null,
    shellRevision: 0,
    meshSource: "",
    mesh: null,
  };
  const scenarioCoastlineDecisionWarnings = new Set();

  const buildOwnerBorderMesh = (runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) =>
    buildOwnerBorderMeshRuntime({
      runtimeTopology,
      ownershipContext,
      excludeSea,
      shouldExcludeOwnerBorderEntity,
      resolveOwnerBorderCode,
    });

  const buildDynamicOwnerBorderMesh = (runtimeTopology, ownershipContext) =>
    buildDynamicOwnerBorderMeshRuntime({
      runtimeTopology,
      ownershipContext,
      shouldExcludeOwnerBorderEntity,
      resolveOwnerBorderCode,
    });

  const countUnresolvedOwnerBorderEntities = (runtimeTopology, ownershipContext = {}) =>
    countUnresolvedOwnerBorderEntitiesRuntime({
      runtimeTopology,
      ownershipContext,
      shouldExcludeOwnerBorderEntity,
      resolveOwnerBorderCode,
    });

  function rebuildDynamicBorders() {
    const startedAt = nowMs();
    incrementPerfCounter("dynamicBorderRebuilds");
    state.cachedBorders = null;
    if (!isDynamicBordersEnabled()) {
      state.cachedDynamicOwnerBorders = null;
      state.cachedDynamicBordersHash = null;
      state.dynamicBordersDirty = false;
      state.dynamicBordersDirtyReason = "";
      clearPendingDynamicBorderTimer();
      updateDynamicBorderStatusUI();
      recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
        enabled: false,
        segmentCount: 0,
      });
      return false;
    }

    ensureSovereigntyState();
    const nextHash = buildDynamicBorderHash({
      sovereigntyRevision: state.sovereigntyRevision,
      activeScenarioId: state.activeScenarioId,
      scenarioViewMode: state.scenarioViewMode,
      scenarioControllerRevision: state.scenarioControllerRevision,
      scenarioShellOverlayRevision: state.scenarioShellOverlayRevision,
    });
    if (state.cachedDynamicBordersHash === nextHash && state.cachedDynamicOwnerBorders) {
      state.dynamicBordersDirty = false;
      state.dynamicBordersDirtyReason = "";
      updateDynamicBorderStatusUI();
      recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
        enabled: true,
        cacheHit: true,
        segmentCount: Array.isArray(state.cachedDynamicOwnerBorders?.coordinates)
          ? state.cachedDynamicOwnerBorders.coordinates.length
          : 0,
      });
      return true;
    }

    const ownershipContext = getDynamicBorderOwnershipContext(state);
    state.cachedDynamicOwnerBorders = buildDynamicOwnerBorderMesh(state.runtimePoliticalTopology, ownershipContext);
    const unresolvedEntityCount = countUnresolvedOwnerBorderEntities(state.runtimePoliticalTopology, ownershipContext);
    state.cachedDynamicBordersHash = nextHash;
    state.dynamicBordersDirty = false;
    state.dynamicBordersDirtyReason = "";
    updateDynamicBorderStatusUI();
    invalidateRenderPasses("borders", "dynamic-borders");
    recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
      enabled: true,
      cacheHit: false,
      unresolvedEntityCount,
      segmentCount: Array.isArray(state.cachedDynamicOwnerBorders?.coordinates)
        ? state.cachedDynamicOwnerBorders.coordinates.length
        : 0,
    });
    return true;
  }

  // scenarioOpeningOwnerBorderCache 绑定 runtimeRef/meshPackRef/scenarioId/baselineHash/shellRevision，
  // 目标是锁定“场景开启时 owner 边界”的快照语义。baselineHash 或 shellRevision 变化会直接触发重建，
  // baselineHash 缺失时回退到 baselineOwnersRef 引用比较，保证旧数据源也能被正确失效。
  function refreshScenarioOpeningOwnerBorders(reason = "") {
    const startedAt = nowMs();
    const selection = resolveScenarioOpeningOwnerBorderSelection({
      state,
      isUsableMesh,
    });
    let cacheMatches = false;

    if (selection.shouldBuild) {
      cacheMatches =
        scenarioOpeningOwnerBorderCache.meshSource === selection.meshSource
        && scenarioOpeningOwnerBorderCache.scenarioId === selection.scenarioId
        && (selection.baselineHash
          ? scenarioOpeningOwnerBorderCache.baselineHash === selection.baselineHash
          : scenarioOpeningOwnerBorderCache.baselineOwnersRef === selection.baselineOwnersRef)
        && scenarioOpeningOwnerBorderCache.shellRevision === selection.shellRevision
        && (selection.meshSource === "mesh_pack"
          ? scenarioOpeningOwnerBorderCache.meshPackRef === selection.meshPackRef
          : scenarioOpeningOwnerBorderCache.runtimeRef === selection.runtimeRef)
        && isUsableMesh(scenarioOpeningOwnerBorderCache.mesh);

      state.cachedScenarioOpeningOwnerBorders = cacheMatches
        ? scenarioOpeningOwnerBorderCache.mesh
        : (
          selection.hasMeshPackMesh
            ? selection.meshPackMesh
            : buildOwnerBorderMesh(selection.runtimeRef, selection.fallbackOwnershipContext, { excludeSea: true })
        );

      scenarioOpeningOwnerBorderCache = {
        runtimeRef: selection.runtimeRef,
        meshPackRef: selection.meshPackRef,
        scenarioId: selection.scenarioId,
        baselineHash: selection.baselineHash,
        baselineOwnersRef: selection.baselineOwnersRef,
        shellRevision: selection.shellRevision,
        meshSource: selection.meshSource,
        mesh: state.cachedScenarioOpeningOwnerBorders,
      };
    } else {
      state.cachedScenarioOpeningOwnerBorders = null;
    }

    invalidateRenderPasses("borders", reason || "scenario-opening-borders");
    recordRenderPerfMetric("refreshScenarioOpeningOwnerBorders", nowMs() - startedAt, {
      enabled: selection.shouldBuild,
      cacheHit: !!selection.shouldBuild && !!cacheMatches,
      source: selection.meshSource,
      segmentCount: Array.isArray(state.cachedScenarioOpeningOwnerBorders?.coordinates)
        ? state.cachedScenarioOpeningOwnerBorders.coordinates.length
        : 0,
    });
    return !!state.cachedScenarioOpeningOwnerBorders;
  }

  const buildDetailAdmBorderMesh = (topology, includedCountries) =>
    buildDetailAdmBorderMeshRuntime({
      topology,
      includedCountries,
      asFeatureLike,
      shouldExcludePoliticalInteractionFeature,
      getEntityCountryCode,
      isAdmDetailTier,
    });

  function getSourceCountrySets() {
    return getSourceCountrySetsFromSelection({
      state,
      getFeatureCountryCodeNormalized,
      getFeatureId,
      shouldExcludePoliticalInteractionFeature,
    });
  }

  function buildCountryParentBorderMeshes(countryCode) {
    return buildCountryParentBorderMeshesFromSources({
      countryCode,
      state,
      canonicalCountryCode,
      getStaticMeshSourceCountries,
      getEntityCountryCode,
      getParentGroupForEntity,
      isUsableMesh,
    });
  }

  function buildSourceBorderMeshes(topology, includedCountries) {
    return buildSourceBorderMeshesFromSources({
      topology,
      includedCountries,
      canonicalCountryCode,
      asFeatureLike,
      shouldExcludePoliticalInteractionFeature,
      getFeatureCountryCodeNormalized,
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

    const cacheMatches =
      scenarioCoastlineSourceCache.primaryRef === primaryTopology &&
      scenarioCoastlineSourceCache.runtimeRef === runtimeTopology &&
      scenarioCoastlineSourceCache.scenarioId === scenarioId;
    if (cacheMatches && scenarioCoastlineSourceCache.decision) {
      return scenarioCoastlineSourceCache.decision;
    }
    const { decision } = evaluateCoastlineTopologySource({
      primaryTopology,
      runtimeTopology,
      scenarioId,
      scenarioCoastlineMaxAreaDeltaRatio,
      scenarioCoastlineMaxInteriorRingCount,
      scenarioCoastlineMaxInteriorRingRatio,
      isWorldBounds,
    });

    if (scenarioId) {
      const logKey = `${scenarioId}::${decision.source}::${decision.reason}`;
      if (!scenarioCoastlineDecisionWarnings.has(logKey)) {
        scenarioCoastlineDecisionWarnings.add(logKey);
        console.info(
          `[map_renderer] Scenario coastline source ${decision.source}: scenario=${scenarioId} reason=${decision.reason} runtimeObject=${decision.runtimeObjectName || "(none)"} areaDelta=${(Number(decision.areaDeltaRatio) || 0).toFixed(5)} interiorRings=${Number(decision.runtimeInteriorRingCount || 0)} parts=${Number(decision.runtimePolygonPartCount || 0)}`
        );
      }
    }

    scenarioCoastlineSourceCache = {
      primaryRef: primaryTopology,
      runtimeRef: runtimeTopology,
      scenarioId,
      decision: publishScenarioCoastlineDecision(decision),
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

  return {
    buildOwnerBorderMesh,
    buildDynamicOwnerBorderMesh,
    countUnresolvedOwnerBorderEntities,
    rebuildDynamicBorders,
    refreshScenarioOpeningOwnerBorders,
    buildDetailAdmBorderMesh,
    getSourceCountrySets,
    buildCountryParentBorderMeshes,
    buildSourceBorderMeshes,
    buildGlobalCountryBorderMesh,
    resolveCoastlineTopologySource,
    buildGlobalCoastlineMesh,
    simplifyCoastlineMesh,
  };
}
