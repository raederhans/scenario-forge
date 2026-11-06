import { SCENARIO_PRESENTATION_FEATURES, scenarioHasPresentationFeature } from "../scenario/presentation_hint_helpers.js";
import { resolveTopVisibleRiverCandidate } from "../river_paint/visibility.js";
import {
  collectSpatialGridCandidates,
  createHitResult,
  findFirstContainingCandidate as findFirstContainingHitCandidate,
  rankCandidates as rankHitCandidates,
  shouldPreferWaterHit as shouldPreferWaterHitCandidate,
  toHitResult as toCandidateHitResult,
} from "./interaction_hit_candidates.js";

const HIT_SNAP_RADIUS_PX = 8;
const HIT_MODE_PARAM = "hit_mode";
const HIT_MODES = new Set(["auto", "canvas", "spatial"]);

function requirePorts(deps, names) {
  return Object.fromEntries(names.map((name) => {
    if (typeof deps[name] !== "function") throw new TypeError(`deps.${name} must be a function.`);
    return [name, deps[name]];
  }));
}

export function createHitTestingOwner({ state: runtimeState, deps }) {
  const {
    getRiverPaintRuntime,
    isLakeInteractionEnabled,
    getSpatialBucketKey,
    hasVisibleRiverPartitions,
    isPoliticalIdRasterSelected,
    getPoliticalIdRasterRuntimeOwner,
    readSearchParam,
    recordRenderPerfMetric,
    incrementPerfCounter,
    recordInteractionDurationMetric,
    publishRenderDiagnostics,
    canonicalCountryCode,
    getWaterRegionType,
    isOpenOceanWaterRegion,
    isMacroOceanWaterRegion,
    isOpenOceanOverlayActive,
    isWaterRegionEnabled,
    isScenarioWaterRegion,
    isSpecialRegionEnabled,
    getFeatureCountryCodeNormalized,
    getFeatureInteractionCountryCodeNormalized,
    getLogicalCanvasDimensions,
    nowMs,
    shouldSkipFeature,
    isInteractionRecoverySettled,
    collectVisibleLandSpatialItemsWithStats,
    scheduleSecondarySpatialIndexBuild,
    getHitContext,
    getPathHitCanvas,
    getHitCanvas,
    getMapSvg,
    getProjection,
    requestGeometryRasterHit,
    scheduleHitCanvasBuild,
    cancelScheduledHitCanvasBuild,
    getLastHitCanvasBuildStats,
    setLastHitCanvasBuildStats,
    getGeometryWorkerEnabled,
    getRenderDiag,
    getPendingSecondarySpatialBuildReasons,
    getSecondarySpatialBuildHandle,
    getRenderPhaseIdle,
    getHitCanvasViewportOverscanPx,
    getPoliticalFeaturePathEntry,
    orderPoliticalShellUnderlayFirst,
    shouldExcludePoliticalInteractionFeature,
    shouldExcludePoliticalVisualFeature,
    getStablePoliticalDrawRank,
  } = requirePorts(deps, [
    "getRiverPaintRuntime",
    "isLakeInteractionEnabled",
    "getSpatialBucketKey",
    "hasVisibleRiverPartitions",
    "isPoliticalIdRasterSelected",
    "getPoliticalIdRasterRuntimeOwner",
    "readSearchParam",
    "recordRenderPerfMetric",
    "incrementPerfCounter",
    "recordInteractionDurationMetric",
    "publishRenderDiagnostics",
    "canonicalCountryCode",
    "getWaterRegionType",
    "isOpenOceanWaterRegion",
    "isMacroOceanWaterRegion",
    "isOpenOceanOverlayActive",
    "isWaterRegionEnabled",
    "isScenarioWaterRegion",
    "isSpecialRegionEnabled",
    "getFeatureCountryCodeNormalized",
    "getFeatureInteractionCountryCodeNormalized",
    "getLogicalCanvasDimensions",
    "nowMs",
    "shouldSkipFeature",
    "isInteractionRecoverySettled",
    "collectVisibleLandSpatialItemsWithStats",
    "scheduleSecondarySpatialIndexBuild",
    "getHitContext",
    "getPathHitCanvas",
    "getHitCanvas",
    "getMapSvg",
    "getProjection",
    "requestGeometryRasterHit",
    "scheduleHitCanvasBuild",
    "cancelScheduledHitCanvasBuild",
    "getLastHitCanvasBuildStats",
    "setLastHitCanvasBuildStats",
    "getGeometryWorkerEnabled",
    "getRenderDiag",
    "getPendingSecondarySpatialBuildReasons",
    "getSecondarySpatialBuildHandle",
    "getRenderPhaseIdle",
    "getHitCanvasViewportOverscanPx",
    "getPoliticalFeaturePathEntry",
    "orderPoliticalShellUnderlayFirst",
    "shouldExcludePoliticalInteractionFeature",
    "shouldExcludePoliticalVisualFeature",
    "getStablePoliticalDrawRank",
  ]);

  function resolveHitMode() {
    const raw = readSearchParam(HIT_MODE_PARAM);
    if (!raw) return "auto";
    if (!HIT_MODES.has(raw)) return "auto";
    return raw;
  }

  function recordWaterHitDiagnostic(detail = {}) {
    if (!getRenderDiag().enabled) return;
    getRenderDiag().waterHit = {
      phase: String(runtimeState.renderPhase || ""),
      reason: String(detail.reason || ""),
      eventType: String(detail.eventType || ""),
      waterItems: Array.isArray(runtimeState.waterSpatialItems) ? runtimeState.waterSpatialItems.length : 0,
      waterRegions: Number(runtimeState.waterRegionsById?.size || 0),
      pendingReasons: Array.from(getPendingSecondarySpatialBuildReasons() || []),
      hasPendingBuild: getSecondarySpatialBuildHandle() !== null && getSecondarySpatialBuildHandle() !== undefined,
      secondarySpatialBuildPending: !!runtimeState.secondarySpatialBuildPending,
      secondarySpatialPreservedDuringBuild: !!runtimeState.secondarySpatialPreservedDuringBuild,
      secondarySpatialGeneration: Number(runtimeState.secondarySpatialGeneration || 0),
      secondarySpatialLastReason: String(runtimeState.secondarySpatialLastReason || ""),
      hitCanvasDirty: !!runtimeState.hitCanvasDirty,
      interactionSettled: isInteractionRecoverySettled({ quietMs: 800 }),
    };
    publishRenderDiagnostics();
  }

  function getMediterraneanAtlantropaBounds() {
    if (!scenarioHasPresentationFeature(
      runtimeState.activeScenarioManifest,
      SCENARIO_PRESENTATION_FEATURES.COASTAL_ACCENT
    )) return null;
    const cache = runtimeState.mediterraneanAtlantropaBoundsCache || {};
    const featureCount = Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0;
    if (
      cache.scenarioId === runtimeState.activeScenarioId &&
      cache.topologyRevision === Number(runtimeState.topologyRevision || 0) &&
      cache.featureCount === featureCount &&
      Array.isArray(cache.bounds)
    ) {
      return cache.bounds;
    }
    if (!Array.isArray(runtimeState.landData?.features) || !runtimeState.landData.features.length || !globalThis.d3?.geoBounds) {
      return null;
    }
    const atlFeatures = runtimeState.landData.features.filter((feature) => getFeatureCountryCodeNormalized(feature) === "ATL");
    if (!atlFeatures.length) return null;
    try {
      const bounds = globalThis.d3.geoBounds({
        type: "FeatureCollection",
        features: atlFeatures,
      });
      runtimeState.mediterraneanAtlantropaBoundsCache = {
        scenarioId: runtimeState.activeScenarioId || "",
        topologyRevision: Number(runtimeState.topologyRevision || 0),
        featureCount,
        bounds,
      };
      return bounds;
    } catch (_error) {
      return null;
    }
  }

  function isPointerInsideMediterraneanAtlantropaBounds(pointer) {
    const bounds = getMediterraneanAtlantropaBounds();
    if (!bounds || !Array.isArray(bounds) || bounds.length !== 2) return false;
    const lon = Number(pointer?.lonLat?.[0]);
    const lat = Number(pointer?.lonLat?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const [[minLon, minLat], [maxLon, maxLat]] = bounds;
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  }

  function shouldSuppressOpenOceanHit(candidate, pointer) {
    if (!candidate?.item?.feature || !isOpenOceanWaterRegion(candidate.item.feature)) return false;
    return isPointerInsideMediterraneanAtlantropaBounds(pointer);
  }

  function keyToHitColor(key) {
    const value = Math.max(0, Math.min(0xffffff, Number(key) || 0));
    const r = value & 255;
    const g = (value >> 8) & 255;
    const b = (value >> 16) & 255;
    return `rgb(${r}, ${g}, ${b})`;
  }

  function fillHitFeature(feature, id, key) {
    const context = getHitContext();
    const polygon = feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon";
    const entry = polygon ? getPoliticalFeaturePathEntry(feature, {
      featureId: id, allowBuild: true, countBuild: true,
    }) : null;
    context.fillStyle = keyToHitColor(key);
    if (entry?.path) {
      context.fill(entry.path);
    } else {
      context.beginPath();
      getPathHitCanvas()(feature);
      context.fill();
    }
  }

  function hitColorToKey(pixel) {
    if (!pixel || pixel.length < 3) return 0;
    return (pixel[0] || 0) | ((pixel[1] || 0) << 8) | ((pixel[2] || 0) << 16);
  }

  function drawHitCanvas() {
    if (!getHitContext() || !getPathHitCanvas() || !runtimeState.landData?.features?.length) {
      runtimeState.hitCanvasDirty = false;
      runtimeState.hitCanvasTopologyRevision = 0;
      setLastHitCanvasBuildStats(null);
      return false;
    }

    const width = getHitCanvas()?.width || 0;
    const height = getHitCanvas()?.height || 0;
    if (width <= 0 || height <= 0) {
      runtimeState.hitCanvasDirty = false;
      runtimeState.hitCanvasTopologyRevision = 0;
      setLastHitCanvasBuildStats(null);
      return false;
    }

    const t = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
    const k = Math.max(0.0001, t.k || 1);

    getHitContext().save();
    getHitContext().setTransform(1, 0, 0, 1, 0, 0);
    getHitContext().clearRect(0, 0, width, height);
    getHitContext().globalCompositeOperation = "source-over";
    getHitContext().globalAlpha = 1;
    getHitContext().filter = "none";
    getHitContext().shadowBlur = 0;
    getHitContext().setTransform(runtimeState.dpr, 0, 0, runtimeState.dpr, 0, 0);
    getHitContext().translate(t.x, t.y);
    getHitContext().scale(k, k);

    const visibleSpatialItemsResult = collectVisibleLandSpatialItemsWithStats({
      overscanPx: getHitCanvasViewportOverscanPx(),
    });
    if (visibleSpatialItemsResult === null) {
      getHitContext().restore();
      runtimeState.hitCanvasDirty = true;
      setLastHitCanvasBuildStats(null);
      recordRenderPerfMetric("hitCanvasSpatialIndexUnavailable", 0, {
        reason: "spatial-index-unavailable",
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
      });
      return false;
    }
    const riverVisible = hasVisibleRiverPartitions();
    const visibleSpatialItems = riverVisible
      ? orderPoliticalShellUnderlayFirst(visibleSpatialItemsResult.items)
      : visibleSpatialItemsResult.items;
    let drawnItemCount = 0;
    visibleSpatialItems.forEach((item) => {
      if (!item?.feature) return;
      const excluded = shouldExcludePoliticalInteractionFeature(item.feature, item.id);
      const key = excluded ? 0 : (runtimeState.idToKey.get(item.id) || 0);
      if (!riverVisible && (!key || excluded)) return;
      fillHitFeature(item.feature, item.id, key);
      drawnItemCount += 1;
    });

    getHitContext().restore();
    runtimeState.hitCanvasDirty = false;
    runtimeState.hitCanvasTopologyRevision = Number(runtimeState.topologyRevision || 0);
    setLastHitCanvasBuildStats({
      ...visibleSpatialItemsResult.stats,
      visibleItemCount: visibleSpatialItems.length,
      drawnItemCount,
      globalCount: Number(visibleSpatialItemsResult.stats?.globalCandidateCount || 0),
      spatialItemCount: Array.isArray(runtimeState.spatialItems) ? runtimeState.spatialItems.length : 0,
    });
    incrementPerfCounter("hitCanvasRenders");
    return true;
  }

  function drawHitCanvasWithMetric(details = {}) {
    const startedAt = nowMs();
    const dirtyBefore = !!runtimeState.hitCanvasDirty;
    const built = drawHitCanvas();
    const durationMs = nowMs() - startedAt;
    const metricDetails = {
      built: !!built,
      dirtyBefore,
      ...(getLastHitCanvasBuildStats() || {}),
      ...details,
    };
    recordRenderPerfMetric("buildHitCanvas", durationMs, metricDetails);
    recordRenderPerfMetric("hitCanvasViewportProfile", durationMs, {
      sourceMetric: "buildHitCanvas",
      profile: "viewport-full",
      ...metricDetails,
    });
    return built;
  }

  function drawScheduledHitCanvasWithMetric(details = {}) {
    if (requestGeometryRasterHit(details)) return false;
    const {
      reason = "idle-render",
      activeScenarioId = String(runtimeState.activeScenarioId || ""),
      ...metricDetails
    } = details || {};
    // The geometry worker only takes hit builds once startup read-only ends, and
    // the read-only collection is replaced by the detail promotion anyway. A full
    // main-thread build here (about 0.7 s on TNO) would be thrown away; point
    // probes cover hover until the worker builds the canvas after unlock.
    if (getGeometryWorkerEnabled() && (runtimeState.startupReadonly || runtimeState.startupReadonlyUnlockInFlight)) {
      recordRenderPerfMetric("buildHitCanvas", 0, {
        ...metricDetails,
        built: false,
        skipped: true,
        mode: "deferred",
        reason,
        skipReason: "startup-readonly",
        activeScenarioId,
      });
      return false;
    }
    return drawHitCanvasWithMetric({
      ...metricDetails,
      mode: "deferred",
      reason,
      activeScenarioId,
    });
  }

  function recordDeferredFullHitCanvasMetric({ reason = "deferred-full", keepReady = false } = {}) {
    const metricDetails = {
      built: false,
      skipped: true,
      mode: "deferred-full",
      reason,
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      dirtyBefore: !!runtimeState.hitCanvasDirty,
      current: isHitCanvasCurrent(),
      keepReady: !!keepReady,
    };
    recordRenderPerfMetric("buildHitCanvas", 0, metricDetails);
    recordRenderPerfMetric("hitCanvasViewportProfile", 0, {
      sourceMetric: "buildHitCanvas",
      profile: "deferred-full",
      ...metricDetails,
    });
    return false;
  }

  function scheduleHitCanvasBuildIfNeeded({ reason = "idle-render" } = {}) {
    scheduleHitCanvasBuild({ reason });
    return false;
  }

  function ensureHitCanvasUpToDate({ force = false } = {}) {
    if (!getHitContext() || !getPathHitCanvas()) return false;
    if (!force && !runtimeState.hitCanvasDirty) return true;
    if (!force) {
      scheduleHitCanvasBuildIfNeeded({ reason: "lazy-hit-validation" });
      return false;
    }
    if (!runtimeState.hitCanvasDirty && isHitCanvasCurrent()) {
      recordRenderPerfMetric("buildHitCanvas", 0, {
        built: false,
        skipped: true,
        reason: "current",
        mode: "forced",
        activeScenarioId: String(runtimeState.activeScenarioId || ""),
      });
      return true;
    }
    cancelScheduledHitCanvasBuild({ reason: "strict-validation" });
    return drawHitCanvasWithMetric({
      mode: "forced",
      reason: "strict-validation",
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
    });
  }

  function isHitCanvasCurrent() {
    return (
      !runtimeState.hitCanvasDirty
      && Number(runtimeState.hitCanvasTopologyRevision || 0) === Number(runtimeState.topologyRevision || 0)
    );
  }

  function getHitResultFromCanvas(event) {
    if (!getMapSvg() || !getHitContext() || !runtimeState.keyToId?.size || !globalThis.d3?.pointer) {
      return createHitResult();
    }
    const [sx, sy] = globalThis.d3.pointer(event, getMapSvg());
    if (![sx, sy].every(Number.isFinite)) return createHitResult();
    const dpr = Number.isFinite(Number(runtimeState.dpr)) && Number(runtimeState.dpr) > 0
      ? Number(runtimeState.dpr)
      : 1;
    const px = Math.max(0, Math.min((getHitCanvas()?.width || 1) - 1, Math.round(sx * dpr)));
    const py = Math.max(0, Math.min((getHitCanvas()?.height || 1) - 1, Math.round(sy * dpr)));

    let pixel = null;
    try {
      pixel = getHitContext().getImageData(px, py, 1, 1).data;
    } catch (_error) {
      return createHitResult();
    }

    const key = hitColorToKey(pixel);
    if (!key) return createHitResult();
    const id = runtimeState.keyToId.get(key);
    if (!id) return createHitResult();
    const feature = runtimeState.landIndex.get(id);
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    if (
      !feature
      || shouldExcludePoliticalInteractionFeature(feature, id)
      || shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })
    ) {
      return createHitResult();
    }
    return createHitResult({
      id,
      countryCode: getFeatureInteractionCountryCodeNormalized(feature, id),
      runtimeCountryCode: getFeatureCountryCodeNormalized(feature),
      targetType: "land",
      feature,
      hitSource: "canvas",
      bboxArea: Number(runtimeState.spatialItemsById?.get(id)?.bboxArea || Infinity),
      viaSnap: false,
      strict: true,
      distancePx: 0,
    });
  }

  function getDirtyHitCanvasPointProbeHit(event) {
    if (!getMapSvg() || !getHitContext() || !getPathHitCanvas() || !runtimeState.keyToId?.size || !globalThis.d3?.pointer) {
      return createHitResult();
    }
    const startedAt = nowMs();
    const [sx, sy] = globalThis.d3.pointer(event, getMapSvg());
    if (![sx, sy].every(Number.isFinite)) return createHitResult();
    const t = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
    const k = Math.max(0.0001, Number(t.k) || 1);
    const projectedX = (Number(sx) - Number(t.x || 0)) / k;
    const projectedY = (Number(sy) - Number(t.y || 0)) / k;
    if (![projectedX, projectedY].every(Number.isFinite)) return createHitResult();
    const riverVisible = hasVisibleRiverPartitions();
    const candidates = (riverVisible
      ? collectRiverVisualCandidates(projectedX, projectedY, 0)
      : collectGridCandidates(projectedX, projectedY, 0))
      .sort((left, right) => riverVisible
        ? getStablePoliticalDrawRank(left.item) - getStablePoliticalDrawRank(right.item)
        : (left?.item?.drawOrder ?? 0) - (right?.item?.drawOrder ?? 0));
    const dpr = Number.isFinite(Number(runtimeState.dpr)) && Number(runtimeState.dpr) > 0
      ? Number(runtimeState.dpr)
      : 1;
    const px = Math.max(0, Math.min((getHitCanvas()?.width || 1) - 1, Math.round(sx * dpr)));
    const py = Math.max(0, Math.min((getHitCanvas()?.height || 1) - 1, Math.round(sy * dpr)));
    let drawnItemCount = 0;
    let hit = createHitResult();
    try {
      getHitContext().save();
      getHitContext().setTransform(1, 0, 0, 1, 0, 0);
      getHitContext().clearRect(px - 1, py - 1, 3, 3);
      getHitContext().beginPath();
      getHitContext().rect(px - 1, py - 1, 3, 3);
      getHitContext().clip();
      getHitContext().globalCompositeOperation = "source-over";
      getHitContext().globalAlpha = 1;
      getHitContext().filter = "none";
      getHitContext().shadowBlur = 0;
      getHitContext().setTransform(dpr, 0, 0, dpr, 0, 0);
      getHitContext().translate(t.x, t.y);
      getHitContext().scale(k, k);
      candidates.forEach(({ item }) => {
        if (!item?.feature) return;
        const excluded = shouldExcludePoliticalInteractionFeature(item.feature, item.id);
        const key = excluded ? 0 : (runtimeState.idToKey.get(item.id) || 0);
        if (!riverVisible && (!key || excluded)) return;
        fillHitFeature(item.feature, item.id, key);
        drawnItemCount += 1;
      });
      getHitContext().restore();
      const pixel = getHitContext().getImageData(px, py, 1, 1).data;
      const key = hitColorToKey(pixel);
      const id = key ? runtimeState.keyToId.get(key) : "";
      const feature = id ? runtimeState.landIndex.get(id) : null;
      const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
      if (
        id
        && feature
        && !shouldExcludePoliticalInteractionFeature(feature, id)
        && !shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })
      ) {
        hit = createHitResult({
          id,
          countryCode: getFeatureInteractionCountryCodeNormalized(feature, id),
          runtimeCountryCode: getFeatureCountryCodeNormalized(feature),
          targetType: "land",
          feature,
          hitSource: "point-probe",
          bboxArea: Number(runtimeState.spatialItemsById?.get(id)?.bboxArea || Infinity),
          viaSnap: false,
          strict: true,
          distancePx: 0,
        });
      }
    } catch (_error) {
      try {
        getHitContext().restore();
      } catch (_restoreError) {
        // Already restored.
      }
      hit = createHitResult();
    }
    const durationMs = nowMs() - startedAt;
    const details = {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      candidateCount: candidates.length,
      drawnItemCount,
      hit: !!hit.id,
      hitSource: "point-probe",
      dirtyBefore: !!runtimeState.hitCanvasDirty,
    };
    recordRenderPerfMetric("hitCanvasPointProbe", durationMs, details);
    recordRenderPerfMetric("hitCanvasViewportProfile", durationMs, {
      sourceMetric: "hitCanvasPointProbe",
      profile: "point-probe",
      ...details,
    });
    return hit;
  }

  function getValidatedCanvasHit(event, strictIds = null, { forceBuild = false } = {}) {
    if (runtimeState.renderPhase !== getRenderPhaseIdle()) {
      return createHitResult();
    }
    let hit = createHitResult();
    if (isHitCanvasCurrent()) {
      hit = getHitResultFromCanvas(event);
    } else {
      scheduleHitCanvasBuildIfNeeded({ reason: forceBuild ? "dirty-point-probe-click" : "dirty-point-probe-hover" });
      hit = getDirtyHitCanvasPointProbeHit(event);
    }
    if (!hit.id) return hit;
    if (!strictIds?.size || strictIds.has(hit.id)) return hit;
    return createHitResult();
  }

  function collectGridCandidates(px, py, radiusProj = 0) {
    return collectSpatialGridCandidates({
      grid: runtimeState.spatialGrid,
      gridMeta: runtimeState.spatialGridMeta,
      px,
      py,
      radiusProj,
      getSpatialBucketKey,
      shouldIncludeItem: (item) => !shouldExcludePoliticalInteractionFeature(item.feature, item.id),
    });
  }

  function collectWaterGridCandidates(px, py, radiusProj = 0) {
    return collectSpatialGridCandidates({
      grid: runtimeState.waterSpatialGrid,
      gridMeta: runtimeState.waterSpatialGridMeta,
      px,
      py,
      radiusProj,
      getSpatialBucketKey,
      shouldIncludeItem: (item) => isWaterRegionEnabled(item.feature),
    });
  }

  function collectSpecialGridCandidates(px, py, radiusProj = 0) {
    return collectSpatialGridCandidates({
      grid: runtimeState.specialSpatialGrid,
      gridMeta: runtimeState.specialSpatialGridMeta,
      px,
      py,
      radiusProj,
      getSpatialBucketKey,
      shouldIncludeItem: (item) => isSpecialRegionEnabled(item.feature),
    });
  }

  function createInteractionHitCandidateCollector(pointer) {
    // One input can resolve a strict/snap hit and then collect the same grids
    // again for diagnostics. Keep the exact radius as the key: metric and hit
    // paths intentionally retain their own radius normalization rules.
    const caches = {
      special: new Map(),
      land: new Map(),
      water: new Map(),
    };
    const collect = (type, radiusProj, collector) => {
      const cache = caches[type];
      if (!cache.has(radiusProj)) {
        cache.set(radiusProj, collector(pointer.px, pointer.py, radiusProj));
      }
      return cache.get(radiusProj);
    };
    return {
      special: (radiusProj) => collect("special", radiusProj, collectSpecialGridCandidates),
      land: (radiusProj) => collect("land", radiusProj, collectGridCandidates),
      water: (radiusProj) => collect("water", radiusProj, collectWaterGridCandidates),
    };
  }

  function rankCandidates(candidates, lonLat, { eventType = "unknown", targetType = "unknown" } = {}) {
    return rankHitCandidates(candidates, lonLat, {
      eventType,
      targetType,
      geoContains: globalThis.d3?.geoContains,
      nowMs,
      recordInteractionDurationMetric,
    });
  }

  function findFirstContainingCandidate(candidates, lonLat, { eventType = "hover", targetType = "unknown" } = {}) {
    return findFirstContainingHitCandidate(candidates, lonLat, {
      eventType,
      targetType,
      geoContains: globalThis.d3?.geoContains,
      nowMs,
      recordInteractionDurationMetric,
    });
  }

  function getPointerProjectionPosition(event) {
    if (!getMapSvg() || !getProjection() || !globalThis.d3) return null;
    const [sx, sy] = globalThis.d3.pointer(event, getMapSvg());
    const transform = runtimeState.zoomTransform || globalThis.d3.zoomIdentity;
    const zoomK = Math.max(0.0001, transform?.k || 1);
    const px = (sx - (transform?.x || 0)) / zoomK;
    const py = (sy - (transform?.y || 0)) / zoomK;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const lonLat = getProjection().invert([px, py]);
    if (!lonLat) return null;
    return {
      px,
      py,
      lonLat,
      zoomK,
    };
  }

  function toHitResult(candidate, { viaSnap = false, strict = false, zoomK = 1, targetType = "land" } = {}) {
    return toCandidateHitResult(candidate, {
      viaSnap,
      strict,
      zoomK,
      targetType,
      canonicalCountryCode,
      getFeatureCountryCodeNormalized,
      getFeatureInteractionCountryCodeNormalized,
    });
  }

  function shouldPreferWaterHit(landHit, waterHit, { eventType = "unknown" } = {}) {
    return shouldPreferWaterHitCandidate(landHit, waterHit, {
      eventType,
      isMacroOceanWaterRegion,
      getWaterRegionType,
    });
  }

  function collectInteractionHitMetricDetails(
    pointer,
    { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown", resolvedHit = null, candidateCollector = null } = {}
  ) {
    if (!pointer) {
      return {
        eventType,
        specialCandidateCount: 0,
        landStrictCandidateCount: 0,
        landSnapCandidateCount: 0,
        waterStrictCandidateCount: 0,
        waterSnapCandidateCount: 0,
        resolvedTargetType: String(resolvedHit?.targetType || "empty"),
      };
    }
    const snapRadiusPx = Number.isFinite(Number(snapPx))
      ? Math.max(0, Number(snapPx))
      : HIT_SNAP_RADIUS_PX;
    const radiusProj = enableSnap && snapRadiusPx > 0
      ? snapRadiusPx / Math.max(0.0001, pointer.zoomK)
      : 0;
    const specialStrict = candidateCollector
      ? candidateCollector.special(0) : collectSpecialGridCandidates(pointer.px, pointer.py, 0);
    const specialSnap = radiusProj > 0
      ? (candidateCollector ? candidateCollector.special(radiusProj) : collectSpecialGridCandidates(pointer.px, pointer.py, radiusProj))
      : [];
    const landStrict = candidateCollector
      ? candidateCollector.land(0) : collectGridCandidates(pointer.px, pointer.py, 0);
    const landSnap = radiusProj > 0
      ? (candidateCollector ? candidateCollector.land(radiusProj) : collectGridCandidates(pointer.px, pointer.py, radiusProj))
      : [];
    const waterStrict = candidateCollector
      ? candidateCollector.water(0) : collectWaterGridCandidates(pointer.px, pointer.py, 0);
    const waterSnap = radiusProj > 0
      ? (candidateCollector ? candidateCollector.water(radiusProj) : collectWaterGridCandidates(pointer.px, pointer.py, radiusProj))
      : [];
    return {
      eventType,
      specialCandidateCount: Math.max(specialStrict.length, specialSnap.length),
      landStrictCandidateCount: landStrict.length,
      landSnapCandidateCount: landSnap.length,
      waterStrictCandidateCount: waterStrict.length,
      waterSnapCandidateCount: waterSnap.length,
      resolvedTargetType: String(resolvedHit?.targetType || "empty"),
    };
  }

  function recordInteractionHitMetrics(pointer, options = {}) {
    if (options.eventType === "hover") {
      incrementPerfCounter("interactionHitCandidateCount", options.resolvedHit?.id ? 1 : 0);
      if (options.resolvedHit?.hitSource === "canvas") {
        incrementPerfCounter("interactionHitCanvasPreferredCount");
      }
      return;
    }
    const details = collectInteractionHitMetricDetails(pointer, options);
    const totalCandidates =
      details.specialCandidateCount
      + details.landStrictCandidateCount
      + details.landSnapCandidateCount
      + details.waterStrictCandidateCount
      + details.waterSnapCandidateCount;
    incrementPerfCounter("interactionHitCandidateCount", totalCandidates);
    if (options.resolvedHit?.hitSource === "canvas") {
      incrementPerfCounter("interactionHitCanvasPreferredCount");
    }
    recordRenderPerfMetric("interactionHitCandidateCount", 0, {
      ...details,
      totalCandidateCount: totalCandidates,
    });
    recordRenderPerfMetric("interactionHitResolvedPath", 0, {
      ...details,
      hitSource: String(options.resolvedHit?.hitSource || "none"),
      viaSnap: !!options.resolvedHit?.viaSnap,
      strict: !!options.resolvedHit?.strict,
    });
    if (options.resolvedHit?.hitSource === "canvas") {
      recordRenderPerfMetric("interactionHitCanvasPreferredCount", 0, details);
    }
  }

  function collectRiverVisualCandidates(px, py, radiusProj = 0) {
    return collectSpatialGridCandidates({
      grid: runtimeState.spatialGrid, gridMeta: runtimeState.spatialGridMeta,
      px, py, radiusProj, getSpatialBucketKey,
      shouldIncludeItem: item => !shouldExcludePoliticalVisualFeature(item.feature, item.id),
    });
  }

  function getVisibleRiverLandHit(event, pointer, { enableSnap, snapPx, eventType }) {
    const choose = radius => resolveTopVisibleRiverCandidate(
      collectRiverVisualCandidates(pointer.px, pointer.py, radius), pointer.lonLat,
      { getDrawRank: getStablePoliticalDrawRank, geoContains: globalThis.d3?.geoContains });
    let chosen = choose(0), viaSnap = false;
    if (!chosen && enableSnap) {
      const radius = (Number.isFinite(Number(snapPx)) ? Math.max(0, Number(snapPx)) : HIT_SNAP_RADIUS_PX) / pointer.zoomK;
      if (radius > 0) { chosen = choose(radius); viaSnap = !!chosen; }
    }
    if (!chosen || shouldExcludePoliticalInteractionFeature(chosen.item.feature, chosen.item.id)) return createHitResult();
    if (!viaSnap && eventType !== "compat" && eventType !== "hover" && resolveHitMode() !== "spatial") {
      const canvasHit = getValidatedCanvasHit(event, new Set([chosen.item.id]), {
        forceBuild: eventType === "click" || eventType === "dblclick",
      });
      if (canvasHit.id === chosen.item.id) return canvasHit;
    }
    return toHitResult(chosen, { viaSnap, strict: !viaSnap, zoomK: pointer.zoomK, targetType: "land" });
  }

  function getLandHitFromPointer(
    event,
    pointer,
    { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown", candidateCollector = null } = {}
  ) {
    if (!runtimeState.landData || !runtimeState.spatialItems?.length) return createHitResult();
    if (hasVisibleRiverPartitions()) return getVisibleRiverLandHit(event, pointer, { enableSnap, snapPx, eventType });
    const hitMode = resolveHitMode();
    if (hitMode === "canvas" && eventType !== "compat") {
      const hitFromCanvas = getValidatedCanvasHit(event, null, {
        forceBuild: eventType === "click" || eventType === "dblclick",
      });
      if (hitFromCanvas.id) {
        return hitFromCanvas;
      }
    }

    const strictCandidates = candidateCollector
      ? candidateCollector.land(0) : collectGridCandidates(pointer.px, pointer.py, 0);
    // A display ID can accelerate a unique interior only. Geographic containment
    // and the existing rank/filter policy still decide the hit; overlaps, brush,
    // seams and stale/missing raster coverage continue through the normal path.
    if (hitMode !== "canvas" && !runtimeState.brushModeEnabled && isPoliticalIdRasterSelected()
      && ["click", "dblclick", "hover"].includes(eventType) && strictCandidates.length === 1) {
      const raster = getPoliticalIdRasterRuntimeOwner()?.queryPoint({ x: pointer.px, y: pointer.py });
      if (raster?.kind === "interior" && raster.primaryId === strictCandidates[0]?.item?.id) {
        const verified = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "land" })
          .find(candidate => candidate.containsGeo);
        if (verified) {
          recordRenderPerfMetric("politicalIdRasterPick", 0, { id: raster.primaryId, verified: true });
          return toHitResult(verified, { viaSnap: false, strict: true, zoomK: pointer.zoomK, targetType: "land" });
        }
      }
    }
    if ((eventType === "hover" || eventType === "brush") && !enableSnap) {
      const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "land" });
      return strictHoverHit
        ? toHitResult(strictHoverHit, {
          viaSnap: false,
          strict: true,
          zoomK: pointer.zoomK,
          targetType: "land",
        })
        : createHitResult();
    }
    // The first containing item in canonical priority order is the same winner
    // as ranking every containment result; lower-priority geometry need not run.
    if (strictCandidates.length > 0) {
      const strictContainsGeo = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "land" });
      if (strictContainsGeo) {
        if (hitMode === "auto" && eventType !== "compat") {
          const strictIds = new Set(strictCandidates.map((candidate) => candidate.item.id));
          const hitFromCanvas = getValidatedCanvasHit(event, strictIds, {
            forceBuild:
              strictCandidates.length > 1
              && (eventType === "click" || eventType === "dblclick" || eventType === "compat"),
          });
          if (hitFromCanvas.id === strictContainsGeo.item.id) {
            return hitFromCanvas;
          }
        }
        return toHitResult(strictContainsGeo, {
          viaSnap: false,
          strict: true,
          zoomK: pointer.zoomK,
          targetType: "land",
        });
      }
    }

    if (!enableSnap) return createHitResult();

    const snapRadiusPx = Number.isFinite(Number(snapPx))
      ? Math.max(0, Number(snapPx))
      : HIT_SNAP_RADIUS_PX;
    const radiusProj = snapRadiusPx / pointer.zoomK;
    if (radiusProj <= 0) return createHitResult();

    const snapCandidates = candidateCollector
      ? candidateCollector.land(radiusProj) : collectGridCandidates(pointer.px, pointer.py, radiusProj);
    const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "land" });
    if (!snapRanked.length) return createHitResult();

    const chosen = snapRanked.find((candidate) => candidate.containsGeo);
    if (!chosen) return createHitResult();
    return toHitResult(chosen, {
      viaSnap: true,
      strict: false,
      zoomK: pointer.zoomK,
      targetType: "land",
    });
  }

  function getWaterHitFromPointer(
    pointer,
    { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown", candidateCollector = null } = {}
  ) {
    if (!runtimeState.showWaterRegions && !isOpenOceanOverlayActive() && !isLakeInteractionEnabled(runtimeState)) return createHitResult();
    if (!runtimeState.waterSpatialItems?.length) {
      recordWaterHitDiagnostic({
        reason: "empty-water-spatial-items",
        eventType,
      });
      if (runtimeState.waterRegionsById?.size) {
        scheduleSecondarySpatialIndexBuild({
          reason: "water-hit-demand",
        });
      }
      return createHitResult();
    }

    const strictCandidates = candidateCollector
      ? candidateCollector.water(0) : collectWaterGridCandidates(pointer.px, pointer.py, 0);
    if (eventType === "hover" && !enableSnap) {
      const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "water" });
      if (!strictHoverHit) return createHitResult();
      if (isMacroOceanWaterRegion(strictHoverHit.item?.feature)) return createHitResult();
      if (shouldSuppressOpenOceanHit(strictHoverHit, pointer)) return createHitResult();
      return toHitResult(strictHoverHit, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "water",
      });
    }
    const strictRanked = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "water" });
    const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
    if (strictHit) {
      if (eventType === "hover" && isMacroOceanWaterRegion(strictHit.item?.feature)) {
        return createHitResult();
      }
      if (shouldSuppressOpenOceanHit(strictHit, pointer)) {
        return createHitResult();
      }
      return toHitResult(strictHit, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "water",
      });
    }

    if (!enableSnap) return createHitResult();

    const snapRadiusPx = Number.isFinite(Number(snapPx))
      ? Math.max(0, Number(snapPx))
      : HIT_SNAP_RADIUS_PX;
    const radiusProj = snapRadiusPx / pointer.zoomK;
    if (radiusProj <= 0) return createHitResult();

    const snapCandidates = candidateCollector
      ? candidateCollector.water(radiusProj) : collectWaterGridCandidates(pointer.px, pointer.py, radiusProj);
    const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "water" });
    const chosen = snapRanked.find((candidate) => candidate.containsGeo);
    if (!chosen) return createHitResult();
    if (eventType === "hover" && isMacroOceanWaterRegion(chosen.item?.feature)) {
      return createHitResult();
    }
    if (shouldSuppressOpenOceanHit(chosen, pointer)) {
      return createHitResult();
    }
    return toHitResult(chosen, {
      viaSnap: true,
      strict: false,
      zoomK: pointer.zoomK,
      targetType: "water",
    });
  }

  function getSpecialHitFromPointer(
    pointer,
    { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown", candidateCollector = null } = {}
  ) {
    if (!runtimeState.showScenarioSpecialRegions) return createHitResult();
    if (!runtimeState.specialSpatialItems?.length) {
      if (runtimeState.specialRegionsById?.size) {
        scheduleSecondarySpatialIndexBuild({
          reason: "special-hit-demand",
        });
      }
      return createHitResult();
    }

    const strictCandidates = candidateCollector
      ? candidateCollector.special(0) : collectSpecialGridCandidates(pointer.px, pointer.py, 0);
    if (eventType === "hover" && !enableSnap) {
      const strictHoverHit = findFirstContainingCandidate(strictCandidates, pointer.lonLat, { eventType, targetType: "special" });
      return strictHoverHit
        ? toHitResult(strictHoverHit, {
          viaSnap: false,
          strict: true,
          zoomK: pointer.zoomK,
          targetType: "special",
        })
        : createHitResult();
    }
    const strictRanked = rankCandidates(strictCandidates, pointer.lonLat, { eventType, targetType: "special" });
    const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
    if (strictHit) {
      return toHitResult(strictHit, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "special",
      });
    }

    if (!enableSnap) return createHitResult();

    const snapRadiusPx = Number.isFinite(Number(snapPx))
      ? Math.max(0, Number(snapPx))
      : HIT_SNAP_RADIUS_PX;
    const radiusProj = snapRadiusPx / pointer.zoomK;
    if (radiusProj <= 0) return createHitResult();

    const snapCandidates = candidateCollector
      ? candidateCollector.special(radiusProj) : collectSpecialGridCandidates(pointer.px, pointer.py, radiusProj);
    const snapRanked = rankCandidates(snapCandidates, pointer.lonLat, { eventType, targetType: "special" });
    const chosen = snapRanked.find((candidate) => candidate.containsGeo);
    if (!chosen) return createHitResult();
    return toHitResult(chosen, {
      viaSnap: true,
      strict: false,
      zoomK: pointer.zoomK,
      targetType: "special",
    });
  }

  function getHitFromEvent(
    event,
    { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
  ) {
    if ((!runtimeState.landData || !runtimeState.spatialItems?.length) && !runtimeState.waterSpatialItems?.length && !runtimeState.specialSpatialItems?.length) {
      return createHitResult();
    }
    const pointer = getPointerProjectionPosition(event);
    if (!pointer) return createHitResult();
    const candidateCollector = eventType === "hover" ? null : createInteractionHitCandidateCollector(pointer);
    const specialHit = getSpecialHitFromPointer(pointer, {
      enableSnap,
      snapPx,
      eventType,
      candidateCollector,
    });
    let resolvedHit = specialHit;
    if (!resolvedHit.id) {
      const landHit = getLandHitFromPointer(event, pointer, {
        enableSnap,
        snapPx,
        eventType,
        candidateCollector,
      });
      const waterHit = getWaterHitFromPointer(pointer, {
        enableSnap,
        snapPx,
        eventType,
        candidateCollector,
      });
      if (
        waterHit.id
        && isScenarioWaterRegion(waterHit.feature)
        && eventType !== "hover"
      ) {
        resolvedHit = waterHit;
      } else if (shouldPreferWaterHit(landHit, waterHit, { eventType })) {
        resolvedHit = waterHit;
      } else if (landHit.id) {
        resolvedHit = landHit;
      } else if (waterHit.id) {
        resolvedHit = waterHit;
      } else {
        resolvedHit = createHitResult();
      }
    }
    recordInteractionHitMetrics(pointer, {
      enableSnap,
      snapPx,
      eventType,
      resolvedHit,
      candidateCollector,
    });
    return getRiverPaintRuntime(runtimeState).refineHit(resolvedHit, pointer.lonLat);
  }

  return {
    keyToHitColor,
    fillHitFeature,
    hitColorToKey,
    drawHitCanvas,
    drawHitCanvasWithMetric,
    drawScheduledHitCanvasWithMetric,
    recordDeferredFullHitCanvasMetric,
    scheduleHitCanvasBuildIfNeeded,
    ensureHitCanvasUpToDate,
    isHitCanvasCurrent,
    getHitResultFromCanvas,
    getDirtyHitCanvasPointProbeHit,
    getValidatedCanvasHit,
    collectGridCandidates,
    collectWaterGridCandidates,
    collectSpecialGridCandidates,
    createInteractionHitCandidateCollector,
    rankCandidates,
    findFirstContainingCandidate,
    getPointerProjectionPosition,
    toHitResult,
    shouldPreferWaterHit,
    collectInteractionHitMetricDetails,
    recordInteractionHitMetrics,
    collectRiverVisualCandidates,
    getVisibleRiverLandHit,
    getLandHitFromPointer,
    getWaterHitFromPointer,
    getSpecialHitFromPointer,
    getHitFromEvent,
  };
}
