const RIVER_LOW_MAX_SCALERANK = 5;
const RIVER_MID_MAX_SCALERANK = 7;

const RIVER_ZOOM_STYLE_FACTORS = {
  low: {
    coreWidthFactor: 1.2,
    outlineWidthFactor: 0.85,
    outlineAlphaFactor: 0.6,
  },
  mid: {
    coreWidthFactor: 1,
    outlineWidthFactor: 0.7,
    outlineAlphaFactor: 0.7,
  },
  high: {
    coreWidthFactor: 0.75,
    outlineWidthFactor: 0.35,
    outlineAlphaFactor: 0.45,
  },
};

const RIVER_CLASS_STYLE_FACTORS = {
  river: {
    widthFactor: 1,
    opacityFactor: 1,
    outlineFactor: 1,
  },
  intermittent: {
    widthFactor: 0.8,
    opacityFactor: 0.7,
    outlineFactor: 0.5,
  },
  lakeCenterline: {
    widthFactor: 0.72,
    opacityFactor: 0.55,
    outlineFactor: 0,
  },
  canal: {
    widthFactor: 0.72,
    opacityFactor: 0.6,
    outlineFactor: 0,
  },
  unknown: {
    widthFactor: 1,
    opacityFactor: 1,
    outlineFactor: 1,
  },
};

