import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";

// Widths are CSS pixels; the caller's canvas already includes zoom and DPR.
export function getUrbanZoomPaint(k) {
  const scale = Math.max(0.0001, Number(k) || 1);
  const progress = Math.max(0, Math.min(1, (scale - 3) / 9));
  const near = progress * progress * (3 - 2 * progress);
  return {
    strokeWidth: (0.85 - 0.2 * near) / scale,
    strokeAlphaFactor: 1 - 0.65 * near,
    fillAlphaFactor: 1 - 0.15 * near,
  };
}

export function createUrbanLayerRenderOwner({ state, helpers }) {
  const {
    clamp, collectContextMetric, createDrawPaintResolver, getContext,
    getEffectiveUrbanMode, getPathCanvas, getProjection, getSafeBlendMode,
    getSafeCanvasColor, getUrbanGlowFeatureMultiplier, getUrbanLayerCapability,
    normalizeUrbanStyleConfig, nowMs, estimateProjectedAreaPx, pathBoundsInScreen,
    getPath2D = () => globalThis.Path2D,
  } = helpers;
  let paths = new WeakMap();
  let source = null;
  let projectionGeneration = -1;
  let contextRevision = -1;

  function ensurePathCache() {
    const generation = getProjectionGeometryGeneration(getProjection());
    const revision = Number(state.contextLayerRevision || 0);
    if (source !== state.urbanData || projectionGeneration !== generation || contextRevision !== revision) {
      paths = new WeakMap();
      source = state.urbanData;
      projectionGeneration = generation;
      contextRevision = revision;
    }
  }

  function getPath(feature, pathCanvas, counts) {
    const geometry = feature.geometry;
    const Path = getPath2D();
    if (!geometry || typeof Path !== "function" || typeof pathCanvas.context !== "function") return null;
    const cached = paths.get(geometry);
    if (cached) {
      counts.pathCacheHitCount += 1;
      return cached;
    }
    const previousContext = pathCanvas.context();
    const path = new Path();
    // Restore the shared d3 stream before any other layer or export uses it.
    try {
      pathCanvas.context(path);
      pathCanvas(feature);
    } finally {
      pathCanvas.context(previousContext);
    }
    paths.set(geometry, path);
    counts.pathBuildCount += 1;
    return path;
  }

  function drawUrbanLayer(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    const featureCount = state.urbanData?.features?.length || 0;
    if (!state.showUrban || !featureCount) {
      collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
        featureCount, interactive: !!interactive, skipped: true,
        reason: !state.showUrban ? "hidden" : "no-data",
      });
      return;
    }
    const cfg = normalizeUrbanStyleConfig(state.styleConfig?.urban || {});
    const capability = state.urbanLayerCapability || getUrbanLayerCapability(state.urbanData);
    const effectiveMode = getEffectiveUrbanMode(cfg, capability);
    const adaptive = effectiveMode === "adaptive";
    const manualColor = getSafeCanvasColor(cfg.color, "#4b5563");
    const { fillOpacity, strokeOpacity, minAreaPx } = cfg;
    const zoomPaint = getUrbanZoomPaint(k);
    const fillAlpha = (interactive ? Math.min(fillOpacity, 0.15) : fillOpacity)
      * (adaptive ? zoomPaint.fillAlphaFactor : 1);
    const strokeAlpha = adaptive
      ? (interactive ? Math.min(strokeOpacity, 0.18) : strokeOpacity) * zoomPaint.strokeAlphaFactor
      : 0;
    const counts = { visibleFeatureCount: 0, pathBuildCount: 0, pathCacheHitCount: 0 };
    const context = getContext();
    const pathCanvas = getPathCanvas();
    const resolvePaint = adaptive ? createDrawPaintResolver(cfg) : null;

    ensurePathCache();
    context.save();
    try {
      context.globalCompositeOperation = adaptive ? "source-over" : getSafeBlendMode(cfg.blendMode, "multiply");
      context.lineJoin = "round";
      context.lineCap = "round";
      context.setLineDash([]);
      context.lineWidth = zoomPaint.strokeWidth;
      if (fillAlpha > 0 || strokeAlpha > 0) {
        for (const feature of state.urbanData.features) {
          if (estimateProjectedAreaPx(feature, k) < minAreaPx || !pathBoundsInScreen(feature)) continue;
          const glowMultiplier = getUrbanGlowFeatureMultiplier(feature);
          const resolvedFillAlpha = clamp(fillAlpha * glowMultiplier, 0, 1);
          const resolvedStrokeAlpha = clamp(strokeAlpha * glowMultiplier, 0, 1);
          if (!(resolvedFillAlpha > 0 || resolvedStrokeAlpha > 0)) continue;
          const paint = resolvePaint?.(feature);
          const fillColor = getSafeCanvasColor(paint?.fillColor, manualColor);
          const outlineColor = getSafeCanvasColor(paint?.strokeColor, null);
          if (!fillColor) continue;
          if (!(resolvedFillAlpha > 0 || (outlineColor && resolvedStrokeAlpha > 0))) continue;
          const path = getPath(feature, pathCanvas, counts);
          if (!path) {
            context.beginPath();
            pathCanvas(feature);
            counts.pathBuildCount += 1;
          }
          if (resolvedFillAlpha > 0) {
            context.fillStyle = fillColor;
            context.globalAlpha = resolvedFillAlpha;
            if (path) context.fill(path);
            else context.fill();
          }
          if (outlineColor && resolvedStrokeAlpha > 0) {
            context.strokeStyle = outlineColor;
            context.globalAlpha = resolvedStrokeAlpha;
            if (path) context.stroke(path);
            else context.stroke();
          }
          counts.visibleFeatureCount += 1;
        }
      }
    } finally {
      context.restore();
    }
    collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
      featureCount, interactive: !!interactive, skipped: false,
      mode: effectiveMode, requestedMode: cfg.mode,
      adaptiveAvailable: !!capability?.adaptiveAvailable, ...counts,
    });
  }

  return { drawUrbanLayer };
}
