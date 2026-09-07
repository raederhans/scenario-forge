// Scenario water, special-region and Atlantropa overlays share one pass and cache lifecycle.
import { getSafeCanvasColor } from "./canvas_color_helpers.js";

export function createScenarioRegionOverlayRenderOwner({
  runtimeState,
  rendererSurfaceHost,
  getRenderPassCacheState,
  getRenderPassLayout,
  cloneZoomTransform,
  areZoomTransformsEquivalent,
  nowMs,
  collectContextMetric,
  getFeatureId,
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
  withRenderTarget,
  prepareTargetContext,
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
}) {
  let scenarioWaterPartPathCache = new WeakMap();
  let scenarioWaterFeaturePathCache = new WeakMap();
  let lastScenarioWaterRenderedCount = 0;

  function getContextScenarioLayerCacheEntry(layerName) {
    const cache = getRenderPassCacheState();
    const resolvedLayerName = String(layerName || "default").trim() || "default";
    const existing = cache.contextScenarioLayerCache?.[resolvedLayerName];
    if (existing && typeof existing === "object") {
      return existing;
    }
    const next = {
      canvas: null,
      signature: "",
      referenceTransform: null,
      renderedCount: 0,
    };
    cache.contextScenarioLayerCache[resolvedLayerName] = next;
    return next;
  }

  function ensureContextScenarioLayerCanvas(layerName) {
    const layerEntry = getContextScenarioLayerCacheEntry(layerName);
    if (!layerEntry.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      layerEntry.canvas = canvas;
    }
    const layout = getRenderPassLayout("contextScenario");
    if (layerEntry.canvas.width !== layout.pixelWidth || layerEntry.canvas.height !== layout.pixelHeight) {
      layerEntry.canvas.width = layout.pixelWidth;
      layerEntry.canvas.height = layout.pixelHeight;
      layerEntry.signature = "";
      layerEntry.referenceTransform = null;
      layerEntry.renderedCount = 0;
    }
    return layerEntry.canvas;
  }

  function drawCachedContextScenarioLayer(layerName, currentTransform) {
    const layerEntry = getContextScenarioLayerCacheEntry(layerName);
    const layerCanvas = layerEntry.canvas;
    const referenceTransform = layerEntry.referenceTransform
      ? cloneZoomTransform(layerEntry.referenceTransform)
      : null;
    if (!layerCanvas || !referenceTransform) return false;
    const layout = getRenderPassLayout("contextScenario");
    if (layerCanvas.width !== layout.pixelWidth || layerCanvas.height !== layout.pixelHeight) {
      return false;
    }
    rendererSurfaceHost.getContext().save();
    rendererSurfaceHost.getContext().setTransform(1, 0, 0, 1, 0, 0);
    if (areZoomTransformsEquivalent(referenceTransform, currentTransform)) {
      rendererSurfaceHost.getContext().drawImage(layerCanvas, 0, 0);
      rendererSurfaceHost.getContext().restore();
      return true;
    }
    const current = cloneZoomTransform(currentTransform);
    const scaleRatio = current.k / Math.max(referenceTransform.k, 0.0001);
    const dx = current.x - (referenceTransform.x * scaleRatio);
    const dy = current.y - (referenceTransform.y * scaleRatio);
    const offsetX = Number(layout?.offsetX || 0);
    const offsetY = Number(layout?.offsetY || 0);
    rendererSurfaceHost.getContext().translate(
      (dx + offsetX * (1 - scaleRatio)) * runtimeState.dpr,
      (dy + offsetY * (1 - scaleRatio)) * runtimeState.dpr,
    );
    rendererSurfaceHost.getContext().scale(scaleRatio, scaleRatio);
    rendererSurfaceHost.getContext().drawImage(layerCanvas, 0, 0);
    rendererSurfaceHost.getContext().restore();
    return true;
  }

  function drawScenarioWaterFillLayer(k, { waterFeatures = [] } = {}) {
    const startedAt = nowMs();
    let renderedWaterCount = 0;
    if (!waterFeatures.length) {
      collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        skipped: true,
        reason: "no-features",
      });
      return 0;
    }
    waterFeatures.forEach((feature, index) => {
      const id = getFeatureId(feature) || `water-${index}`;
      if (!isWaterRegionRenderable(feature)) return;
      const defaultStyle = getWaterRegionDefaultStyle(feature);
      const fillOpacity = defaultStyle.opacity;
      if (!(fillOpacity > 0)) return;
      const parts = collectSafeWaterRegionGeometryParts(feature);
      if (!parts.length) return;
      const visibleParts = [];
      parts.forEach((part) => {
        if (!projectedGeoBoundsInScreen(computeProjectedGeoBounds(part))) return;
        visibleParts.push(part);
      });
      if (!visibleParts.length) return;
      rendererSurfaceHost.getContext().save();
      rendererSurfaceHost.getContext().globalAlpha = fillOpacity;
      rendererSurfaceHost.getContext().fillStyle = getWaterRegionColor(id, feature);
      const waterPath = visibleParts.length === parts.length
        ? getScenarioWaterFeaturePath(feature, parts)
        : null;
      let didFill = false;
      if (waterPath) {
        rendererSurfaceHost.getContext().fill(waterPath);
        didFill = true;
      } else if (globalThis.Path2D) {
        visibleParts.forEach((part) => {
          const partPath = getScenarioWaterPartPath(part);
          if (partPath) {
            rendererSurfaceHost.getContext().fill(partPath);
            didFill = true;
          } else if (rendererSurfaceHost.getPathCanvas()) {
            rendererSurfaceHost.getContext().beginPath();
            rendererSurfaceHost.getPathCanvas()(part);
            rendererSurfaceHost.getContext().fill();
            didFill = true;
          }
        });
      } else if (rendererSurfaceHost.getPathCanvas()) {
        rendererSurfaceHost.getContext().beginPath();
        visibleParts.forEach((part) => {
          if (rendererSurfaceHost.getPathCanvas()) rendererSurfaceHost.getPathCanvas()(part);
        });
        rendererSurfaceHost.getContext().fill();
        didFill = true;
      }
      rendererSurfaceHost.getContext().restore();
      if (didFill) renderedWaterCount += 1;
    });
    collectContextMetric("drawScenarioWaterFillLayer", nowMs() - startedAt, {
      featureCount: waterFeatures.length,
      renderedCount: renderedWaterCount,
      skipped: renderedWaterCount === 0,
      reason: renderedWaterCount === 0 ? "culled" : "",
    });
    return renderedWaterCount;
  }

  function drawScenarioAtlantropaLandLikeOverlayLayer(k) {
    const startedAt = nowMs();
    const buckets = getEffectiveAtlantropaFeatures();
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
      const id = getFeatureId(feature) || `atlantropa-overlay-${index}`;
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

  function renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures) {
    const layerEntry = getContextScenarioLayerCacheEntry("water");
    const layerCanvas = ensureContextScenarioLayerCanvas("water");
    const layerContext = layerCanvas.getContext("2d");
    if (!layerContext) {
      layerEntry.signature = "";
      layerEntry.referenceTransform = null;
      layerEntry.renderedCount = 0;
      return 0;
    }
    const layout = getRenderPassLayout("contextScenario");
    let renderedWaterCount = 0;
    withRenderTarget(layerContext, () => {
      const layerK = prepareTargetContext(layerContext, currentTransform, layout);
      renderedWaterCount = drawScenarioWaterFillLayer(layerK, { waterFeatures });
    });
    layerEntry.signature = getScenarioWaterVisualRevisionToken();
    layerEntry.referenceTransform = cloneZoomTransform(currentTransform);
    layerEntry.renderedCount = renderedWaterCount;
    return renderedWaterCount;
  }

  function getScenarioWaterPartPath(part) {
    if (!part || typeof part !== "object" || !globalThis.Path2D || typeof rendererSurfaceHost.getPathSvg() !== "function") {
      return null;
    }
    if (scenarioWaterPartPathCache.has(part)) {
      return scenarioWaterPartPathCache.get(part) || null;
    }
    let path = null;
    try {
      const pathString = rendererSurfaceHost.getPathSvg()(part);
      path = pathString ? new globalThis.Path2D(pathString) : null;
    } catch (_error) {
      path = null;
    }
    scenarioWaterPartPathCache.set(part, path);
    return path;
  }

  function getScenarioWaterFeaturePath(feature, parts) {
    if (!feature || typeof feature !== "object" || !globalThis.Path2D) {
      return null;
    }
    if (scenarioWaterFeaturePathCache.has(feature)) {
      return scenarioWaterFeaturePathCache.get(feature) || null;
    }
    const combinedPath = new globalThis.Path2D();
    let added = false;
    (Array.isArray(parts) ? parts : []).forEach((part) => {
      const partPath = getScenarioWaterPartPath(part);
      if (!partPath || typeof combinedPath.addPath !== "function") return;
      combinedPath.addPath(partPath);
      added = true;
    });
    const path = added ? combinedPath : null;
    scenarioWaterFeaturePathCache.set(feature, path);
    return path;
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
        if (!projectedGeoBoundsInScreen(computeProjectedGeoBounds(part))) return;
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
      const id = getFeatureId(feature) || `special-${index}`;
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
    const layerEntry = getContextScenarioLayerCacheEntry("special");
    const layerCanvas = ensureContextScenarioLayerCanvas("special");
    const layerContext = layerCanvas.getContext("2d");
    if (!layerContext) {
      layerEntry.signature = "";
      layerEntry.referenceTransform = null;
      layerEntry.renderedCount = 0;
      return 0;
    }
    const layout = getRenderPassLayout("contextScenario");
    let renderedSpecialCount = 0;
    withRenderTarget(layerContext, () => {
      const layerK = prepareTargetContext(layerContext, currentTransform, layout);
      renderedSpecialCount = drawScenarioSpecialRegionOverlaysLayer(layerK, { specialFeatures });
    });
    layerEntry.signature = getScenarioSpecialVisualRevisionToken();
    layerEntry.referenceTransform = cloneZoomTransform(currentTransform);
    layerEntry.renderedCount = renderedSpecialCount;
    return renderedSpecialCount;
  }

  function drawScenarioRegionOverlaysPass(k) {
    const startedAt = nowMs();
    const showWater = !!runtimeState.showWaterRegions;
    const showSpecial = !!runtimeState.showScenarioSpecialRegions;
    const showAtlantropaLandLikeOverlay = showWater && isScenarioAtlantropaVisible();
    const waterFeatures = showWater ? getEffectiveWaterRegionFeatures() : [];
    const specialFeatures = showSpecial ? getEffectiveSpecialRegionFeatures() : [];
    let renderedWaterCount = 0;
    let renderedAtlantropaLandLikeCount = 0;
    let renderedSpecialCount = 0;
    let highlightedWaterCount = 0;
    let waterCacheMode = "disabled";
    let waterCacheStrategyMode = "disabled";
    let waterCacheStrategySource = "disabled";
    let waterCoverageAlgo = "disabled";
    let waterVisibleCoverageRatio = 0;
    let waterPrevRenderedCount = Math.max(0, Number(lastScenarioWaterRenderedCount || 0));
    let specialCacheMode = "disabled";
    // water/special overlay 这里走的是显式策略选择，不是错误恢复链：
    // adaptive 会按覆盖率和复杂度在 reuse/redraw/direct 间切换；
    // direct 表示“直接画到当前 pass，不维护复用缓存”，不要把它当失败兜底继续叠 fallback。
    if (!showWater && !showSpecial && !showAtlantropaLandLikeOverlay) {
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

    if (showWater) {
      const forcedWaterCache = getForcedScenarioWaterCacheMode();
      waterCacheStrategyMode = forcedWaterCache.mode;
      waterCacheStrategySource = forcedWaterCache.source;
      const signals = getScenarioWaterCacheComplexitySignals(waterFeatures);
      waterVisibleCoverageRatio = signals.visibleCoverageRatio;
      waterPrevRenderedCount = signals.previousRenderedCount;
      waterCoverageAlgo = signals.waterCoverageAlgo || "grid";

      const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
      const waterLayerEntry = getContextScenarioLayerCacheEntry("water");
      const waterVisualRevision = getScenarioWaterVisualRevisionToken();
      const canReuseWaterLayer = (
        shouldEnableContextScenarioTransformReuse()
        && waterLayerEntry.signature === waterVisualRevision
        && !!waterLayerEntry.canvas
        && !!waterLayerEntry.referenceTransform
      );

      const useAdaptiveDirect = forcedWaterCache.mode === "adaptive" && shouldUseDirectScenarioWaterDraw(signals);
      const strategy = useAdaptiveDirect ? "adaptive-direct" : forcedWaterCache.mode;

      if (strategy === "direct" || strategy === "adaptive-direct") {
        waterCacheMode = strategy;
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: strategy,
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
      } else if (strategy === "reuse") {
        if (canReuseWaterLayer && drawCachedContextScenarioLayer("water", currentTransform)) {
          waterCacheMode = "reuse";
          collectContextMetric("contextScenarioLayerCacheHit", 0, {
            layer: "water",
            renderedCount: Number(waterLayerEntry.renderedCount || 0),
          });
          renderedWaterCount = Number(waterLayerEntry.renderedCount || 0);
        } else {
          waterCacheMode = "redraw";
          collectContextMetric("contextScenarioLayerCacheMiss", 0, {
            layer: "water",
            reason: waterLayerEntry.signature === waterVisualRevision ? "transform" : "signature",
            signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
          });
          renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
          if (!drawCachedContextScenarioLayer("water", currentTransform)) {
            waterCacheMode = "direct";
            renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
          }
        }
      } else if (strategy === "redraw") {
        waterCacheMode = "redraw";
        collectContextMetric("contextScenarioLayerCacheMiss", 0, {
          layer: "water",
          reason: "forced-redraw",
          signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
        });
        renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
        if (!drawCachedContextScenarioLayer("water", currentTransform)) {
          waterCacheMode = "direct";
          renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
        }
      } else {
        if (canReuseWaterLayer && drawCachedContextScenarioLayer("water", currentTransform)) {
          waterCacheMode = "reuse";
          collectContextMetric("contextScenarioLayerCacheHit", 0, {
            layer: "water",
            renderedCount: Number(waterLayerEntry.renderedCount || 0),
          });
          renderedWaterCount = Number(waterLayerEntry.renderedCount || 0);
        } else {
          waterCacheMode = "redraw";
          collectContextMetric("contextScenarioLayerCacheMiss", 0, {
            layer: "water",
            reason: waterLayerEntry.signature === waterVisualRevision ? "transform" : "signature",
            signatureChanged: waterLayerEntry.signature !== waterVisualRevision,
          });
          renderedWaterCount = renderScenarioWaterFillLayerToCache(currentTransform, waterFeatures);
          if (!drawCachedContextScenarioLayer("water", currentTransform)) {
            waterCacheMode = "direct";
            renderedWaterCount = drawScenarioWaterFillLayer(k, { waterFeatures });
          }
        }
      }
      highlightedWaterCount = drawScenarioWaterHighlightLayer(k);
      if (showAtlantropaLandLikeOverlay) {
        renderedAtlantropaLandLikeCount = drawScenarioAtlantropaLandLikeOverlayLayer(k);
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
      const specialLayerEntry = getContextScenarioLayerCacheEntry("special");
      const specialVisualRevision = getScenarioSpecialVisualRevisionToken();
      const canReuseSpecialLayer = (
        shouldEnableContextScenarioTransformReuse()
        && specialLayerEntry.signature === specialVisualRevision
        && !!specialLayerEntry.canvas
        && !!specialLayerEntry.referenceTransform
      );
      if (canReuseSpecialLayer && drawCachedContextScenarioLayer("special", currentTransform)) {
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
        if (!drawCachedContextScenarioLayer("special", currentTransform)) {
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
    scenarioWaterPartPathCache = new WeakMap();
    scenarioWaterFeaturePathCache = new WeakMap();
  }

  function getPreviousWaterRenderedCount() {
    return lastScenarioWaterRenderedCount;
  }

  function resetPreviousWaterRenderedCount() {
    lastScenarioWaterRenderedCount = 0;
  }

  return {
    drawScenarioRegionOverlaysPass,
    getContextScenarioLayerCacheEntry,
    ensureContextScenarioLayerCanvas,
    drawCachedContextScenarioLayer,
    resetWaterPathCaches,
    getPreviousWaterRenderedCount,
    resetPreviousWaterRenderedCount,
  };
}