export function createRiverLayerRenderOwner({
  state = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    clamp,
    collectContextMetric,
    getContext = () => null,
    getContextBaseZoomBucketId,
    getDashPattern,
    getFeatureCollectionFeatureCount,
    getPathCanvas = () => null,
    getSafeCanvasColor,
    nowMs,
    pathBoundsInScreen,
  } = helpers;

  function getRiverZoomStyleFactors(k) {
    return RIVER_ZOOM_STYLE_FACTORS[getContextBaseZoomBucketId(k)] || RIVER_ZOOM_STYLE_FACTORS.mid;
  }

  function isHgoVectorSceneActive() {
    const manifest = runtimeState?.activeScenarioManifest || {};
    const profile = String(manifest.scenario_contract_profile || "").trim();
    if (profile === "hgo_vector") return true;
    const performanceHints = manifest.performance_hints && typeof manifest.performance_hints === "object"
      ? manifest.performance_hints
      : {};
    if (performanceHints.hgo_vector_scene_default === true) return true;
    return String(runtimeState?.activeScenarioId || "").trim() === "hgo_1936";
  }

  function getRiverClassKind(feature) {
    const props = feature?.properties || {};
    const featureClass = String(props.featurecla || props.FEATURECLA || "").trim().toLowerCase();
    switch (featureClass) {
      case "river":
        return "river";
      case "river (intermittent)":
        return "intermittent";
      case "lake centerline":
        return "lakeCenterline";
      case "canal":
        return "canal";
      default:
        return "unknown";
    }
  }

  function getRiverVisibilityProfile(feature, k) {
    const props = feature?.properties || {};
    const zoomBucket = getContextBaseZoomBucketId(k);
    const classKind = getRiverClassKind(feature);
    const scalerank = clamp(
      Math.round(Number(props.scalerank ?? props.SCALERANK ?? 8)) || 8,
      0,
      12,
    );
    const minZoom = Number(props.min_zoom ?? props.minZoom);
    let visible = false;

    if (zoomBucket === "low") {
      visible = classKind === "river" && scalerank <= RIVER_LOW_MAX_SCALERANK;
    } else if (zoomBucket === "mid") {
      visible = classKind === "river"
        && (
          scalerank <= RIVER_MID_MAX_SCALERANK
          || (
            scalerank === RIVER_MID_MAX_SCALERANK + 1
            && Number.isFinite(minZoom)
            && minZoom <= 5
          )
        );
    } else {
      visible = classKind !== "unknown";
    }

    const classStyle = RIVER_CLASS_STYLE_FACTORS[classKind] || RIVER_CLASS_STYLE_FACTORS.unknown;
    return {
      visible,
      zoomBucket,
      classKind,
      scalerank,
      minZoom: Number.isFinite(minZoom) ? minZoom : null,
      widthFactor: classStyle.widthFactor,
      opacityFactor: classStyle.opacityFactor,
      outlineFactor: classStyle.outlineFactor,
    };
  }

  function recordDeferredRiversLayerMetric({ interactive = false, reason = "staged-apply" } = {}) {
    collectContextMetric("drawRiversLayer", 0, {
      featureCount: getFeatureCollectionFeatureCount(runtimeState.riversData),
      interactive: !!interactive,
      skipped: true,
      reason,
    });
  }

  function drawRiversLayer(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    const context = getContext();
    const pathCanvas = getPathCanvas();
    const featureCount = getFeatureCollectionFeatureCount(runtimeState.riversData);
    if (isHgoVectorSceneActive()) {
      collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
        featureCount,
        interactive: !!interactive,
        skipped: true,
        reason: "hgo-vector-scene",
      });
      return;
    }
    if (!runtimeState.showRivers || !runtimeState.riversData?.features?.length || !context || !pathCanvas) {
      collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
        featureCount,
        interactive: !!interactive,
        skipped: true,
        reason: !runtimeState.showRivers
          ? "hidden"
          : !runtimeState.riversData?.features?.length
            ? "no-data"
            : !context
              ? "no-context"
              : "no-path",
      });
      return;
    }
    const cfg = runtimeState.styleConfig?.rivers || {};
    const color = getSafeCanvasColor(cfg.color, "#3b82f6");
    const opacity = clamp(Number.isFinite(Number(cfg.opacity)) ? Number(cfg.opacity) : 0.88, 0, 1);
    const widthBase = clamp(Number.isFinite(Number(cfg.width)) ? Number(cfg.width) : 0.5, 0.2, 4);
    const outlineColor = getSafeCanvasColor(cfg.outlineColor, "#e2efff");
    const outlineWidth = clamp(Number.isFinite(Number(cfg.outlineWidth)) ? Number(cfg.outlineWidth) : 0.25, 0, 3);
    const dashPattern = getDashPattern(cfg.dashStyle, widthBase);
    const scale = Math.max(0.0001, k);
    const resolvedDashPattern = dashPattern.map((value) => value / scale);
    const zoomStyle = getRiverZoomStyleFactors(k);
    const visibleEntries = [];

    runtimeState.riversData.features.forEach((feature) => {
      if (!pathBoundsInScreen(feature)) return;
      const profile = getRiverVisibilityProfile(feature, k);
      if (!profile.visible) return;
      visibleEntries.push({ feature, profile });
    });

    // Reuse projected geometry only inside this synchronous draw. The shared
    // d3 path must be restored before stroking or drawing another layer.
    function createStrokePath(feature) {
      if (typeof globalThis.Path2D !== "function" || typeof pathCanvas.context !== "function") return null;
      const previousContext = pathCanvas.context();
      if (!previousContext) return null;
      const path = new globalThis.Path2D();
      try {
        pathCanvas.context(path);
        if (pathCanvas.context() !== path) return null;
        pathCanvas(feature);
        return path;
      } finally {
        pathCanvas.context(previousContext);
      }
    }

    function strokeEntry(entry) {
      if (entry.path) {
        context.stroke(entry.path);
      } else {
        context.beginPath();
        pathCanvas(entry.feature);
        context.stroke();
      }
    }

    context.save();
    try {

      if (outlineWidth > 0) {
        context.strokeStyle = outlineColor;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.setLineDash(resolvedDashPattern);
        visibleEntries.forEach((entry) => {
          const { feature, profile } = entry;
          const resolvedOutlineWidth = outlineWidth
            * zoomStyle.outlineWidthFactor
            * profile.outlineFactor;
          if (!(resolvedOutlineWidth > 0)) return;
          const resolvedCoreWidth = widthBase
            * zoomStyle.coreWidthFactor
            * profile.widthFactor;
          const outlineAlpha = opacity
            * zoomStyle.outlineAlphaFactor
            * profile.opacityFactor;
          context.globalAlpha = interactive ? Math.min(outlineAlpha * 0.7, 0.65) : Math.min(outlineAlpha, 0.95);
          context.lineWidth = (resolvedCoreWidth + resolvedOutlineWidth * 2) / scale;
          entry.path = createStrokePath(feature);
          strokeEntry(entry);
        });
      }

      context.strokeStyle = color;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.setLineDash(resolvedDashPattern);
      visibleEntries.forEach((entry) => {
        const { profile } = entry;
        const resolvedCoreWidth = widthBase
          * zoomStyle.coreWidthFactor
          * profile.widthFactor;
        context.globalAlpha = interactive
          ? Math.min(opacity * profile.opacityFactor, 0.78)
          : opacity * profile.opacityFactor;
        context.lineWidth = resolvedCoreWidth / scale;
        strokeEntry(entry);
      });
      context.setLineDash([]);

    } finally {
      context.restore();
    }
    collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
      featureCount,
      visibleFeatureCount: visibleEntries.length,
      zoomBucket: getContextBaseZoomBucketId(k),
      coreWidthFactor: zoomStyle.coreWidthFactor,
      outlineWidthFactor: zoomStyle.outlineWidthFactor,
      outlineAlphaFactor: zoomStyle.outlineAlphaFactor,
      dashStyle: String(cfg.dashStyle || "solid"),
      dashPattern: resolvedDashPattern,
      interactive: !!interactive,
      skipped: false,
    });
  }

  return {
    drawRiversLayer,
    recordDeferredRiversLayerMetric,
  };
}
