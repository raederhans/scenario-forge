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

  // cachedDynamicBordersHash 的 key 由主权修订、场景视图模式、控制权修订、壳层修订组成，
  // 覆盖 ownership/controller/shell 三类边界来源。任一字段变化都代表边界归属语义变化，
  // rebuildDynamicBorders 会据此强制重建 state.cachedDynamicOwnerBorders。
  function buildDynamicBorderHash() {
    return [
      `rev:${Number(state.sovereigntyRevision) || 0}`,
      `mode:${state.activeScenarioId ? String(state.scenarioViewMode || "ownership") : "ownership"}`,
      `ctrl:${Number(state.scenarioControllerRevision) || 0}`,
      `shell:${state.activeScenarioId ? Number(state.scenarioShellOverlayRevision) || 0 : 0}`,
    ].join("|");
  }

  function getDynamicBorderOwnershipContext() {
    return {
      ownershipByFeatureId: state.sovereigntyByFeatureId,
      controllerByFeatureId: state.scenarioControllersByFeatureId,
      shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
      shellControllerByFeatureId: state.scenarioAutoShellControllerByFeatureId,
      scenarioActive: !!state.activeScenarioId,
      viewMode: state.scenarioViewMode,
    };
  }

  function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {
    const object = runtimeTopology?.objects?.political;
    if (!object || !globalThis.topojson) return null;
    return globalThis.topojson.mesh(runtimeTopology, object, (a, b) => {
      if (!a || !b) return false;
      if (shouldExcludeOwnerBorderEntity(a, { excludeSea }) || shouldExcludeOwnerBorderEntity(b, { excludeSea })) {
        return false;
      }
      const ownerA = resolveOwnerBorderCode(a, ownershipContext);
      const ownerB = resolveOwnerBorderCode(b, ownershipContext);
      return !!(ownerA && ownerB && ownerA !== ownerB);
    });
  }

  function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {
    return buildOwnerBorderMesh(runtimeTopology, ownershipContext, { excludeSea: true });
  }

  function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {
    const geometries = runtimeTopology?.objects?.political?.geometries;
    if (!Array.isArray(geometries) || !geometries.length) return 0;
    let unresolvedCount = 0;
    geometries.forEach((geometry) => {
      if (shouldExcludeOwnerBorderEntity(geometry, { excludeSea: true })) return;
      if (resolveOwnerBorderCode(geometry, ownershipContext)) return;
      unresolvedCount += 1;
    });
    return unresolvedCount;
  }

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
    const nextHash = buildDynamicBorderHash();
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

    const ownershipContext = getDynamicBorderOwnershipContext();
    state.cachedDynamicOwnerBorders = buildDynamicOwnerBorderMesh(
      state.runtimePoliticalTopology,
      ownershipContext
    );
    const unresolvedEntityCount = countUnresolvedOwnerBorderEntities(
      state.runtimePoliticalTopology,
      ownershipContext
    );
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
            : buildOwnerBorderMesh(
              selection.runtimeRef,
              selection.fallbackOwnershipContext,
              { excludeSea: true }
            )
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

  function buildDetailAdmBorderMesh(topology, includedCountries) {
    const object = topology?.objects?.political;
    if (!object || !globalThis.topojson || !includedCountries?.size) {
      return null;
    }

    return globalThis.topojson.mesh(topology, object, (a, b) => {
      if (!a || !b) return false;
      if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
        return false;
      }
      const codeA = getEntityCountryCode(a);
      const codeB = getEntityCountryCode(b);
      if (!codeA || !codeB || codeA !== codeB || !includedCountries.has(codeA)) {
        return false;
      }
      return isAdmDetailTier(a) || isAdmDetailTier(b);
    });
  }

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

  function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {
    if (!isUsableMesh(mesh)) return null;
    const simplifiedCoordinates = [];

    mesh.coordinates.forEach((line) => {
      const sanitized = sanitizePolyline(line);
      if (sanitized.length < 2) return;
      const adjustedEpsilon = getLatitudeAdjustedSimplifyEpsilon(epsilon, sanitized);
      const effectiveAreaThreshold = adjustedEpsilon * adjustedEpsilon * coastlineEffectiveAreaMultiplier;
      const simplified = simplifyPolylineEffectiveArea(sanitized, effectiveAreaThreshold);
      if (simplified.length < 2) return;
      if (getLineLength(simplified) < Math.max(0, Number(minLength) || 0)) return;
      simplifiedCoordinates.push(simplified);
    });

    if (!simplifiedCoordinates.length) return null;
    return {
      type: "MultiLineString",
      coordinates: simplifiedCoordinates,
    };
  }

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
