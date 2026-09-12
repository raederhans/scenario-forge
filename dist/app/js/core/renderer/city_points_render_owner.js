const DEFAULT_ZOOM_IDENTITY = Object.freeze({ x: 0, y: 0, k: 1 });
const CITY_MARKER_SPRITE_CACHE_LIMIT = 256;

export function createCityPointsRenderOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const runtimeState = state;
  const {
    cityMarkerSizeLimitsPx = {},
    cityMarkerThemeGraphite = "classic_graphite",
    cityRevealProfileHybrid = "hybrid_country_budget",
  } = constants;
  const {
    buildCityRevealPlan = () => ({ markerEntries: [], labelEntries: [] }),
    clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
    collectContextMetric = () => {},
    drawCityLabelsFromEntries = () => 0,
    getCityMarkerRenderStyle = () => ({}),
    getCityMarkerSizePx = () => 0,
    getCityTooltipText = () => "",
    getCityVisualCapitalState = (entry) => !!entry?.isCapital,
    getEffectiveCityCollection = () => null,
    getHoverEntryHitPriority = () => 0,
    getPointer = () => null,
    getZoomIdentity = () => DEFAULT_ZOOM_IDENTITY,
    getFeatureCollectionFeatureCount = (collection) => (
      Array.isArray(collection?.features) ? collection.features.length : 0
    ),
    isCityEntryEligibleForLandHit = () => false,
    normalizeCityLayerStyleConfig = (config) => config || {},
    nowMs = () => Date.now(),
    recordInteractionDurationMetric = () => {},
    recordRenderPerfMetric = () => {},
  } = helpers;
  const {
    getContext = () => null,
    getMapSvg = () => null,
    getProjection = () => null,
  } = getters;

  const cityMarkerSpriteCache = new Map();
  let visibleCityHoverEntries = [];
  let context = null;
  let projection = null;
  let mapSvg = null;

  function syncRenderTargets() {
    context = getContext();
    projection = getProjection();
    mapSvg = getMapSvg();
  }

  function createCityMarkerSpriteCanvas(width, height) {
    if (typeof OffscreenCanvas === "function") {
      return new OffscreenCanvas(width, height);
    }
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    return null;
  }

  function getCityMarkerVisualSpec(entry, config = {}) {
    const sizePx = Math.max(4, Number(entry?.markerSizePx || getCityMarkerSizePx(entry, config)));
    const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
    const tierScale = cityTier === "major" ? 1.18 : cityTier === "regional" ? 1 : 0.84;
    const discRadius = Math.max(3.2, sizePx * (cityTier === "major" ? 0.62 : cityTier === "regional" ? 0.56 : 0.5));
    const discHeight = Math.max(3.4, sizePx * (cityTier === "major" ? 0.66 : cityTier === "regional" ? 0.58 : 0.5));
    const widthPx = Math.max(18, Math.ceil(discRadius * 2.8 * tierScale));
    const heightPx = Math.max(16, Math.ceil((discHeight * 1.9) + (sizePx * 0.34)));
    const capitalTopExtra = entry?.isCapital ? Math.ceil(sizePx * 0.86) : 0;
    return {
      sizePx,
      cityTier,
      discRadius,
      discHeight,
      widthPx,
      heightPx,
      capitalTopExtra,
    };
  }

  function renderCityMarkerSprite(spriteContext, spec, tokens, entry) {
    const { sizePx, discRadius, discHeight, widthPx, heightPx, capitalTopExtra } = spec;
    const cx = widthPx / 2;
    const centerY = capitalTopExtra + Math.max(discHeight + (sizePx * 0.26), (heightPx * 0.56));
    const topY = centerY - discHeight;
    const bottomY = centerY + discHeight;
    const baseShadowY = centerY + (discHeight * 0.78);
    const bodyGradient = spriteContext.createLinearGradient(0, topY, 0, bottomY);
    bodyGradient.addColorStop(0, tokens.fillTop);
    bodyGradient.addColorStop(0.55, tokens.fillMid || tokens.fillTop);
    bodyGradient.addColorStop(1, tokens.fillBottom);

    spriteContext.save();
    spriteContext.lineJoin = "round";
    spriteContext.lineCap = "round";

    spriteContext.beginPath();
    spriteContext.ellipse(cx, baseShadowY, discRadius * 0.98, Math.max(1.5, discHeight * 0.46), 0, 0, Math.PI * 2);
    spriteContext.fillStyle = tokens.baseShadow;
    spriteContext.fill();

    spriteContext.beginPath();
    spriteContext.ellipse(cx, centerY, discRadius, discHeight, 0, 0, Math.PI * 2);
    spriteContext.fillStyle = bodyGradient;
    spriteContext.fill();
    spriteContext.strokeStyle = tokens.stroke;
    spriteContext.lineWidth = Math.max(1, sizePx * 0.08);
    spriteContext.stroke();

    spriteContext.save();
    spriteContext.globalCompositeOperation = "multiply";
    const rimGradient = spriteContext.createLinearGradient(cx, centerY - discHeight, cx, centerY + discHeight);
    rimGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    rimGradient.addColorStop(0.58, "rgba(0, 0, 0, 0)");
    rimGradient.addColorStop(1, tokens.rimDark || tokens.fillBottom);
    spriteContext.beginPath();
    spriteContext.ellipse(cx, centerY, discRadius, discHeight, 0, 0, Math.PI * 2);
    spriteContext.fillStyle = rimGradient;
    spriteContext.fill();
    spriteContext.restore();

    spriteContext.save();
    spriteContext.globalCompositeOperation = "screen";
    spriteContext.beginPath();
    spriteContext.ellipse(cx - (discRadius * 0.18), centerY - (discHeight * 0.36), discRadius * 0.52, discHeight * 0.3, -0.25, 0, Math.PI * 2);
    spriteContext.fillStyle = tokens.highlight;
    spriteContext.fill();
    spriteContext.beginPath();
    spriteContext.ellipse(cx + (discRadius * 0.08), centerY - (discHeight * 0.1), discRadius * 0.78, discHeight * 0.52, 0, Math.PI, Math.PI * 2);
    spriteContext.fillStyle = tokens.specular || tokens.highlight;
    spriteContext.fill();
    spriteContext.restore();

    if (entry?.isCapital) {
      const crownY = topY - (sizePx * 0.18);
      const capitalLimitPx = Number(cityMarkerSizeLimitsPx.capital || 24);
      const crownRadiusX = Math.min(capitalLimitPx * 0.34, discRadius * 0.76);
      const crownRadiusY = Math.max(1.6, crownRadiusX * 0.34);
      spriteContext.beginPath();
      spriteContext.ellipse(cx, crownY, crownRadiusX, crownRadiusY, 0, 0, Math.PI * 2);
      spriteContext.strokeStyle = tokens.capitalAccent;
      spriteContext.lineWidth = Math.max(1.4, sizePx * 0.11);
      spriteContext.stroke();

      spriteContext.save();
      spriteContext.globalCompositeOperation = "screen";
      spriteContext.beginPath();
      spriteContext.ellipse(cx, crownY - (crownRadiusY * 0.1), crownRadiusX * 0.74, crownRadiusY * 0.55, 0, 0, Math.PI);
      spriteContext.strokeStyle = tokens.capitalHighlight;
      spriteContext.lineWidth = Math.max(1, sizePx * 0.06);
      spriteContext.stroke();
      spriteContext.restore();

      spriteContext.beginPath();
      spriteContext.moveTo(cx - crownRadiusX * 0.7, crownY);
      spriteContext.lineTo(cx - crownRadiusX * 0.28, crownY - crownRadiusY * 1.2);
      spriteContext.lineTo(cx, crownY - crownRadiusY * 0.35);
      spriteContext.lineTo(cx + crownRadiusX * 0.28, crownY - crownRadiusY * 1.2);
      spriteContext.lineTo(cx + crownRadiusX * 0.7, crownY);
      spriteContext.strokeStyle = tokens.capitalHighlight;
      spriteContext.lineWidth = Math.max(1, sizePx * 0.055);
      spriteContext.stroke();
    }

    spriteContext.restore();
    return {
      anchorX: widthPx / 2,
      anchorY: centerY + discHeight + Math.max(2, sizePx * 0.18),
    };
  }

  function getCityMarkerSprite(entry, config = {}, pixelDensity = 1) {
    const spec = getCityMarkerVisualSpec(entry, config);
    const sizePx = spec.sizePx;
    const themeKey = String(config.theme || cityMarkerThemeGraphite).trim().toLowerCase();
    const baseColorKey = String(config.color || "");
    const capitalColorKey = String(config.capitalColor || "");
    const markerStyle = getCityMarkerRenderStyle(entry, config) || {};
    const backgroundKey = markerStyle.backgroundColor || "none";
    const tokens = markerStyle.tokens;
    // Match the actual sprite inputs, so unrelated map color edits can reuse it.
    const spriteKey = JSON.stringify([
      themeKey,
      String(entry?.cityTier || "minor"),
      entry?.isCapital ? "capital" : "regular",
      sizePx,
      pixelDensity,
      baseColorKey,
      capitalColorKey,
      backgroundKey,
      Number(cityMarkerSizeLimitsPx.capital || 24),
      tokens?.fillTop,
      tokens?.fillMid || tokens?.fillTop,
      tokens?.fillBottom,
      tokens?.baseShadow,
      tokens?.stroke,
      tokens?.rimDark || tokens?.fillBottom,
      tokens?.highlight,
      tokens?.specular || tokens?.highlight,
      tokens?.capitalAccent,
      tokens?.capitalHighlight,
    ]);
    if (cityMarkerSpriteCache.has(spriteKey)) {
      const cached = cityMarkerSpriteCache.get(spriteKey);
      cityMarkerSpriteCache.delete(spriteKey);
      cityMarkerSpriteCache.set(spriteKey, cached);
      return cached;
    }

    const canvas = createCityMarkerSpriteCanvas(
      Math.ceil(spec.widthPx * pixelDensity),
      Math.ceil((spec.heightPx + spec.capitalTopExtra) * pixelDensity),
    );
    const sprite = {
      canvas,
      width: spec.widthPx,
      height: spec.heightPx + spec.capitalTopExtra,
      anchorX: spec.widthPx / 2,
      anchorY: spec.heightPx + spec.capitalTopExtra - Math.max(2, sizePx * 0.12),
    };
    if (!canvas) {
      cacheCityMarkerSprite(spriteKey, sprite);
      return sprite;
    }

    const spriteContext = canvas.getContext("2d");
    if (!spriteContext) {
      cacheCityMarkerSprite(spriteKey, sprite);
      return sprite;
    }

    // Keep sprite geometry and anchors in logical pixels, including fractional
    // densities whose bitmap dimensions must round up to whole pixels.
    spriteContext.scale(canvas.width / sprite.width, canvas.height / sprite.height);
    const anchor = renderCityMarkerSprite(spriteContext, spec, tokens, entry);
    sprite.anchorX = anchor.anchorX;
    sprite.anchorY = anchor.anchorY;
    cacheCityMarkerSprite(spriteKey, sprite);
    return sprite;
  }

  function cacheCityMarkerSprite(key, sprite) {
    cityMarkerSpriteCache.set(key, sprite);
    if (cityMarkerSpriteCache.size > CITY_MARKER_SPRITE_CACHE_LIMIT) {
      cityMarkerSpriteCache.delete(cityMarkerSpriteCache.keys().next().value);
    }
  }

  function getCityHoverRadiusPx(entry) {
    return Math.max(7, Number(entry?.markerSizePx || 0) * 0.92 + (entry?.isCapital ? 2.4 : 1.4));
  }

  function cacheVisibleCityHoverEntries(entries = []) {
    visibleCityHoverEntries = Array.isArray(entries)
      ? entries
        .filter((entry) => Array.isArray(entry?.screenPoint) && entry.screenPoint.length >= 2)
        .map((entry) => ({
          ...entry,
          hoverRadiusPx: getCityHoverRadiusPx(entry),
          tooltipText: getCityTooltipText(entry),
        }))
      : [];
  }

  function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {
    syncRenderTargets();
    const cityCollection = getEffectiveCityCollection();
    const featureCount = getFeatureCollectionFeatureCount(cityCollection);
    if (!runtimeState.showCityPoints || !cityCollection?.features?.length || !projection) {
      if (cacheHoverEntries) {
        cacheVisibleCityHoverEntries([]);
      }
      return {
        featureCount,
        markerEntries: [],
        labelEntries: [],
        skipped: true,
        reason: !runtimeState.showCityPoints ? "hidden" : !projection ? "no-projection" : "no-data",
      };
    }

    const config = normalizeCityLayerStyleConfig(runtimeState.styleConfig?.cityPoints || {});
    const transform = runtimeState.zoomTransform || getZoomIdentity();
    const scale = Math.max(0.0001, Number(transform?.k || k || 1));
    const opacity = config.opacity;
    const plan = config.revealProfile === cityRevealProfileHybrid
      ? buildCityRevealPlan(cityCollection, scale, transform, config)
      : buildCityRevealPlan(cityCollection, scale, transform, {
        ...config,
        revealProfile: cityRevealProfileHybrid,
      });
    const markerEntries = Array.isArray(plan?.markerEntries) ? plan.markerEntries : [];

    if (!markerEntries.length) {
      if (cacheHoverEntries) {
        cacheVisibleCityHoverEntries([]);
      }
      return {
        featureCount,
        skipped: true,
        reason: "culled",
        markerEntries,
        labelEntries: [],
        config,
        scale,
        opacity,
      };
    }
    if (cacheHoverEntries) {
      cacheVisibleCityHoverEntries(markerEntries);
    }
    return {
      featureCount,
      markerEntries,
      labelEntries: !interactive && config.showLabels ? plan.labelEntries || [] : [],
      labelBudget: plan.labelBudget,
      skipped: false,
      reason: "",
      config,
      scale,
      opacity,
    };
  }

  function drawCityMarkersFromEntries(markerEntries, { config, scale, opacity, interactive = false, occupiedBoxes, layoutOnly = false } = {}) {
    syncRenderTargets();
    if (!context || !Array.isArray(markerEntries) || !markerEntries.length) return [];
    const drawnEntries = [];
    const transform = context.getTransform?.();
    const targetDensity = transform
      ? Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d)) / scale
      : 1;
    const pixelDensity = Number.isFinite(targetDensity) && targetDensity > 0 ? targetDensity : 1;
    if (!layoutOnly) {
      context.save();
      context.globalCompositeOperation = "source-over";
      context.lineJoin = "round";
      context.lineCap = "round";
      context.globalAlpha = interactive ? Math.min(opacity, 0.8) : opacity;
    }

    markerEntries.forEach((entry) => {
      const spriteEntry = getCityVisualCapitalState(entry, config)
        ? entry
        : {
          ...entry,
          isCapital: false,
          markerSizePx: null,
        };
      const sprite = getCityMarkerSprite(spriteEntry, config, pixelDensity);
      if (!sprite?.canvas) return;
      const drawWidth = sprite.width / scale;
      const drawHeight = sprite.height / scale;
      const drawX = entry.anchor[0] - (sprite.anchorX / scale);
      const drawY = entry.anchor[1] - (sprite.anchorY / scale);
      if (!layoutOnly) context.drawImage(sprite.canvas, drawX, drawY, drawWidth, drawHeight);
      drawnEntries.push(entry);
      if (occupiedBoxes && opacity > 0 && entry.screenPoint) {
        occupiedBoxes.push({
          x: entry.screenPoint[0] - sprite.anchorX,
          y: entry.screenPoint[1] - sprite.anchorY,
          w: sprite.width,
          h: sprite.height,
        });
      }
    });
    if (!layoutOnly) context.restore();
    return drawnEntries;
  }

  function selectLabelledNearCities(renderState, occupiedBoxes = [], interactive = false) {
    if (interactive || runtimeState.deferExactAfterSettle
      || !renderState.config.showLabels || renderState.scale < 3.05) return renderState;
    // Trial layout uses real sprite bounds, but never reserves space in the final pass.
    const trialBoxes = [...occupiedBoxes];
    drawCityMarkersFromEntries(renderState.markerEntries, {
      ...renderState,
      occupiedBoxes: trialBoxes,
      layoutOnly: true,
    });
    drawCityLabelsFromEntries(renderState.labelEntries, {
      ...renderState,
      occupiedBoxes: trialBoxes,
      layoutOnly: true,
    });
    const labelEntries = renderState.labelEntries.filter((entry) => entry.acceptedLabelPlacement);
    const labelledEntries = new Set(labelEntries);
    return {
      ...renderState,
      markerEntries: renderState.markerEntries.filter((entry) => (
        entry.isCapital || entry.cityTier === "major" || labelledEntries.has(entry)
      )),
      labelEntries,
      reusePlacement: true,
    };
  }

  function drawCityPointsLayer(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    let renderState = getCityLayerRenderState(k, {
      interactive,
      cacheHoverEntries: true,
    });
    if (renderState.skipped) {
      collectContextMetric("drawCityPointsLayer", nowMs() - startedAt, {
        featureCount: renderState.featureCount,
        visibleFeatureCount: 0,
        labelCount: 0,
        interactive: !!interactive,
        skipped: true,
        reason: renderState.reason,
      });
      return;
    }
    renderState = selectLabelledNearCities(renderState, [], interactive);
    const drawnEntries = drawCityMarkersFromEntries(renderState.markerEntries, {
      config: renderState.config,
      scale: renderState.scale,
      opacity: renderState.opacity,
      interactive,
    });
    cacheVisibleCityHoverEntries(drawnEntries);
    collectContextMetric("drawCityPointsLayer", nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: drawnEntries.length,
      labelCount: 0,
      interactive: !!interactive,
      skipped: false,
    });
  }

  function drawLabelsPass(k, { interactive = false, occupiedBoxes = [] } = {}) {
    const startedAt = nowMs();
    if (interactive) {
      recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
        interactive: true,
        skipped: true,
        reason: "interactive",
        labelCount: 0,
      });
      return;
    }
    if (runtimeState.deferContextBasePass) {
      recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
        interactive: false,
        skipped: true,
        reason: "staged-apply",
        labelCount: 0,
      });
      return;
    }
    let renderState = getCityLayerRenderState(k, {
      interactive: false,
      cacheHoverEntries: true,
    });
    if (renderState.skipped || !renderState.markerEntries.length) {
      recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
        interactive: false,
        skipped: true,
        reason: renderState.reason || "markers-hidden",
        featureCount: renderState.featureCount,
        visibleFeatureCount: renderState.markerEntries.length,
        labelCount: 0,
      });
      return;
    }
    renderState = selectLabelledNearCities(renderState, occupiedBoxes);
    const drawnEntries = drawCityMarkersFromEntries(renderState.markerEntries, {
      config: renderState.config,
      scale: renderState.scale,
      opacity: renderState.opacity,
      interactive: false,
      occupiedBoxes,
    });
    cacheVisibleCityHoverEntries(drawnEntries);
    const labelCount = drawCityLabelsFromEntries(renderState.labelEntries, {
      config: renderState.config,
      scale: renderState.scale,
      occupiedBoxes,
      labelBudget: renderState.labelBudget,
      reusePlacement: renderState.reusePlacement,
    });
    recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
      interactive: false,
      skipped: false,
      featureCount: renderState.featureCount,
      visibleFeatureCount: drawnEntries.length,
      labelCount,
    });
  }

  function getHoveredCityEntryFromEvent(event) {
    syncRenderTargets();
    const startedAt = nowMs();
    const eventType = String(event?.type || "hover").toLowerCase() === "mousemove" ? "hover" : String(event?.type || "unknown").toLowerCase();
    if (!visibleCityHoverEntries.length || !mapSvg) {
      recordInteractionDurationMetric("interactionHoverCityProbeDuration", nowMs() - startedAt, {
        eventType,
        entryCount: visibleCityHoverEntries.length,
        hit: false,
        skipped: true,
      });
      return null;
    }
    const pointer = getPointer(event, mapSvg);
    const [sx, sy] = Array.isArray(pointer) ? pointer : [];
    if (![sx, sy].every(Number.isFinite)) {
      recordInteractionDurationMetric("interactionHoverCityProbeDuration", nowMs() - startedAt, {
        eventType,
        entryCount: visibleCityHoverEntries.length,
        hit: false,
        skipped: true,
      });
      return null;
    }
    let bestEntry = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = -1;
    visibleCityHoverEntries.forEach((entry) => {
      const [entryX, entryY] = entry.screenPoint || [];
      if (![entryX, entryY].every(Number.isFinite)) {
        return;
      }
      const threshold = Math.max(6, Number(entry.hoverRadiusPx || 0));
      const distance = Math.hypot(sx - entryX, sy - entryY);
      const hitPriority = getHoverEntryHitPriority(entry);
      if (distance <= threshold && (hitPriority > bestPriority || (hitPriority === bestPriority && distance < bestDistance))) {
        bestDistance = distance;
        bestPriority = hitPriority;
        bestEntry = entry;
      }
    });
    recordInteractionDurationMetric("interactionHoverCityProbeDuration", nowMs() - startedAt, {
      eventType,
      entryCount: visibleCityHoverEntries.length,
      hit: !!bestEntry,
    });
    return bestEntry;
  }

  function getHoveredCityTooltipEntry(event, hit) {
    const entry = getHoveredCityEntryFromEvent(event);
    return isCityEntryEligibleForLandHit(entry, hit) ? entry : null;
  }

  return {
    cacheVisibleCityHoverEntries,
    drawCityMarkersFromEntries,
    drawCityPointsLayer,
    drawLabelsPass,
    getCityLayerRenderState,
    getCityMarkerSprite,
    getHoveredCityEntryFromEvent,
    getHoveredCityTooltipEntry,
  };
}
