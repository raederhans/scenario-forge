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
    const runtimeTopologyForOpeningOwner = state.runtimePoliticalTopology;
    let cacheMatches = false;
    const meshPackMesh = state.activeScenarioMeshPack?.meshes?.opening_owner_borders;
    const hasMeshPackMesh = isUsableMesh(meshPackMesh);
    const hasBaselineOwners = Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;
    const shouldBuild =
      !!state.activeScenarioId
      && state.scenarioBorderMode === "scenario_owner_only"
      && String(state.scenarioViewMode || "ownership") === "ownership"
      && (
        hasMeshPackMesh
        || (!!runtimeTopologyForOpeningOwner?.objects?.political && hasBaselineOwners)
      );

    if (shouldBuild) {
      const runtimeRef = runtimeTopologyForOpeningOwner;
      const meshPackRef = state.activeScenarioMeshPack || null;
      const scenarioId = String(state.activeScenarioId || "");
      const baselineHash = String(state.scenarioBaselineHash || "");
      const shellRevision = Number(state.scenarioShellOverlayRevision) || 0;
      const meshSource = hasMeshPackMesh ? "mesh_pack" : "runtime";
      cacheMatches =
        scenarioOpeningOwnerBorderCache.meshSource === meshSource
        && scenarioOpeningOwnerBorderCache.scenarioId === scenarioId
        && (baselineHash
          ? scenarioOpeningOwnerBorderCache.baselineHash === baselineHash
          : scenarioOpeningOwnerBorderCache.baselineOwnersRef === state.scenarioBaselineOwnersByFeatureId)
        && scenarioOpeningOwnerBorderCache.shellRevision === shellRevision
        && (meshSource === "mesh_pack"
          ? scenarioOpeningOwnerBorderCache.meshPackRef === meshPackRef
          : scenarioOpeningOwnerBorderCache.runtimeRef === runtimeRef)
        && isUsableMesh(scenarioOpeningOwnerBorderCache.mesh);

      state.cachedScenarioOpeningOwnerBorders = cacheMatches
        ? scenarioOpeningOwnerBorderCache.mesh
        : (
          hasMeshPackMesh
            ? meshPackMesh
            : buildOwnerBorderMesh(
              runtimeRef,
              {
                ownershipByFeatureId: state.scenarioBaselineOwnersByFeatureId,
                shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
                scenarioActive: false,
                viewMode: "ownership",
              },
              { excludeSea: true }
            )
        );

      scenarioOpeningOwnerBorderCache = {
        runtimeRef,
        meshPackRef,
        scenarioId,
        baselineHash,
        baselineOwnersRef: state.scenarioBaselineOwnersByFeatureId,
        shellRevision,
        meshSource,
        mesh: state.cachedScenarioOpeningOwnerBorders,
      };
    } else {
      state.cachedScenarioOpeningOwnerBorders = null;
    }

    invalidateRenderPasses("borders", reason || "scenario-opening-borders");
    recordRenderPerfMetric("refreshScenarioOpeningOwnerBorders", nowMs() - startedAt, {
      enabled: shouldBuild,
      cacheHit: !!shouldBuild && !!cacheMatches,
      source: hasMeshPackMesh ? "mesh_pack" : "runtime",
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

  function getFullLandDataFeatures() {
    if (Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length) {
      return state.landDataFull.features;
    }
    return Array.isArray(state.landData?.features) ? state.landData.features : [];
  }

  function getSourceCountrySets() {
    const sets = {
      primary: new Set(),
      detail: new Set(),
    };

    const features = getFullLandDataFeatures();
    if (!features.length) {
      return sets;
    }

    features.forEach((feature) => {
      const source = String(feature?.properties?.__source || "primary");
      const countryCode = getFeatureCountryCodeNormalized(feature);
      const featureId = getFeatureId(feature);
      if (!countryCode || shouldExcludePoliticalInteractionFeature(feature, featureId)) return;
      if (source === "detail") {
        sets.detail.add(countryCode);
      } else {
        sets.primary.add(countryCode);
      }
    });

    return sets;
  }

  function buildCountryParentBorderMeshes(countryCode) {
    const normalizedCode = canonicalCountryCode(countryCode);
    if (!normalizedCode || !globalThis.topojson) return [];

    const sourceCountries = getStaticMeshSourceCountries();
    const sources = [
      { key: "detail", topology: state.topologyDetail },
      { key: "primary", topology: state.topologyPrimary || state.topology },
    ];
    const meshes = [];

    sources.forEach(({ key, topology }) => {
      if (!topology?.objects?.political) return;
      if (!sourceCountries[key]?.has(normalizedCode)) return;
      const object = topology.objects.political;
      const mesh = globalThis.topojson.mesh(
        topology,
        object,
        (a, b) => {
          if (!a || !b) return false;
          const codeA = getEntityCountryCode(a);
          const codeB = getEntityCountryCode(b);
          if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
          const groupA = getParentGroupForEntity(a);
          const groupB = getParentGroupForEntity(b);
          return !!(groupA && groupB && groupA !== groupB);
        }
      );
      if (isUsableMesh(mesh)) meshes.push(mesh);
    });

    return meshes;
  }

  function buildSourceBorderMeshes(topology, includedCountries) {
    const object = topology?.objects?.political;
    if (!object || !globalThis.topojson || !includedCountries?.size) {
      return null;
    }
    const provinceMeshesByCountry = new Map();
    const localMeshesByCountry = new Map();
    const provinceMeshes = [];
    const localMeshes = [];

    includedCountries.forEach((countryCode) => {
      const normalizedCode = canonicalCountryCode(countryCode);
      if (!normalizedCode) return;
      const provinceMesh = globalThis.topojson.mesh(
        topology,
        object,
        (a, b) => {
          if (!a || !b) return false;
          if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
            return false;
          }
          const codeA = getFeatureCountryCodeNormalized(a);
          const codeB = getFeatureCountryCodeNormalized(b);
          if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
          const groupA = getAdmin1Group(a);
          const groupB = getAdmin1Group(b);
          return !!(groupA && groupB && groupA !== groupB);
        }
      );
      if (isUsableMesh(provinceMesh)) {
        provinceMeshesByCountry.set(normalizedCode, [provinceMesh]);
        provinceMeshes.push(provinceMesh);
      }

      const localMesh = globalThis.topojson.mesh(
        topology,
        object,
        (a, b) => {
          if (!a || !b) return false;
          if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
            return false;
          }
          const codeA = getFeatureCountryCodeNormalized(a);
          const codeB = getFeatureCountryCodeNormalized(b);
          if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
          const groupA = getAdmin1Group(a);
          const groupB = getAdmin1Group(b);
          return !(groupA && groupB && groupA !== groupB);
        }
      );
      if (isUsableMesh(localMesh)) {
        localMeshesByCountry.set(normalizedCode, [localMesh]);
        localMeshes.push(localMesh);
      }
    });

    return {
      provinceMeshes,
      provinceMeshesByCountry,
      localMeshes,
      localMeshesByCountry,
    };
  }

  function buildGlobalCountryBorderMesh(primaryTopology) {
    const object = primaryTopology?.objects?.political;
    if (!object || !globalThis.topojson) return null;

    return globalThis.topojson.mesh(
      primaryTopology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
          return false;
        }
        const codeA = getFeatureCountryCodeNormalized(a);
        const codeB = getFeatureCountryCodeNormalized(b);
        return !!(codeA && codeB && codeA !== codeB);
      }
    );
  }

  function getTopologyObjectFeatureCollection(topology, objectNames = []) {
    if (!topology?.objects || typeof globalThis.topojson?.feature !== "function") {
      return { objectName: "", collection: null };
    }
    for (const objectName of objectNames) {
      const object = topology.objects?.[objectName];
      if (!object) continue;
      try {
        const collection = globalThis.topojson.feature(topology, object);
        if (collection?.features?.length) {
          return { objectName, collection };
        }
      } catch (_error) {
        continue;
      }
    }
    return { objectName: "", collection: null };
  }

  function countGeometryPolygonParts(geometry) {
    if (!geometry || !geometry.type) return { polygonPartCount: 0, interiorRingCount: 0 };
    if (geometry.type === "Polygon") {
      const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
      return {
        polygonPartCount: 1,
        interiorRingCount: Math.max(0, rings - 1),
      };
    }
    if (geometry.type === "MultiPolygon") {
      const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
      const polygonPartCount = polygons.length;
      const interiorRingCount = polygons.reduce((total, polygon) => {
        const rings = Array.isArray(polygon) ? polygon.length : 0;
        return total + Math.max(0, rings - 1);
      }, 0);
      return { polygonPartCount, interiorRingCount };
    }
    if (geometry.type === "GeometryCollection") {
      return (geometry.geometries || []).reduce((acc, child) => {
        const childCounts = countGeometryPolygonParts(child);
        acc.polygonPartCount += childCounts.polygonPartCount;
        acc.interiorRingCount += childCounts.interiorRingCount;
        return acc;
      }, { polygonPartCount: 0, interiorRingCount: 0 });
    }
    return { polygonPartCount: 0, interiorRingCount: 0 };
  }

  function getCoastlineTopologyMetrics(topology, objectNames = []) {
    const { objectName, collection } = getTopologyObjectFeatureCollection(topology, objectNames);
    if (!collection?.features?.length) {
      return {
        objectName: "",
        featureCount: 0,
        polygonPartCount: 0,
        interiorRingCount: 0,
        totalArea: 0,
        bounds: null,
        worldBounds: false,
      };
    }
    let totalArea = 0;
    collection.features.forEach((feature) => {
      try {
        totalArea += Number(globalThis.d3?.geoArea?.(feature)) || 0;
      } catch (_error) {
        // 单个 feature 失败不应让整条 coastline 选择链崩掉。
      }
    });
    const counts = collection.features.reduce((acc, feature) => {
      const featureCounts = countGeometryPolygonParts(feature?.geometry);
      acc.polygonPartCount += featureCounts.polygonPartCount;
      acc.interiorRingCount += featureCounts.interiorRingCount;
      return acc;
    }, { polygonPartCount: 0, interiorRingCount: 0 });
    let bounds = null;
    try {
      bounds = globalThis.d3?.geoBounds?.(collection) || null;
    } catch (_error) {
      bounds = null;
    }
    return {
      objectName,
      featureCount: collection.features.length,
      polygonPartCount: counts.polygonPartCount,
      interiorRingCount: counts.interiorRingCount,
      totalArea,
      bounds,
      worldBounds: isWorldBounds(bounds),
    };
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

    const primaryMetrics = getCoastlineTopologyMetrics(primaryTopology, ["land_mask", "land"]);
    const runtimeMaskMetrics = scenarioId
      ? getCoastlineTopologyMetrics(runtimeTopology, ["context_land_mask", "land_mask", "land"])
      : null;
    let decision = {
      source: "primary",
      reason: scenarioId ? "missing_runtime_land_mask" : "no_active_scenario",
      scenarioId,
      primaryObjectName: primaryMetrics.objectName || "",
      runtimeObjectName: runtimeMaskMetrics?.objectName || "",
      primaryFeatureCount: Number(primaryMetrics.featureCount || 0),
      runtimeFeatureCount: Number(runtimeMaskMetrics?.featureCount || 0),
      primaryPolygonPartCount: Number(primaryMetrics.polygonPartCount || 0),
      runtimePolygonPartCount: Number(runtimeMaskMetrics?.polygonPartCount || 0),
      primaryInteriorRingCount: Number(primaryMetrics.interiorRingCount || 0),
      runtimeInteriorRingCount: Number(runtimeMaskMetrics?.interiorRingCount || 0),
      runtimeInteriorRingRatio: 0,
      areaDeltaRatio: 0,
      meshMode: "mask",
      topology: primaryTopology,
    };

    if (scenarioId && runtimeMaskMetrics?.objectName && primaryMetrics.featureCount > 0) {
      const areaBase = Math.max(1e-9, Number(primaryMetrics.totalArea) || 0);
      const areaDeltaRatio = Math.abs((Number(runtimeMaskMetrics.totalArea) || 0) - areaBase) / areaBase;
      const runtimeInteriorRingRatio =
        Number(runtimeMaskMetrics.interiorRingCount || 0) / Math.max(1, Number(runtimeMaskMetrics.polygonPartCount || 0));
      let accepted = true;
      let reason = "scenario_accepted";
      if (runtimeMaskMetrics.worldBounds) {
        accepted = false;
        reason = "runtime_world_bounds";
      } else if (areaDeltaRatio > scenarioCoastlineMaxAreaDeltaRatio) {
        accepted = false;
        reason = "area_delta_exceeded";
      } else if (Number(runtimeMaskMetrics.interiorRingCount || 0) > scenarioCoastlineMaxInteriorRingCount) {
        accepted = false;
        reason = "interior_ring_count_exceeded";
      } else if (runtimeInteriorRingRatio > scenarioCoastlineMaxInteriorRingRatio) {
        accepted = false;
        reason = "interior_ring_ratio_exceeded";
      }
      decision = {
        ...decision,
        source: accepted ? "scenario" : "primary",
        reason,
        runtimeInteriorRingRatio,
        areaDeltaRatio,
        meshMode: "mask",
        topology: accepted ? runtimeTopology : primaryTopology,
      };
    }

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
    const topology = primaryTopology?.topology || primaryTopology;
    const meshMode = String(primaryTopology?.meshMode || "mask");
    if (!topology?.objects || !globalThis.topojson) return null;
    if (meshMode === "political_outline" && topology.objects.political) {
      return globalThis.topojson.mesh(
        topology,
        topology.objects.political,
        (a, b) => !!(a && b && a === b && !shouldExcludeOwnerBorderEntity(a, { excludeSea: true }))
      );
    }
    if (topology.objects.context_land_mask) {
      return globalThis.topojson.mesh(topology, topology.objects.context_land_mask);
    }
    if (topology.objects.land_mask) {
      return globalThis.topojson.mesh(topology, topology.objects.land_mask);
    }
    if (topology.objects.land) {
      return globalThis.topojson.mesh(topology, topology.objects.land);
    }
    if (topology.objects.political) {
      return globalThis.topojson.mesh(
        topology,
        topology.objects.political,
        (a, b) => !!(a && !b)
      );
    }
    return null;
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
