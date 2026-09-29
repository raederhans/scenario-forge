import { claimScreenLabelPlacement } from "./screen_label_placement.js";

export function createPhysicalLayerRenderOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    PHYSICAL_ATLAS_PALETTE = {},
  } = constants;
  const {
    getContext = () => null,
    getPathCanvas = () => null,
    getProjection = () => null,
    getFillPath2D = null,
    // Optional contour-specific path cache. The renderer owns projection
    // generation and invalidation; this owner only consumes the replayable
    // Path2D when available and keeps the existing d3 path fallback.
    getContourPath2D = null,
  } = getters;
  const {
    applyPhysicalLandClipMask = () => false,
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    collectContextMetric = () => {},
    getAdaptiveContourStrokeColor = (_feature, baseColor) => baseColor,
    getAtlasFeatureAlphaMultiplier = () => 1,
    getContourVisibleFeatures = () => [],
    getContourZoomStyleProfile = () => ({}),
    getFeatureCollectionFeatureCount = (collection) => collection?.features?.length || 0,
    paintWithPhysicalIntensity = (_channel, blend, draw) => draw(blend),
    getPhysicalAtlasClass = () => "",
    getPhysicalAtlasLayer = () => "",
    getPhysicalLandMaskInfo = () => ({
      maskSource: "",
      maskFeatureCount: 0,
      maskArcRefEstimate: null,
    }),
    getPhysicalPresetRenderProfile = () => ({}),
    getPhysicalReliefOverlayBlendMode = (_cfg, presetProfile) => presetProfile?.reliefBlendFallback || "source-over",
    getResolvedPhysicalAtlasCollection = () => null,
    getSafeBlendMode = (value, fallback) => value || fallback,
    getSafeCanvasColor = (value, fallback) => value || fallback,
    normalizePhysicalStyleConfig = (config) => config || {},
    nowMs = () => Date.now(),
    pathBoundsInScreen = () => true,
    shouldReportDeferredContextLayerGap = () => false,
    warnMissingPhysicalContextOnce = () => {},
  } = helpers;

  function drawPhysicalAtlasCollectionLayer(
    atlasCollection, layerName, cfg, options = {}
  ) {
    return paintWithPhysicalIntensity("physicalAtlas", options.blendMode || "source-over", (blendMode) =>
      drawPhysicalAtlasCollectionUnmasked(atlasCollection, layerName, cfg, { ...options, blendMode }));
  }

  function drawPhysicalAtlasCollectionUnmasked(
    atlasCollection,
    layerName,
    cfg,
    {
      baseOpacity = 1,
      blendMode = "source-over",
      clipAlreadyApplied = false,
    } = {}
  ) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas || !Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
      return 0;
    }
    let renderedCount = 0;
    context.save();
    if (!clipAlreadyApplied) {
      applyPhysicalLandClipMask();
    }
    context.globalCompositeOperation = blendMode;
    atlasCollection.features.forEach((feature) => {
      const atlasClass = getPhysicalAtlasClass(feature);
      if (!atlasClass || cfg.atlasClassVisibility?.[atlasClass] === false) return;
      if (getPhysicalAtlasLayer(feature) !== layerName) return;
      if (!pathBoundsInScreen(feature)) return;
      const fillColor = getSafeCanvasColor(PHYSICAL_ATLAS_PALETTE[atlasClass], null);
      if (!fillColor) return;
      context.globalAlpha = clamp(
        baseOpacity * getAtlasFeatureAlphaMultiplier(atlasClass, cfg),
        0,
        1
      );
      if (context.globalAlpha === 0) return;
      context.fillStyle = fillColor;
      const fillPath = getFillPath2D?.(feature);
      if (fillPath) context.fill(fillPath);
      else {
        context.beginPath();
        pathCanvas(feature);
        context.fill();
      }
      renderedCount += 1;
    });
    context.restore();
    return renderedCount;
  }

  function drawPhysicalReliefOverlayLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
    const startedAt = nowMs();
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    const presetProfile = getPhysicalPresetRenderProfile(cfg);
    const maskInfo = getPhysicalLandMaskInfo();
    if (!runtimeState.showPhysical || cfg.mode === "contours_only") {
      collectContextMetric("drawPhysicalReliefOverlayLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: !runtimeState.showPhysical ? "hidden" : "contours-only",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return 0;
    }

    const atlasCollection = getResolvedPhysicalAtlasCollection();
    if (!Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
      collectContextMetric("drawPhysicalReliefOverlayLayer", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: "no-data",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return 0;
    }

    const baseReliefOpacity = clamp(
      cfg.opacity
        * cfg.atlasOpacity
        * (interactive ? 0.7 : 1)
        * cfg.atlasIntensity
        * (cfg.landformIntensity ?? 1)
        * presetProfile.reliefOpacityMultiplier,
      0,
      1
    );
    const overlayOpacity = clamp(
      baseReliefOpacity * Number(presetProfile.reliefOverlayOpacityRatio || 0),
      0,
      Number(presetProfile.reliefOverlayOpacityCap ?? 1)
    );
    const renderedCount = drawPhysicalAtlasCollectionLayer(atlasCollection, "relief_base", cfg, {
      baseOpacity: overlayOpacity,
      blendMode: getPhysicalReliefOverlayBlendMode(cfg, presetProfile),
      clipAlreadyApplied,
    });
    collectContextMetric("drawPhysicalReliefOverlayLayer", nowMs() - startedAt, {
      featureCount: atlasCollection.features.length,
      renderedCount,
      interactive: !!interactive,
      skipped: renderedCount === 0,
      reason: renderedCount === 0 ? "no-relief-overlay" : "",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return renderedCount;
  }

  function drawPhysicalBasePass(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    const maskInfo = getPhysicalLandMaskInfo();
    if (!runtimeState.showPhysical || cfg.mode === "contours_only") {
      collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: !runtimeState.showPhysical ? "hidden" : "contours-only",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return;
    }

    const atlasCollection = getResolvedPhysicalAtlasCollection();
    if (!Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
      collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
        featureCount: 0,
        renderedCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: "no-data",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return;
    }

    const semanticRenderedCount = drawPhysicalAtlasLayer(k, { interactive });
    const reliefRenderedCount = drawPhysicalReliefOverlayLayer(k, { interactive });
    const renderedCount = semanticRenderedCount + reliefRenderedCount;
    collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
      featureCount: atlasCollection.features.length,
      renderedCount,
      semanticRenderedCount,
      reliefRenderedCount,
      interactive: !!interactive,
      skipped: renderedCount === 0,
      reason: renderedCount === 0 ? "no-physical-underlay" : "",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
  }

  function drawPhysicalAtlasLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
    const startedAt = nowMs();
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    const presetProfile = getPhysicalPresetRenderProfile(cfg);
    const maskInfo = getPhysicalLandMaskInfo();
    if (!runtimeState.showPhysical || cfg.mode === "contours_only") {
      collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
        featureCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: !runtimeState.showPhysical ? "hidden" : "contours-only",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return 0;
    }

    const atlasCollection = getResolvedPhysicalAtlasCollection();
    if (!Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
      if (shouldReportDeferredContextLayerGap("physical_semantics")) {
        warnMissingPhysicalContextOnce(
          "physical-atlas-missing",
          "[physical] Atlas semantics unavailable; skipping physical atlas fill."
        );
      }
      collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
        featureCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: shouldReportDeferredContextLayerGap("physical_semantics") ? "no-data" : "pending-deferred-context",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return 0;
    }
    const renderedCount = drawPhysicalAtlasCollectionLayer(atlasCollection, "semantic_overlay", cfg, {
      baseOpacity: clamp(
        cfg.opacity * cfg.atlasOpacity * (interactive ? 0.7 : 1) * cfg.atlasIntensity * (cfg.landcoverIntensity ?? 1) * presetProfile.semanticOpacityMultiplier,
        0,
        1
      ),
      blendMode: getSafeBlendMode(cfg.blendMode, presetProfile.semanticBlendMode),
      clipAlreadyApplied,
    });
    collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
      featureCount: atlasCollection.features.length,
      renderedCount,
      interactive: !!interactive,
      skipped: renderedCount === 0,
      reason: renderedCount === 0 ? "no-semantic-overlay" : "",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return renderedCount;
  }

  function drawContourCollection(
    collection,
    {
      cacheSlot = "major",
      color,
      colorResolver = null,
      opacity,
      width,
      k,
      interactive = false,
      lowReliefCutoff = 0,
      intervalM = 0,
      excludeIntervalM = 0,
      minScreenSpanPx = 0,
      maxFeatures = 0,
      opacityMultiplierResolver = null,
    } = {}
  ) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas || !Array.isArray(collection?.features) || collection.features.length === 0) {
      return { drewAny: false, renderedCount: 0, selectedCount: 0 };
    }
    const selectionStartedAt = nowMs();
    const visibleFeatures = getContourVisibleFeatures(collection, {
      cacheSlot,
      k,
      lowReliefCutoff,
      intervalM,
      excludeIntervalM,
      minScreenSpanPx,
      maxFeatures,
    });
    const selectionMs = nowMs() - selectionStartedAt;
    let pathBuildMs = 0;
    let strokeMs = 0;
    if (!visibleFeatures.length) {
      collectContextMetric(`drawContourCollection:${cacheSlot}`, selectionMs, {
        cacheSlot, selectionMs, styleMs: 0, pathBuildMs, strokeMs,
        selectedCount: 0, renderedCount: 0,
      });
      return { drewAny: false, renderedCount: 0, selectedCount: 0 };
    }
    const styleStartedAt = nowMs();
    const scale = Math.max(0.0001, k);
    context.globalAlpha = interactive ? Math.min(opacity, 0.22) : opacity;
    context.strokeStyle = color;
    context.lineWidth = width / scale;
    context.lineJoin = "round";
    context.lineCap = "round";

    const strokeBatches = new Map();
    visibleFeatures.forEach((feature) => {
      const strokeColor = typeof colorResolver === "function"
        ? getSafeCanvasColor(colorResolver(feature), color)
        : color;
      if (!strokeColor) return;
      const rawMultiplier = typeof opacityMultiplierResolver === "function"
        ? opacityMultiplierResolver(feature)
        : 1;
      const numericMultiplier = Number(rawMultiplier);
      const multiplier = clamp(Math.round((Number.isFinite(numericMultiplier) ? numericMultiplier : 1) / 0.05) * 0.05, 0, 2);
      if (multiplier <= 0) return;
      const batchKey = `${strokeColor}|${multiplier.toFixed(2)}`;
      if (!strokeBatches.has(batchKey)) {
        strokeBatches.set(batchKey, {
          strokeColor,
          multiplier,
          features: [],
        });
      }
      strokeBatches.get(batchKey).features.push(feature);
    });

    const styleMs = nowMs() - styleStartedAt;
    let drewAny = false;
    let renderedCount = 0;
    strokeBatches.forEach(({ features, strokeColor, multiplier }) => {
      if (!Array.isArray(features) || !features.length) return;
      context.strokeStyle = strokeColor;
      context.globalAlpha = clamp((interactive ? Math.min(opacity, 0.22) : opacity) * multiplier, 0, 1);
      const pathBuildStartedAt = nowMs();
      const canAggregate = typeof getContourPath2D === "function"
        && typeof globalThis.Path2D === "function"
        && typeof globalThis.Path2D.prototype?.addPath === "function";
      if (canAggregate) {
        const aggregate = new globalThis.Path2D();
        const cachedPaths = features.map((feature) => getContourPath2D(feature, { cacheSlot, k }));
        if (cachedPaths.every((path) => path)) {
          cachedPaths.forEach((path) => aggregate.addPath(path));
          pathBuildMs += nowMs() - pathBuildStartedAt;
          const strokeStartedAt = nowMs();
          context.stroke(aggregate);
          strokeMs += nowMs() - strokeStartedAt;
          drewAny = true;
          renderedCount += features.length;
          return;
        }
      }
      // Keep the original one-batch Canvas behavior whenever Path2D
      // aggregation is unavailable or partially populated.
      context.beginPath();
      features.forEach((feature) => {
        pathCanvas(feature);
      });
      pathBuildMs += nowMs() - pathBuildStartedAt;
      const strokeStartedAt = nowMs();
      context.stroke();
      strokeMs += nowMs() - strokeStartedAt;
      drewAny = true;
      renderedCount += features.length;
    });
    collectContextMetric(`drawContourCollection:${cacheSlot}`, selectionMs + styleMs + pathBuildMs + strokeMs, {
      cacheSlot, selectionMs, styleMs, pathBuildMs, strokeMs,
      selectedCount: visibleFeatures.length, renderedCount,
    });
    return {
      drewAny,
      renderedCount,
      selectedCount: visibleFeatures.length,
    };
  }

  function drawPhysicalHillshadeLayer(k) {
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    if (!runtimeState.showPhysical || cfg.mode === "contours_only" || !cfg.hillshadeOpacity || k < 4) return 0;
    const features = runtimeState.contextLayerExternalDataByName?.physical_hillshade?.features;
    if (!features?.length) return 0;
    return paintWithPhysicalIntensity("physicalAtlas", "source-over", () => {
      const context = getContext();
      const path = getPathCanvas();
      if (!context || !path) return 0;
      let count = 0;
      context.save();
      applyPhysicalLandClipMask();
      context.globalCompositeOperation = "source-over";
      for (const feature of features) {
        if (!pathBoundsInScreen(feature)) continue;
        const shade = Number(feature.properties?.shade || 0);
        context.fillStyle = shade > 0 ? "#ffffff" : "#26313a";
        context.globalAlpha = cfg.opacity * cfg.hillshadeOpacity * Math.abs(shade) * (cfg.landformIntensity ?? 1);
        const fillPath = getFillPath2D?.(feature);
        if (fillPath) context.fill(fillPath);
        else { context.beginPath(); path(feature); context.fill(); }
        count += 1;
      }
      context.restore();
      return count;
    });
  }

  function drawPhysicalRegionLabels(k, { occupiedBoxes = [] } = {}) {
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    if (!runtimeState.showPhysical || !cfg.showRegionLabels || cfg.mode === "contours_only" || k < 2) return 0;
    const features = runtimeState.contextLayerExternalDataByName?.physical_region_labels?.features || [];
    const context = getContext();
    const projection = getProjection();
    if (!context || !projection) return 0;
    let count = 0;
    const transform = runtimeState.zoomTransform || { x: 0, y: 0, k };
    const maxRank = Math.max(1, Math.floor(Math.log2(k)) + 1);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 0.8;
    context.font = `400 ${11.5 / k}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 1.6 / k;
    context.strokeStyle = "rgba(255,255,255,0.85)";
    context.fillStyle = "#405048";
    for (const feature of features) {
      const props = feature.properties || {};
      if (k < props.min_zoom || Number(props.rank || 1) > maxRank || cfg.atlasClassVisibility?.[props.atlas_class] === false || !pathBoundsInScreen(feature)) continue;
      const position = projection(feature.geometry.coordinates);
      if (!position?.every(Number.isFinite)) continue;
      const text = runtimeState.currentLanguage === "zh" ? props.name_zh || props.name_en : props.name_en;
      if (!text) continue;
      const width = context.measureText(text).width * k + 18;
      const box = { x: position[0] * k + transform.x - width / 2, y: position[1] * k + transform.y - 13, w: width, h: 26 };
      if (!claimScreenLabelPlacement([{ box }], occupiedBoxes)) continue;
      context.strokeText(text, ...position); context.fillText(text, ...position);
      count += 1;
      if (count >= 50) break;
    }
    context.restore();
    return count;
  }

  function drawPhysicalContourLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
    return paintWithPhysicalIntensity("physicalContour", "source-over", () =>
      drawPhysicalContourLayerUnmasked(k, { interactive, clipAlreadyApplied }));
  }

  function drawPhysicalContourLayerUnmasked(k, { interactive = false, clipAlreadyApplied = false } = {}) {
    const startedAt = nowMs();
    const cfg = normalizePhysicalStyleConfig(runtimeState.styleConfig?.physical);
    const presetProfile = getPhysicalPresetRenderProfile(cfg);
    const zoomProfile = getContourZoomStyleProfile(k);
    const maskInfo = getPhysicalLandMaskInfo();
    if (!runtimeState.showPhysical || cfg.mode === "atlas_only") {
      collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
        featureCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: !runtimeState.showPhysical ? "hidden" : "atlas-only",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return;
    }

    if (!Array.isArray(runtimeState.physicalContourMajorData?.features) || runtimeState.physicalContourMajorData.features.length === 0) {
      if (shouldReportDeferredContextLayerGap("physical_contours_major")) {
        warnMissingPhysicalContextOnce(
          "physical-contours-major-missing",
          "[physical] global_contours.major.topo.json unavailable or deferred; skipping terrain contours."
        );
      }
      collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
        featureCount: 0,
        majorFeatureCount: 0,
        minorFeatureCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: shouldReportDeferredContextLayerGap("physical_contours_major") ? "no-data" : "pending-deferred-context",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      return;
    }

    const contourColor = getSafeCanvasColor(cfg.contourColor, "#6b5947");
    const majorLowReliefCutoff = clamp(Number(cfg.contourMajorLowReliefCutoffM) || 0, 0, 2000);
    const minorLowReliefCutoff = clamp(Number(cfg.contourMinorLowReliefCutoffM) || 0, 0, 2000);
    const majorOpacity = clamp(
      cfg.opacity * cfg.contourOpacity * presetProfile.majorContourOpacityMultiplier * zoomProfile.majorOpacityMultiplier,
      0,
      1
    );
    const minorOpacity = clamp(
      majorOpacity * presetProfile.minorContourOpacityRatio * zoomProfile.minorOpacityMultiplier,
      0,
      1
    );
    const resolveContourColor = (feature) => getAdaptiveContourStrokeColor(feature, contourColor);
    const majorInterval = clamp(
      (clamp(Number(cfg.contourMajorIntervalM) || 500, 500, 2000) * zoomProfile.majorIntervalMultiplier),
      500,
      6000,
    );
    const minorInterval = clamp(
      (clamp(Number(cfg.contourMinorIntervalM) || 100, 100, 1000) * zoomProfile.minorIntervalMultiplier),
      100,
      3000,
    );

    const context = getContext();
    if (!context) return;
    context.save();
    if (!clipAlreadyApplied) {
      applyPhysicalLandClipMask();
    }
    context.globalCompositeOperation = "source-over";

    const majorDrawResult = drawContourCollection(runtimeState.physicalContourMajorData, {
      cacheSlot: "major",
      color: contourColor,
      colorResolver: resolveContourColor,
      opacity: majorOpacity,
      width: clamp((Number(cfg.contourMajorWidth) || 0.8) * zoomProfile.majorWidthMultiplier, 0.2, 3),
      k,
      interactive,
      lowReliefCutoff: majorLowReliefCutoff,
      intervalM: majorInterval,
      minScreenSpanPx: zoomProfile.majorMinScreenSpanPx,
    });

    let minorDrawResult = { renderedCount: 0, selectedCount: 0 };
    if (cfg.contourMinorVisible && zoomProfile.minorVisible && k >= presetProfile.minorContourMinZoom) {
      if (Array.isArray(runtimeState.physicalContourMinorData?.features) && runtimeState.physicalContourMinorData.features.length > 0) {
        const dynamicMinorMaxFeatures = clamp(
          Math.round(
            Number(zoomProfile.minorMaxFeaturesBase || 0)
            + Number(majorDrawResult?.selectedCount || 0) * Number(zoomProfile.minorMaxFeaturesPerMajor || 0)
          ),
          0,
          Number(zoomProfile.minorMaxFeaturesHardCap || 0) || 100000
        );
        minorDrawResult = drawContourCollection(runtimeState.physicalContourMinorData, {
          cacheSlot: "minor",
          color: contourColor,
          colorResolver: resolveContourColor,
          opacity: minorOpacity,
          width: clamp((Number(cfg.contourMinorWidth) || 0.45) * zoomProfile.minorWidthMultiplier, 0.1, 2),
          k,
          interactive,
          lowReliefCutoff: minorLowReliefCutoff,
          intervalM: minorInterval,
          excludeIntervalM: majorInterval,
          minScreenSpanPx: zoomProfile.minorMinScreenSpanPx,
          maxFeatures: dynamicMinorMaxFeatures,
        });
      } else {
        if (shouldReportDeferredContextLayerGap("physical_contours_minor")) {
          warnMissingPhysicalContextOnce(
            "physical-contours-minor-missing",
            "[physical] global_contours.minor.topo.json unavailable or deferred; skipping minor contours."
          );
        }
      }
    }

    context.restore();
    collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
      featureCount:
        getFeatureCollectionFeatureCount(runtimeState.physicalContourMajorData)
        + getFeatureCollectionFeatureCount(runtimeState.physicalContourMinorData),
      majorFeatureCount: getFeatureCollectionFeatureCount(runtimeState.physicalContourMajorData),
      minorFeatureCount: getFeatureCollectionFeatureCount(runtimeState.physicalContourMinorData),
      majorSelectedCount: Number(majorDrawResult?.selectedCount || 0),
      majorRenderedCount: Number(majorDrawResult?.renderedCount || 0),
      minorSelectedCount: Number(minorDrawResult?.selectedCount || 0),
      minorRenderedCount: Number(minorDrawResult?.renderedCount || 0),
      interactive: !!interactive,
      skipped: false,
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
  }

  return {
    drawContourCollection,
    drawPhysicalAtlasCollectionLayer,
    drawPhysicalAtlasLayer,
    drawPhysicalBasePass,
    drawPhysicalContourLayer,
    drawPhysicalReliefOverlayLayer,
    drawPhysicalHillshadeLayer,
    drawPhysicalRegionLabels,
  };
}
