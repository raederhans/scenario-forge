const DEFAULT_ZOOM_IDENTITY = Object.freeze({ x: 0, y: 0, k: 1 });
const CITY_MARKER_SPRITE_CACHE_LIMIT = 256;
export function resolveSettlementRank(entry) {
  const rawRank = String(entry?.settlementRank || "").trim().toLowerCase();
  if (rawRank === "metropolis" || rawRank === "large" || rawRank === "medium" || rawRank === "small" || rawRank === "town") {
    return rawRank;
  }
  if (rawRank === "major") return "large";
  if (rawRank === "regional") return "medium";
  if (rawRank === "minor") return "small";

  const rawTier = String(entry?.cityTier || "").trim().toLowerCase();
  if (rawTier === "metropolis" || rawTier === "large" || rawTier === "medium" || rawTier === "small" || rawTier === "town") {
    return rawTier;
  }
  if (rawTier === "major") return "large";
  if (rawTier === "regional") return "medium";
  if (rawTier === "minor") return "small";

  return "small";
}

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
    const sizePx = Math.max(3, Number(entry?.markerSizePx || getCityMarkerSizePx(entry, config) || 3));
    const settlementRank = resolveSettlementRank(entry);
    const isCapital = Boolean(getCityVisualCapitalState(entry, config));

    // Policy provides actual diameter 10/8/6/4.5/3 for metropolis/large/medium/small/town.
    // Use rankRadius = sizePx / 2 with safe minimum >= 1.5, avoiding arbitrary larger minima.
    const rankRadius = Math.max(1.5, sizePx / 2);
    const isBullseye = settlementRank === "metropolis";
    // medium is filled; small and town are hollow to match the approved legend
    const isHollow = settlementRank === "small" || settlementRank === "town";
    const innerRadius = isBullseye ? Math.max(1.0, rankRadius * 0.44) : 0;

    // Eliminate wide halo; keep symbols compact on world overview with 1px anti-aliasing margin
    const halfDim = Math.ceil(rankRadius + 1);
    const widthPx = Math.max(4, halfDim * 2);
    const heightPx = widthPx;

    return {
      sizePx,
      settlementRank,
      cityTier: String(entry?.cityTier || "minor").trim().toLowerCase(),
      rankRadius,
      discRadius: rankRadius,
      discHeight: rankRadius,
      isHollow,
      isBullseye,
      innerRadius,
      isCapital,
      starOuter: rankRadius,
      starInner: Math.max(0.7, rankRadius * 0.48),
      widthPx,
      heightPx,
      capitalTopExtra: 0,
    };
  }

  function drawCirclePath(ctx, cx, cy, radius) {
    ctx.beginPath();
    if (typeof ctx.arc === "function") {
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    } else if (typeof ctx.ellipse === "function") {
      ctx.ellipse(cx, cy, radius, radius, 0, 0, Math.PI * 2);
    }
  }

  function drawStarPath(ctx, cx, cy, outerR, innerR) {
    ctx.beginPath();
    const starPoints = 5;
    for (let i = 0; i < starPoints * 2; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI / starPoints);
      const r = (i % 2 === 0) ? outerR : innerR;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    if (typeof ctx.closePath === "function") {
      ctx.closePath();
    }
  }

  function renderCityMarkerSprite(spriteContext, spec, tokens, entry) {
    const {
      rankRadius,
      isHollow,
      isBullseye,
      innerRadius,
      isCapital,
      starOuter,
      starInner,
      widthPx,
      heightPx,
    } = spec;

    const cx = widthPx / 2;
    const cy = heightPx / 2;

    const fillMid = tokens?.fillMid || tokens?.fill || tokens?.fillTop || "#303844";
    const strokeColor = tokens?.stroke || "rgba(245, 188, 86, 0.72)";
    const capitalAccent = tokens?.capitalAccent || "rgba(240, 184, 79, 0.98)";
    const rimDark = tokens?.rimDark || "rgba(5, 9, 15, 0.58)";

    spriteContext.save();
    spriteContext.lineJoin = "round";
    spriteContext.lineCap = "round";

    // 1. Capital Identity: single restrained star identity matching capital size without extra expansion
    if (isCapital) {
      drawStarPath(spriteContext, cx, cy, starOuter, starInner);
      if (isHollow) {
        spriteContext.strokeStyle = capitalAccent;
        spriteContext.lineWidth = 1;
        spriteContext.stroke();
      } else {
        spriteContext.fillStyle = capitalAccent;
        spriteContext.fill();
        spriteContext.strokeStyle = rimDark;
        spriteContext.lineWidth = 1;
        spriteContext.stroke();
      }
      if (isBullseye) {
        drawCirclePath(spriteContext, cx, cy, innerRadius);
        spriteContext.fillStyle = fillMid;
        spriteContext.fill();
      }
    } else if (isBullseye) {
      // Metropolis: outer circle + inner solid dot (bullseye)
      drawCirclePath(spriteContext, cx, cy, rankRadius);
      spriteContext.strokeStyle = strokeColor;
      spriteContext.lineWidth = 1;
      spriteContext.stroke();

      drawCirclePath(spriteContext, cx, cy, innerRadius);
      spriteContext.fillStyle = fillMid;
      spriteContext.fill();
    } else if (isHollow) {
      // Small / Town: flat hollow circle
      drawCirclePath(spriteContext, cx, cy, rankRadius);
      spriteContext.strokeStyle = strokeColor;
      spriteContext.lineWidth = 1;
      spriteContext.stroke();
    } else {
      // Large / Medium: flat solid filled circle
      drawCirclePath(spriteContext, cx, cy, rankRadius);
      spriteContext.fillStyle = fillMid;
      spriteContext.fill();
      spriteContext.strokeStyle = strokeColor;
      spriteContext.lineWidth = 1;
      spriteContext.stroke();
    }

    spriteContext.restore();
    return {
      anchorX: cx,
      anchorY: cy,
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
      spec.settlementRank,
      String(entry?.cityTier || "minor"),
      spec.isCapital ? "capital" : "regular",
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
      Math.ceil(spec.heightPx * pixelDensity),
    );
    const sprite = {
      canvas,
      width: spec.widthPx,
      height: spec.heightPx,
      anchorX: spec.widthPx / 2,
      anchorY: spec.heightPx / 2,
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

  function drawCityPointsLayer(k, { interactive = false } = {}) {
    const startedAt = nowMs();
    const renderState = getCityLayerRenderState(k, {
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
    // Marker set depends strictly on policy (same across interactive and settled passes)
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
    const renderState = getCityLayerRenderState(k, {
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
    // All policy markers are drawn consistently, populating occupiedBoxes to avoid label overlap
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
    getCityMarkerVisualSpec,
    getHoveredCityEntryFromEvent,
    getHoveredCityTooltipEntry,
    resolveSettlementRank,
  };
}
