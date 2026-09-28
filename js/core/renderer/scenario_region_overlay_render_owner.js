// Scenario water, special-region and Atlantropa overlays share one pass and cache lifecycle.
import { getSafeCanvasColor } from "./canvas_color_helpers.js";
import { isLakeRegion } from "./effective_water_regions.js";
import { GeometryBudgetMap, getGeometryRetentionWeights, PROJECTED_PATH_CACHE_BUDGET } from "./geometry_cache_budget.js";
import { getFeatureId as getSharedFeatureId } from "../feature_identity.js";
import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";

export function createScenarioRegionOverlayRenderOwner(runtimeState, {
  rendererSurfaceHost,
  scenarioLayerCache,
  cloneZoomTransform,
  nowMs,
  collectContextMetric,
  isWaterRegionRenderable,
  getWaterRegionDefaultStyle,
  collectSafeWaterRegionGeometryParts,
  projectedGeoBoundsInScreen,
  computeProjectedGeoBounds,
  getWaterRegionColor,
  getEffectiveAtlantropaFeatures,
  getLogicalCanvasDimensions,
  shouldExcludePoliticalVisualFeature,
  shouldSkipFeature,
  pathBoundsInScreen,
  getResolvedFeatureColor,
  LAND_FILL_COLOR,
  getPoliticalFeaturePathEntry,
  getScenarioWaterVisualRevisionToken,
  isWaterRegionEnabled,
  isMacroOceanWaterRegion,
  isBaseGeographyScenarioFeature,
  isSpecialRegionEnabled,
  getSpecialRegionOpacity,
  getSpecialRegionColor,
  getSpecialRegionStrokeColor,
  getScenarioSpecialVisualRevisionToken,
  isScenarioAtlantropaVisible,
  getEffectiveWaterRegionFeatures,
  getEffectiveSpecialRegionFeatures,
  getForcedScenarioWaterCacheMode,
  getScenarioWaterCacheComplexitySignals,
  shouldEnableContextScenarioTransformReuse,
  shouldUseDirectScenarioWaterDraw,
  waterPathCacheBudget = PROJECTED_PATH_CACHE_BUDGET,
  scheduleWaterWork = (callback) => globalThis.setTimeout(callback, 0),
  cancelWaterWork = (handle) => globalThis.clearTimeout(handle),
  requestRender = () => {},
}) {
  const scenarioWaterPathCache = new GeometryBudgetMap({ budget: waterPathCacheBudget, weigh: (entry) => entry.estimatedBytes });
  // Weak geometry aliases let fresh feature wrappers reuse a bounded feature
  // path when sanitization rebinds the exact same safe part objects. Alias
  // values are opaque cache keys (never features or geometry), so the weak
  // index cannot retain payloads outside GeometryBudgetMap's byte budget.
  const scenarioWaterFeaturePathKeyByPart = new WeakMap();
  let scenarioWaterPartBoundsCache = new WeakMap();
  let lastScenarioWaterRenderedCount = 0;
  let waterPathBuildCount = 0;
  let waterPathBuildMs = 0;
  let waterPathBuildDepth = 0;
  let visibleWaterWarmup = null;
  let skippedWaterWarmupIdentity = "";
  let waterPathCacheEpoch = 0;

  function getScenarioWaterPartBounds(part) {
    const cached = scenarioWaterPartBoundsCache.get(part);
    if (cached) return cached;
    const bounds = computeProjectedGeoBounds(part);
    // Bounds live in projection coordinates, as do the cached paths. Screen
    // culling still uses the current zoom on every draw. Retry failed bounds.
    if (bounds) scenarioWaterPartBoundsCache.set(part, bounds);
    return bounds;
  }

  function getScenarioWaterSelection() {
    const showWater = !!runtimeState.showWaterRegions;
    const sharedLakes = showWater ? [] : (runtimeState.contextLayerExternalDataByName?.lakes?.features || []);
    const atlantropaFeatures = showWater || sharedLakes.length ? getEffectiveAtlantropaFeatures() : null;
    const effectiveWaterFeatures = atlantropaFeatures ? getEffectiveWaterRegionFeatures(atlantropaFeatures) : [];
    const sharedLakeIds = sharedLakes.length
      ? new Set(sharedLakes.map((feature) => getSharedFeatureId(feature) || null)) : null;
    const waterFeatures = showWater
      ? effectiveWaterFeatures
      : sharedLakeIds ? effectiveWaterFeatures.filter((feature) => sharedLakeIds.has(getSharedFeatureId(feature) || null)) : [];
    return { showWater, atlantropaFeatures, effectiveWaterFeatures, waterFeatures };
  }

  function drawScenarioWaterFillLayer(k, { waterFeatures = [], maskOnly = false } = {}) {
    const startedAt = nowMs();
    const buildCountBefore = waterPathBuildCount;
    const buildMsBefore = waterPathBuildMs;
    let renderedWaterCount = 0;
    if (!waterFeatures.length) {
      if (!maskOnly) collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        buildCount: 0,
        pathBuildMs: 0,
        skipped: true,
        reason: "no-features",
      });
      return 0;
    }
    waterFeatures.forEach((feature, index) => {
      if (!isWaterRegionRenderable(feature)) return;
      const parts = collectSafeWaterRegionGeometryParts(feature);
      if (!parts.length) return;
      const visibleParts = [];
      parts.forEach((part) => {
        if (!projectedGeoBoundsInScreen(getScenarioWaterPartBounds(part))) return;
        visibleParts.push(part);
      });
      if (!visibleParts.length) return;
      const fillOpacity = maskOnly ? 1 : getWaterRegionDefaultStyle(feature).opacity;
      if (!(fillOpacity > 0)) return;
      const id = getSharedFeatureId(feature) || `water-${index}`;
      rendererSurfaceHost.getContext().save();
      rendererSurfaceHost.getContext().globalAlpha = fillOpacity;
      rendererSurfaceHost.getContext().fillStyle = getWaterRegionColor(id, feature);
      const context = rendererSurfaceHost.getContext();
      const softenShore = !maskOnly && isLakeRegion(feature) && runtimeState.showRivers;
      const fillWaterPath = (path = null) => {
        // A sub-pixel shore in the river hue bridges the two water styles.
        // Keep the lake interior opaque and keep the river below the lake.
        if (softenShore) {
          context.save();
          context.globalAlpha = fillOpacity * 0.22;
          context.strokeStyle = getSafeCanvasColor(runtimeState.styleConfig?.rivers?.color, "#3b82f6");
          context.lineWidth = 1.4 / Math.max(0.0001, k);
          context.lineJoin = "round";
          context.setLineDash([]);
          if (path) context.stroke(path); else context.stroke();
          context.restore();
        }
        if (path) context.fill(path); else context.fill();
      };
      const waterPath = visibleParts.length === parts.length
        ? getScenarioWaterFeaturePath(feature, parts)
        : null;
      let didFill = false;
      if (waterPath) {
        fillWaterPath(waterPath);
        didFill = true;
      } else if (globalThis.Path2D) {
        visibleParts.forEach((part) => {
          const partPath = getScenarioWaterPartPath(part);
          if (partPath) {
            fillWaterPath(partPath);
            didFill = true;
          } else if (rendererSurfaceHost.getPathCanvas()) {
            rendererSurfaceHost.getContext().beginPath();
            rendererSurfaceHost.getPathCanvas()(part);
            fillWaterPath();
            didFill = true;
          }
        });
      } else if (rendererSurfaceHost.getPathCanvas()) {
        rendererSurfaceHost.getContext().beginPath();
        visibleParts.forEach((part) => {
          if (rendererSurfaceHost.getPathCanvas()) rendererSurfaceHost.getPathCanvas()(part);
        });
        fillWaterPath();
        didFill = true;
      }
      rendererSurfaceHost.getContext().restore();
      if (didFill) renderedWaterCount += 1;
    });
    if (!maskOnly) collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
      featureCount: waterFeatures.length,
      renderedCount: renderedWaterCount,
      buildCount: waterPathBuildCount - buildCountBefore,
      pathBuildMs: waterPathBuildMs - buildMsBefore,
      skipped: renderedWaterCount === 0,
      reason: renderedWaterCount === 0 ? "culled" : "",
      pathCacheBudget: scenarioWaterPathCache.getStats(),
    });
    return renderedWaterCount;
  }

  function drawScenarioAtlantropaLandLikeOverlayLayer(k, buckets = getEffectiveAtlantropaFeatures()) {
    const startedAt = nowMs();
    const overlayFeatures = [
      ...buckets.land,
      ...buckets.shoal,
      ...buckets.relief,
    ];
    let renderedCount = 0;
    if (!overlayFeatures.length) {
      collectContextMetric("drawScenarioAtlantropaLandLikeOverlayLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "no-features",
      });
      return 0;
    }
    const transform = runtimeState.zoomTransform || globalThis.d3?.zoomIdentity;
    const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
    overlayFeatures.forEach((feature, index) => {
      const id = getSharedFeatureId(feature) || `atlantropa-overlay-${index}`;
      if (!id) return;
      if (shouldExcludePoliticalVisualFeature(feature, id)) return;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;
      if (!pathBoundsInScreen(feature)) return;
      const fillColor =
        getSafeCanvasColor(runtimeState.colors?.[id], null)
        || getSafeCanvasColor(getResolvedFeatureColor(feature, id), null)
        || LAND_FILL_COLOR;
      const cachedPath = getPoliticalFeaturePathEntry(feature, {
        featureId: id,
        transform,
        allowBuild: true,
        countBuild: false,
      })?.path || null;
      rendererSurfaceHost.getContext().save();
      rendererSurfaceHost.getContext().globalAlpha = 1;
      rendererSurfaceHost.getContext().fillStyle = fillColor;
      if (cachedPath) {
        rendererSurfaceHost.getContext().fill(cachedPath);
      } else {
        rendererSurfaceHost.getContext().beginPath();
        rendererSurfaceHost.getPathCanvas()(feature);
        rendererSurfaceHost.getContext().fill();
      }
      rendererSurfaceHost.getContext().restore();
      renderedCount += 1;
    });
    collectContextMetric("drawScenarioAtlantropaLandLikeOverlayLayer", nowMs() - startedAt, {
      featureCount: overlayFeatures.length,
      renderedCount,
      skipped: renderedCount === 0,
      reason: renderedCount === 0 ? "culled" : "",
    });
    return renderedCount;
  }

  function renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures, waterVisualRevision) {
    return scenarioLayerCache.render("water", currentTransform, {
      draw: (layerK) => drawScenarioWaterFillLayer(layerK, { waterFeatures }),
      getSignature: () => waterVisualRevision,
    });
  }

  function getScenarioWaterPartPath(part) {
    if (!part || typeof part !== "object" || !globalThis.Path2D || typeof rendererSurfaceHost.getPathSvg !== "function") {
      return null;
    }
    if (scenarioWaterPathCache.has(part)) {
      return scenarioWaterPathCache.get(part).path || null;
    }
    const trackBuild = waterPathBuildDepth === 0;
    const buildStartedAt = trackBuild ? nowMs() : 0;
    let path = null;
    try {
      const pathString = rendererSurfaceHost.getPathSvg()(part);
      path = pathString ? new globalThis.Path2D(pathString) : null;
    } catch (_error) {
      path = null;
    }
    if (path) scenarioWaterPathCache.set(part, { path, estimatedBytes: getGeometryRetentionWeights(part).path });
    if (trackBuild) {
      waterPathBuildCount += 1;
      waterPathBuildMs += Math.max(0, nowMs() - buildStartedAt);
    }
    return path;
  }

  function sameWaterPathParts(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((part, index) => part === right[index]);
  }

  function findCachedWaterFeaturePath(parts) {
    if (!Array.isArray(parts) || !parts.length) return null;
    const cacheKey = scenarioWaterFeaturePathKeyByPart.get(parts[0]);
    if (!cacheKey) return null;
    const cached = scenarioWaterPathCache.get(cacheKey);
    return cached?.path && sameWaterPathParts(cached.parts, parts)
      && cached.projectionGeneration === getProjectionGeometryGeneration(rendererSurfaceHost.getProjection())
      ? cached.path : null;
  }

  function getCachedWaterFeaturePath(feature, parts) {
    if (!feature || !Array.isArray(parts)) return null;
    return findCachedWaterFeaturePath(parts);
  }

  function getScenarioWaterFeaturePath(feature, parts) {
    if (!feature || typeof feature !== "object" || !globalThis.Path2D) {
      return null;
    }
    const borrowed = getCachedWaterFeaturePath(feature, parts);
    if (borrowed) return borrowed;
    const buildStartedAt = nowMs();
    waterPathBuildDepth += 1;
    try {
      const combinedPath = parts.length > 1 ? new globalThis.Path2D() : null;
      let singlePath = null;
      let added = false;
      (Array.isArray(parts) ? parts : []).forEach((part) => {
        const partPath = getScenarioWaterPartPath(part);
        if (!partPath) return;
        if (combinedPath) {
          if (typeof combinedPath.addPath !== "function") return;
          combinedPath.addPath(partPath);
        } else {
          singlePath = partPath;
        }
        added = true;
      });
      const path = added ? (combinedPath || singlePath) : null;
      const estimatedBytes = 256 + parts.reduce((sum, part) => sum + getGeometryRetentionWeights(part).path - 256 + 8, 0);
      // A whole-feature path contains the same commands as its component paths.
      // When retaining the combined path, release those duplicate native paths
      // before admission so they cannot evict unrelated visible-water entries.
      if (path) {
        if (estimatedBytes <= waterPathCacheBudget) for (const part of parts) scenarioWaterPathCache.delete(part);
        const cacheKey = Symbol("scenario-water-path");
        scenarioWaterPathCache.set(cacheKey, { path, parts, estimatedBytes });
        const retained = scenarioWaterPathCache.get(cacheKey);
        if (retained?.path === path) {
          retained.projectionGeneration = getProjectionGeometryGeneration(rendererSurfaceHost.getProjection());
          for (const part of parts) scenarioWaterFeaturePathKeyByPart.set(part, cacheKey);
        }
      }
      return path;
    } finally {
      waterPathBuildDepth -= 1;
      waterPathBuildCount += 1;
      waterPathBuildMs += Math.max(0, nowMs() - buildStartedAt);
    }
  }

  function canPrepareVisibleWaterPaths() {
    return runtimeState.firstVisibleFramePainted && runtimeState.renderPhase === "idle"
      && !runtimeState.bootBlocking && !runtimeState.scenarioApplyInFlight
      && !runtimeState.startupReadonly && !runtimeState.startupReadonlyUnlockInFlight;
  }

  function getVisibleWaterWarmupIdentity(selection) {
    const transform = runtimeState.zoomTransform || {};
    return JSON.stringify([
      runtimeState.activeScenarioId, runtimeState.sceneGeneration, runtimeState.scenarioDataGeneration,
      runtimeState.contextLayerRevision, waterPathCacheEpoch,
      getProjectionGeometryGeneration(rendererSurfaceHost.getProjection()),
      transform.x, transform.y, transform.k, runtimeState.width, runtimeState.height, runtimeState.dpr,
      getScenarioWaterVisualRevisionToken({
        effectiveWaterFeatureCount: selection.effectiveWaterFeatures.length,
        atlantropaFeatures: selection.atlantropaFeatures,
      }),
    ]);
  }

  function cancelVisibleWaterWarmup() {
    if (visibleWaterWarmup?.handle != null) cancelWaterWork(visibleWaterWarmup.handle);
    visibleWaterWarmup = null;
  }

  function scheduleVisibleWaterWarmup(task) {
    task.handle = scheduleWaterWork(() => {
      task.handle = null;
      if (visibleWaterWarmup !== task) return;
      if (!canPrepareVisibleWaterPaths() || getVisibleWaterWarmupIdentity(task.selection) !== task.identity) {
        visibleWaterWarmup = null;
        return;
      }
      const sliceStartedAt = nowMs();
      try {
        while (task.index < task.plans.length) {
          const plan = task.plans[task.index];
          const part = plan.visibleParts[task.partIndex];
          if (!getScenarioWaterPartPath(part)) {
            skippedWaterWarmupIdentity = task.identity;
            collectContextMetric("visibleWaterPathWarmup", 0, { skipped: true, reason: "path-unavailable" });
            visibleWaterWarmup = null;
            requestRender("visible-water-paths-unavailable");
            return;
          }
          task.partIndex += 1;
          if (task.partIndex === plan.visibleParts.length) {
            if (plan.allPartsVisible && !getScenarioWaterFeaturePath(plan.feature, plan.parts)) {
              skippedWaterWarmupIdentity = task.identity;
              collectContextMetric("visibleWaterPathWarmup", 0, { skipped: true, reason: "feature-path-unavailable" });
              visibleWaterWarmup = null;
              requestRender("visible-water-paths-unavailable");
              return;
            }
            task.index += 1;
            task.partIndex = 0;
          }
          if (nowMs() - sliceStartedAt >= 6) break;
        }
      } catch (_error) {
        skippedWaterWarmupIdentity = task.identity;
        visibleWaterWarmup = null;
        requestRender("visible-water-paths-unavailable");
        return;
      }
      task.maxSliceMs = Math.max(task.maxSliceMs, nowMs() - sliceStartedAt);
      if (!canPrepareVisibleWaterPaths() || getVisibleWaterWarmupIdentity(task.selection) !== task.identity) {
        visibleWaterWarmup = null;
        return;
      }
      if (task.index < task.plans.length) {
        scheduleVisibleWaterWarmup(task);
      } else {
        visibleWaterWarmup = null;
        collectContextMetric("visibleWaterPathWarmup", nowMs() - task.startedAt, {
          featureCount: task.plans.length, maxSliceMs: task.maxSliceMs, skipped: false,
        });
        requestRender("visible-water-paths-ready");
      }
    });
  }

  function prepareVisibleWaterPaths() {
    if (!canPrepareVisibleWaterPaths()) {
      cancelVisibleWaterWarmup();
      return true;
    }
    if (visibleWaterWarmup) {
      if (getVisibleWaterWarmupIdentity(visibleWaterWarmup.selection) === visibleWaterWarmup.identity) return false;
      cancelVisibleWaterWarmup();
    }
    const selection = getScenarioWaterSelection();
    const plans = [];
    let visiblePathBytes = 0;
    for (const feature of selection.waterFeatures) {
      if (!isWaterRegionRenderable(feature)) continue;
      const parts = collectSafeWaterRegionGeometryParts(feature);
      const visibleParts = parts.filter((part) => projectedGeoBoundsInScreen(getScenarioWaterPartBounds(part)));
      if (!visibleParts.length || !(getWaterRegionDefaultStyle(feature).opacity > 0)) continue;
      const allPartsVisible = visibleParts.length === parts.length;
      visiblePathBytes += allPartsVisible
        ? 256 + parts.reduce((sum, part) => sum + getGeometryRetentionWeights(part).path - 256 + 8, 0)
        : visibleParts.reduce((sum, part) => sum + getGeometryRetentionWeights(part).path, 0);
      if (allPartsVisible ? getCachedWaterFeaturePath(feature, parts)
        : visibleParts.every((part) => scenarioWaterPathCache.has(part))) continue;
      plans.push({ feature, parts, visibleParts, allPartsVisible });
    }
    const identity = getVisibleWaterWarmupIdentity(selection);
    if (!plans.length || skippedWaterWarmupIdentity === identity) return true;
    if (visiblePathBytes > waterPathCacheBudget) {
      skippedWaterWarmupIdentity = identity;
      collectContextMetric("visibleWaterPathWarmup", 0, {
        skipped: true, reason: "over-budget", visiblePathBytes, budgetBytes: waterPathCacheBudget,
      });
      return true;
    }
    const task = { identity, selection, plans, index: 0, partIndex: 0, handle: null, startedAt: nowMs(), maxSliceMs: 0 };
    visibleWaterWarmup = task;
    scheduleVisibleWaterWarmup(task);
    return false;
  }

  function drawScenarioWaterHighlightLayer(k) {
    const highlightIds = new Set([
      String(runtimeState.selectedWaterRegionId || "").trim(),
    ].filter(Boolean));
    let highlightedCount = 0;
    highlightIds.forEach((id) => {
      const feature = runtimeState.waterRegionsById?.get(id);
      if (!feature) return;
      if (!isWaterRegionEnabled(feature)) return;
      const parts = collectSafeWaterRegionGeometryParts(feature);
      if (!parts.length) return;
      const isMacroOcean = isMacroOceanWaterRegion(feature);
      rendererSurfaceHost.getContext().beginPath();
      let visiblePartCount = 0;
      parts.forEach((part) => {
        if (!projectedGeoBoundsInScreen(getScenarioWaterPartBounds(part))) return;
        if (!rendererSurfaceHost.getPathCanvas()) return;
        rendererSurfaceHost.getPathCanvas()(part);
        visiblePartCount += 1;
      });
      if (!visiblePartCount) return;
      rendererSurfaceHost.getContext().save();
      rendererSurfaceHost.getContext().globalAlpha = isMacroOcean ? 0.92 : 1;
      rendererSurfaceHost.getContext().strokeStyle = "#f1c40f";
      rendererSurfaceHost.getContext().lineWidth = (isMacroOcean ? 1.15 : 0.9) / Math.max(0.0001, k);
      rendererSurfaceHost.getContext().lineJoin = "round";
      rendererSurfaceHost.getContext().stroke();
      rendererSurfaceHost.getContext().restore();
      highlightedCount += 1;
    });
    return highlightedCount;
  }

  function drawScenarioSpecialRegionOverlaysLayer(k, { specialFeatures = [] } = {}) {
    const startedAt = nowMs();
    let renderedSpecialCount = 0;
    if (!specialFeatures.length) {
      collectContextMetric("drawScenarioSpecialRegionOverlaysLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "no-features",
      });
      return 0;
    }
    specialFeatures.forEach((feature, index) => {
      const id = getSharedFeatureId(feature) || `special-${index}`;
      const renderAsBase = isBaseGeographyScenarioFeature(feature);
      if (!isSpecialRegionEnabled(feature)) return;
      if (!pathBoundsInScreen(feature)) return;
      rendererSurfaceHost.getContext().beginPath();
      rendererSurfaceHost.getPathCanvas()(feature);
      rendererSurfaceHost.getContext().save();
      rendererSurfaceHost.getContext().globalAlpha = renderAsBase
        ? Math.max(getSpecialRegionOpacity(feature, id), 0.94)
        : getSpecialRegionOpacity(feature, id);
      rendererSurfaceHost.getContext().fillStyle = getSpecialRegionColor(id, feature);
      rendererSurfaceHost.getContext().fill();
      rendererSurfaceHost.getContext().restore();
      rendererSurfaceHost.getContext().strokeStyle = getSpecialRegionStrokeColor(feature);
      rendererSurfaceHost.getContext().lineWidth = 1 / Math.max(0.0001, k);
      rendererSurfaceHost.getContext().lineJoin = "round";
      rendererSurfaceHost.getContext().stroke();
      renderedSpecialCount += 1;
    });
    collectContextMetric("drawScenarioSpecialRegionOverlaysLayer", nowMs() - startedAt, {
      featureCount: specialFeatures.length,
      renderedCount: renderedSpecialCount,
      skipped: renderedSpecialCount === 0,
      reason: renderedSpecialCount === 0 ? "culled" : "",
    });
    return renderedSpecialCount;
  }

  function renderScenarioSpecialRegionOverlaysLayerToCache(currentTransform, specialFeatures) {
    return scenarioLayerCache.render("special", currentTransform, {
      draw: (layerK) => drawScenarioSpecialRegionOverlaysLayer(layerK, { specialFeatures }),
      getSignature: getScenarioSpecialVisualRevisionToken,
    });
  }

  function drawScenarioRegionOverlaysPass(k) {
    const startedAt = nowMs();
    const { showWater, atlantropaFeatures, effectiveWaterFeatures, waterFeatures } = getScenarioWaterSelection();
    const showSpecial = !!runtimeState.showScenarioSpecialRegions;
    const showAtlantropaLandLikeOverlay = showWater && isScenarioAtlantropaVisible();
    // Common lakes are base geography, including in scenes such as HGO that
    // disable the editable water-region overlay by default.
    const paintWater = showWater || waterFeatures.length > 0;
    const specialFeatures = showSpecial ? getEffectiveSpecialRegionFeatures() : [];
    let renderedWaterCount = 0;
    let renderedAtlantropaLandLikeCount = 0;
    let renderedSpecialCount = 0;
    let highlightedWaterCount = 0;
    let waterCacheMode = "disabled";
    let waterCacheStrategyMode = "disabled";
    let waterCacheStrategySource = "disabled";
    let waterCoverageAlgo = "disabled";
    let waterVisibleCoverageRatio = null;
    let waterPrevRenderedCount = Math.max(0, Number(lastScenarioWaterRenderedCount || 0));
    let specialCacheMode = "disabled";
    // water/special overlay 这里走的是显式策略选择，不是错误恢复链：
    // adaptive 会按覆盖率和复杂度在 reuse/redraw/direct 间切换；
    // direct 表示“直接画到当前 pass，不维护复用缓存”，不要把它当失败兜底继续叠 fallback。
    if (!paintWater && !showSpecial && !showAtlantropaLandLikeOverlay) {
      collectContextMetric("contextScenarioLayerWater", 0, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "disabled",
        cacheMode: "disabled",
        signature: getScenarioWaterVisualRevisionToken(),
      });
      collectContextMetric("contextScenarioLayerSpecial", 0, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "disabled",
        cacheMode: "disabled",
        signature: getScenarioSpecialVisualRevisionToken(),
      });
      collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
        featureCount: 0,
        waterFeatureCount: 0,
        specialFeatureCount: 0,
        renderedWaterCount: 0,
        renderedSpecialCount: 0,
        highlightedWaterCount: 0,
        waterVisibleCoverageRatio,
        waterPrevRenderedCount,
        waterCoverageAlgo,
        waterCacheMode,
        waterCacheStrategyMode,
        waterCacheStrategySource,
        skipped: true,
        reason: "disabled",
      });
      return;
    }

    if (paintWater) {
      const forcedWaterCache = getForcedScenarioWaterCacheMode();
      waterCacheStrategyMode = forcedWaterCache.mode;
      waterCacheStrategySource = forcedWaterCache.source;
      waterCoverageAlgo = "not-evaluated";

      const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
      const waterLayerEntry = scenarioLayerCache.getSnapshot("water");
      const waterVisualRevision = getScenarioWaterVisualRevisionToken({
        effectiveWaterFeatureCount: effectiveWaterFeatures.length,
        atlantropaFeatures,
      });
      const canReuseWaterLayer = (
        shouldEnableContextScenarioTransformReuse()
        && waterLayerEntry.signature === waterVisualRevision
        && waterLayerEntry.hasCanvas
        && waterLayerEntry.hasReferenceTransform
      );

      let evaluatedSignals = null;
      // The policy reads coverage only after feature and prior-render thresholds pass.
      const useAdaptiveDirect = forcedWaterCache.mode === "adaptive" && shouldUseDirectScenarioWaterDraw({
        featureCount: waterFeatures.length,
        previousRenderedCount: waterPrevRenderedCount,
        get visibleCoverageRatio() {
          evaluatedSignals ??= getScenarioWaterCacheComplexitySignals(waterFeatures);
          return evaluatedSignals.visibleCoverageRatio;
        },
      });
      if (evaluatedSignals) {
        waterVisibleCoverageRatio = evaluatedSignals.visibleCoverageRatio;
        waterPrevRenderedCount = evaluatedSignals.previousRenderedCount;
        waterCoverageAlgo = evaluatedSignals.waterCoverageAlgo || "grid";
      }
      const strategy = useAdaptiveDirect ? "adaptive-direct" : forcedWaterCache.mode;

      if (strategy === "direct" || strategy === "adaptive-direct") {
        waterCacheMode = strategy;
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: strategy,
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
      } else if (strategy !== "redraw" && canReuseWaterLayer && scenarioLayerCache.draw("water", currentTransform, { allowTransform: false })) {
        waterCacheMode = "reuse";
        collectContextMetric("contextScenarioLayerCacheHit", 0, {
          layer: "water",
          renderedCount: Number(waterLayerEntry.renderedCount || 0),
        });
        renderedWaterCount = Number(waterLayerEntry.renderedCount || 0);
      } else {
        // Reuse and adaptive share the same cache lifecycle; forced redraw only skips the hit.
        waterCacheMode = "redraw";
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: strategy === "redraw"
            ? "forced-redraw"
            : waterLayerEntry.signature === waterVisualRevision ? "transform" : "signature",
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures, waterVisualRevision);
        if (!scenarioLayerCache.draw("water", currentTransform)) {
          waterCacheMode = "direct";
          renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
        }
      }
      highlightedWaterCount = showWater ? drawScenarioWaterHighlightLayer(k) : 0;
      if (showAtlantropaLandLikeOverlay) {
        renderedAtlantropaLandLikeCount = drawScenarioAtlantropaLandLikeOverlayLayer(k, atlantropaFeatures);
      }
      lastScenarioWaterRenderedCount = Math.max(0, Number(renderedWaterCount || 0));
      collectContextMetric("contextScenarioLayerWater", 0, {
        featureCount: waterFeatures.length,
        renderedCount: renderedWaterCount,
        highlightedCount: highlightedWaterCount,
        cacheMode: waterCacheMode,
        signature: waterVisualRevision,
      });
    } else {
      collectContextMetric("contextScenarioLayerWater", 0, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "disabled",
        cacheMode: "disabled",
        signature: getScenarioWaterVisualRevisionToken(),
      });
    }

    if (showSpecial) {
      const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
      const specialLayerEntry = scenarioLayerCache.getSnapshot("special");
      const specialVisualRevision = getScenarioSpecialVisualRevisionToken();
      const canReuseSpecialLayer = (
        shouldEnableContextScenarioTransformReuse()
        && specialLayerEntry.signature === specialVisualRevision
        && specialLayerEntry.hasCanvas
        && specialLayerEntry.hasReferenceTransform
      );
      if (canReuseSpecialLayer && scenarioLayerCache.draw("special", currentTransform)) {
        specialCacheMode = "reuse";
        renderedSpecialCount = Number(specialLayerEntry.renderedCount || 0);
        collectContextMetric("contextScenarioLayerCacheHit", 0, {
          layer: "special",
          renderedCount: renderedSpecialCount,
        });
      } else {
        specialCacheMode = "redraw";
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "special",
          reason: specialLayerEntry.signature === specialVisualRevision ? "transform" : "signature",
          signatureChanged: specialLayerEntry.signature !== specialVisualRevision,
        });
        renderedSpecialCount = renderScenarioSpecialRegionOverlaysLayerToCache(currentTransform, specialFeatures);
        if (!scenarioLayerCache.draw("special", currentTransform)) {
          specialCacheMode = "direct";
          renderedSpecialCount = drawScenarioSpecialRegionOverlaysLayer(k, { specialFeatures });
        }
      }
      collectContextMetric("contextScenarioLayerSpecial", 0, {
        featureCount: specialFeatures.length,
        renderedCount: renderedSpecialCount,
        cacheMode: specialCacheMode,
        signature: getScenarioSpecialVisualRevisionToken(),
      });
    } else {
      collectContextMetric("contextScenarioLayerSpecial", 0, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "disabled",
        cacheMode: "disabled",
        signature: getScenarioSpecialVisualRevisionToken(),
      });
    }
    collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
      featureCount: waterFeatures.length + specialFeatures.length,
      waterFeatureCount: waterFeatures.length,
      atlantropaLandLikeRenderedCount: renderedAtlantropaLandLikeCount,
      specialFeatureCount: specialFeatures.length,
      renderedWaterCount,
      renderedSpecialCount,
      highlightedWaterCount,
      waterVisibleCoverageRatio,
      waterPrevRenderedCount,
      waterCoverageAlgo,
      waterCacheMode,
      waterCacheStrategyMode,
      waterCacheStrategySource,
      specialCacheMode,
      skipped: false,
    });
  }

  function resetWaterPathCaches() {
    cancelVisibleWaterWarmup();
    scenarioWaterPathCache.clear();
    scenarioWaterPartBoundsCache = new WeakMap();
    waterPathCacheEpoch += 1;
    skippedWaterWarmupIdentity = "";
  }

  function maskLakesFromPoliticalPatch(k) {
    const sharedLakeIds = new Set(
      (runtimeState.contextLayerExternalDataByName?.lakes?.features || [])
        .map((feature) => getSharedFeatureId(feature) || null),
    );
    const waterFeatures = getEffectiveWaterRegionFeatures().filter((feature) =>
      isLakeRegion(feature) && (runtimeState.showWaterRegions || sharedLakeIds.has(getSharedFeatureId(feature) || null)));
    const context = rendererSurfaceHost.getContext();
    context.save();
    try {
      context.globalCompositeOperation = "destination-out";
      drawScenarioWaterFillLayer(k, { waterFeatures, maskOnly: true });
    } finally {
      context.restore();
    }
  }

  function getPreviousWaterRenderedCount() {
    return lastScenarioWaterRenderedCount;
  }

  function resetPreviousWaterRenderedCount() {
    lastScenarioWaterRenderedCount = 0;
  }

  return Object.freeze({
    maskLakesFromPoliticalPatch,
    getScenarioWaterPartBounds,
    getCachedWaterFeaturePath,
    prepareVisibleWaterPaths,
    drawScenarioRegionOverlaysPass,
    resetWaterPathCaches,
    getPreviousWaterRenderedCount,
    resetPreviousWaterRenderedCount,
  });
}
