export function createScenarioReliefOverlayRenderOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
  scenarioLayerCache,
} = {}) {
  const runtimeState = state;
  const {
    RELIEF_ATLANTROPA_CONTOUR_COLOR = "rgba(148, 163, 184, 0.18)",
    RELIEF_ATLANTROPA_SALT_FILL_COLOR = "rgba(0, 0, 0, 0)",
    RELIEF_ATLANTROPA_SALT_STROKE_COLOR = "rgba(148, 163, 184, 0.22)",
    RELIEF_ATLANTROPA_SHORELINE_COLOR = "rgba(148, 163, 184, 0.36)",
    RELIEF_CONTOUR_COLOR = "rgba(176, 148, 103, 0.6)",
    RELIEF_DAM_APPROACH_COLOR = "rgba(102, 86, 62, 0.8)",
    RELIEF_LAKE_SHORELINE_COLOR = "rgba(214, 232, 244, 0.92)",
    RELIEF_SALT_FILL_COLOR = "rgba(222, 203, 170, 0.22)",
    RELIEF_SALT_STROKE_COLOR = "rgba(128, 100, 63, 0.55)",
    RELIEF_SHORELINE_COLOR = "rgba(109, 84, 50, 0.78)",
    RELIEF_SWAMP_FILL_COLOR = "rgba(128, 150, 114, 0.28)",
    RELIEF_SWAMP_STROKE_COLOR = "rgba(88, 108, 76, 0.68)",
    RENDER_PHASE_INTERACTING = "interacting",
    RENDER_PHASE_SETTLING = "settling",
  } = constants;
  const {
    getContext = () => null,
    getPathCanvas = () => null,
  } = getters;
  const {
    cloneZoomTransform,
    shouldEnableContextScenarioTransformReuse,
    collectContextMetric = () => {},
    getEffectiveScenarioReliefOverlayFeatures = () => [],
    getPathBounds = () => null,
    getReliefOverlayKind = () => "",
    getScenarioReliefVisualRevisionToken = () => "",
    isAtlantropaReliefOverlayFeature = () => false,
    isReliefOverlayEnabled = () => false,
    isScenarioCoastalAccentEnabled = () => false,
    nowMs = () => Date.now(),
    pathBoundsInScreen = () => true,
  } = helpers;

  function getReliefOverlayStyle(feature) {
    const kind = getReliefOverlayKind(feature);
    const isAtlantropaRelief = isAtlantropaReliefOverlayFeature(feature);
    switch (kind) {
      case "salt_flat_texture":
        if (isAtlantropaRelief) {
          return {
            fill: RELIEF_ATLANTROPA_SALT_FILL_COLOR,
            stroke: RELIEF_ATLANTROPA_SALT_STROKE_COLOR,
            lineWidth: 0.55,
            fillAlpha: 1,
          };
        }
        return {
          fill: RELIEF_SALT_FILL_COLOR,
          stroke: RELIEF_SALT_STROKE_COLOR,
          lineWidth: 0.7,
          fillAlpha: 1,
        };
      case "new_shoreline":
        return {
          fill: null,
          stroke: isAtlantropaRelief ? RELIEF_ATLANTROPA_SHORELINE_COLOR : RELIEF_SHORELINE_COLOR,
          lineWidth: isAtlantropaRelief ? 1.1 : 1.35,
        };
      case "drained_basin_contour":
        return {
          fill: null,
          stroke: isAtlantropaRelief ? RELIEF_ATLANTROPA_CONTOUR_COLOR : RELIEF_CONTOUR_COLOR,
          lineWidth: isAtlantropaRelief ? 0.8 : 1,
        };
      case "swamp_margin":
        return {
          fill: RELIEF_SWAMP_FILL_COLOR,
          stroke: RELIEF_SWAMP_STROKE_COLOR,
          lineWidth: 0.8,
          fillAlpha: 1,
        };
      case "lake_shoreline":
        return {
          fill: null,
          stroke: RELIEF_LAKE_SHORELINE_COLOR,
          lineWidth: 1.4,
        };
      case "dam_approach":
        return {
          fill: null,
          stroke: RELIEF_DAM_APPROACH_COLOR,
          lineWidth: 1.1,
        };
      default:
        return {
          fill: null,
          stroke: RELIEF_SALT_STROKE_COLOR,
          lineWidth: 1,
        };
    }
  }

  function drawPolygonLinePattern(bounds, {
    color = RELIEF_SALT_STROKE_COLOR,
    spacing = 10,
    angleDeg = -18,
    lineWidth = 0.6,
    alpha = 0.45,
  } = {}) {
    const context = getContext();
    if (!context || !bounds) return;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (!(width > 0 && height > 0)) return;
    const diagonal = Math.sqrt(width * width + height * height);
    const radians = angleDeg * (Math.PI / 180);
    const dx = Math.cos(radians);
    const dy = Math.sin(radians);
    const nx = -dy;
    const ny = dx;
    const centerX = (bounds.minX + bounds.maxX) * 0.5;
    const centerY = (bounds.minY + bounds.maxY) * 0.5;
    const extent = diagonal * 0.9;
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    for (let offset = -extent; offset <= extent; offset += Math.max(4, spacing)) {
      const startX = centerX + nx * offset - dx * diagonal;
      const startY = centerY + ny * offset - dy * diagonal;
      const endX = centerX + nx * offset + dx * diagonal;
      const endY = centerY + ny * offset + dy * diagonal;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
    }
    context.restore();
  }

  function recordReliefSkip(startedAt, overlays, reason, cacheMode, durationMs = 0) {
    collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
      featureCount: overlays.length,
      renderedCount: 0,
      skipped: true,
      reason,
    });
    collectContextMetric("contextScenarioLayerRelief", durationMs, {
      featureCount: overlays.length,
      renderedCount: 0,
      skipped: true,
      reason,
      cacheMode,
      signature: getScenarioReliefVisualRevisionToken(),
    });
  }

  function drawScenarioReliefOverlaysLayer(k, {
    reliefFeatures = null,
    cacheMode = "direct",
  } = {}) {
    const startedAt = nowMs();
    const context = getContext();
    const pathCanvas = getPathCanvas();
    const overlays = Array.isArray(reliefFeatures)
      ? reliefFeatures
      : getEffectiveScenarioReliefOverlayFeatures();
    if (!overlays.length) {
      recordReliefSkip(startedAt, overlays, "no-overlays", cacheMode);
      return 0;
    }
    if (!runtimeState.showScenarioReliefOverlays) {
      recordReliefSkip(startedAt, overlays, "disabled", cacheMode);
      return 0;
    }
    if (runtimeState.renderPhase === RENDER_PHASE_INTERACTING || runtimeState.renderPhase === RENDER_PHASE_SETTLING) {
      recordReliefSkip(startedAt, overlays, runtimeState.renderPhase, cacheMode);
      return 0;
    }
    if (!context || !pathCanvas) {
      recordReliefSkip(startedAt, overlays, "no-context", cacheMode);
      return 0;
    }

    let renderedCount = 0;
    overlays.forEach((feature) => {
      if (!isReliefOverlayEnabled(feature)) return;
      if (!pathBoundsInScreen(feature)) return;
      const style = getReliefOverlayStyle(feature);
      const kind = getReliefOverlayKind(feature);
      if (
        (kind === "new_shoreline" || kind === "lake_shoreline")
        && isScenarioCoastalAccentEnabled()
      ) {
        return;
      }
      const bounds = getPathBounds(feature);
      if (!bounds) return;
      const geometryType = String(feature?.geometry?.type || "").trim();
      if ((geometryType === "Polygon" || geometryType === "MultiPolygon") && style.fill) {
        context.beginPath();
        pathCanvas(feature);
        context.save();
        context.globalAlpha = style.fillAlpha ?? 1;
        context.fillStyle = style.fill;
        context.fill();
        context.clip();
        if (kind === "salt_flat_texture") {
          drawPolygonLinePattern(bounds, {
            color: style.stroke,
            spacing: 11 / Math.max(0.3, Math.min(4, k)),
            angleDeg: -16,
            lineWidth: (style.lineWidth || 0.7) / Math.max(0.0001, k),
            alpha: 0.55,
          });
          drawPolygonLinePattern(bounds, {
            color: style.stroke,
            spacing: 19 / Math.max(0.3, Math.min(4, k)),
            angleDeg: 12,
            lineWidth: 0.45 / Math.max(0.0001, k),
            alpha: 0.25,
          });
        } else if (kind === "swamp_margin") {
          drawPolygonLinePattern(bounds, {
            color: style.stroke,
            spacing: 8 / Math.max(0.3, Math.min(4, k)),
            angleDeg: 82,
            lineWidth: 0.5 / Math.max(0.0001, k),
            alpha: 0.4,
          });
          drawPolygonLinePattern(bounds, {
            color: "rgba(90, 140, 180, 0.8)",
            spacing: 14 / Math.max(0.3, Math.min(4, k)),
            angleDeg: 0,
            lineWidth: 0.35 / Math.max(0.0001, k),
            alpha: 0.22,
          });
        }
        context.restore();
      }
      context.beginPath();
      pathCanvas(feature);
      context.save();
      if (kind === "dam_approach") {
        context.setLineDash([3 / Math.max(0.0001, k), 2 / Math.max(0.0001, k)]);
      }
      context.strokeStyle = style.stroke;
      context.lineWidth = (style.lineWidth || 1) / Math.max(0.0001, k);
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
      context.restore();
      renderedCount += 1;
    });
    collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
      featureCount: overlays.length,
      renderedCount,
      skipped: false,
      phase: runtimeState.renderPhase,
    });
    collectContextMetric("contextScenarioLayerRelief", 0, {
      featureCount: overlays.length,
      renderedCount,
      skipped: false,
      cacheMode,
      signature: getScenarioReliefVisualRevisionToken(),
    });
    return renderedCount;
  }

  function renderScenarioReliefOverlaysLayerToCache(currentTransform, reliefFeatures) {
    return scenarioLayerCache.render("relief", currentTransform, {
      draw: (layerK) => drawScenarioReliefOverlaysLayer(layerK, { reliefFeatures, cacheMode: "redraw" }),
      getSignature: getScenarioReliefVisualRevisionToken,
    });
  }

  function drawScenarioReliefOverlaysPass(k) {
    const overlays = getEffectiveScenarioReliefOverlayFeatures();
    if (
      !overlays.length
      || !runtimeState.showScenarioReliefOverlays
      || runtimeState.renderPhase === RENDER_PHASE_INTERACTING
      || runtimeState.renderPhase === RENDER_PHASE_SETTLING
    ) {
      drawScenarioReliefOverlaysLayer(k, { reliefFeatures: overlays, cacheMode: "direct" });
      return;
    }

    const currentTransform = cloneZoomTransform(runtimeState.zoomTransform || globalThis.d3?.zoomIdentity);
    const reliefLayerEntry = scenarioLayerCache.getSnapshot("relief");
    const reliefVisualRevision = getScenarioReliefVisualRevisionToken();
    const canReuseReliefLayer = (
      shouldEnableContextScenarioTransformReuse()
      && reliefLayerEntry.signature === reliefVisualRevision
      && reliefLayerEntry.hasCanvas
      && reliefLayerEntry.hasReferenceTransform
    );
    if (canReuseReliefLayer && scenarioLayerCache.draw("relief", currentTransform)) {
      const renderedCount = Number(reliefLayerEntry.renderedCount || 0);
      collectContextMetric("contextScenarioLayerCacheHit", 0, {
        layer: "relief",
        renderedCount,
      });
      collectContextMetric("contextScenarioLayerRelief", 0, {
        featureCount: overlays.length,
        renderedCount,
        skipped: false,
        cacheMode: "reuse",
        signature: reliefVisualRevision,
      });
      return;
    }

    collectContextMetric("contextScenarioLayerCacheMiss", 0, {
      layer: "relief",
      reason: reliefLayerEntry.signature === reliefVisualRevision ? "transform" : "signature",
      signatureChanged: reliefLayerEntry.signature !== reliefVisualRevision,
    });
    renderScenarioReliefOverlaysLayerToCache(currentTransform, overlays);
    if (!scenarioLayerCache.draw("relief", currentTransform)) {
      drawScenarioReliefOverlaysLayer(k, { reliefFeatures: overlays, cacheMode: "direct" });
    }
  }

  return {
    drawScenarioReliefOverlaysPass,
    drawPolygonLinePattern,
    drawScenarioReliefOverlaysLayer,
  };
}
