function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

export function createVisualEffectsPassOwner({
  getters = {}, helpers = {}, effects = {}, platform = {}, constants = {},
} = {}) {
  const getContext = requireFunction(getters.getContext, "getters.getContext");
  const getPathCanvas = requireFunction(getters.getPathCanvas, "getters.getPathCanvas");
  const getPathSvg = requireFunction(getters.getPathSvg, "getters.getPathSvg");
  const getProjection = requireFunction(getters.getProjection, "getters.getProjection");
  const getViewportSize = requireFunction(getters.getViewportSize, "getters.getViewportSize");
  const getTextureStyleConfig = requireFunction(getters.getTextureStyleConfig, "getters.getTextureStyleConfig");
  const isBootInteractionReady = requireFunction(getters.isBootInteractionReady, "getters.isBootInteractionReady");
  const clamp = requireFunction(helpers.clamp, "helpers.clamp");
  const getDashPattern = requireFunction(helpers.getDashPattern, "helpers.getDashPattern");
  const getSafeBlendMode = requireFunction(helpers.getSafeBlendMode, "helpers.getSafeBlendMode");
  const getSafeCanvasColor = requireFunction(helpers.getSafeCanvasColor, "helpers.getSafeCanvasColor");
  const normalizeTextureMode = requireFunction(helpers.normalizeTextureMode, "helpers.normalizeTextureMode");
  const requestTextureRerender = requireFunction(effects.requestTextureRerender, "effects.requestTextureRerender");
  const drawDayNightRuntimePass = requireFunction(effects.drawDayNightRuntimePass, "effects.drawDayNightRuntimePass");
  const recordRenderPerfMetric = requireFunction(effects.recordRenderPerfMetric, "effects.recordRenderPerfMetric");
  const createCanvas = requireFunction(platform.createCanvas, "platform.createCanvas");
  const createImage = requireFunction(platform.createImage, "platform.createImage");
  const createGeoRotation = requireFunction(platform.createGeoRotation, "platform.createGeoRotation");
  const createPatternTransform = requireFunction(platform.createPatternTransform, "platform.createPatternTransform");
  const PAPER_TEXTURE_ASSET_URLS = Object.freeze({ ...(constants.paperTextureAssetUrls || {}) });
  const PAPER_NOISE_TILE_SIZE = Number(constants.paperNoiseTileSize) || 192;
  const GRATICULE_SAMPLE_DEGREES = Number(constants.graticuleSampleDegrees) || 2;
  const TEXTURE_LABEL_SERIF_STACK = String(constants.textureLabelSerifStack || "serif");
  const textureAssetCache = new Map();
  const texturePatternCache = new Map();
  const textureGeometryCache = new Map();
  const textureNoiseTileCache = new Map();

  function resolvePaperTextureAssetUrl(assetId) {
    return PAPER_TEXTURE_ASSET_URLS[String(assetId || "").trim()] || null;
  }

  function ensureTextureAssetImage(assetId) {
    const normalizedId = String(assetId || "").trim();
    if (!normalizedId) return null;
    const existing = textureAssetCache.get(normalizedId);
    if (existing) {
      return existing.status === "ready" ? existing.image : null;
    }
    const url = resolvePaperTextureAssetUrl(normalizedId);
    if (!url) return null;

    const image = createImage();
    const entry = {
      status: "loading",
      image,
      url,
    };
    textureAssetCache.set(normalizedId, entry);
    image.decoding = "async";
    image.onload = () => {
      entry.status = "ready";
      texturePatternCache.clear();
      requestTextureRerender();
    };
    image.onerror = () => {
      entry.status = "error";
    };
    image.src = url;
    return null;
  }

  function createSeededRandom(seedInput) {
    let seed = Number(seedInput) || 1;
    return () => {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getTexturePattern(source, cacheKey, scale = 1) {
    if (!getContext() || !source || !cacheKey) return null;
    const normalizedScale = clamp(Number(scale) || 1, 0.25, 4);
    const key = `${cacheKey}|${normalizedScale.toFixed(3)}`;
    const cached = texturePatternCache.get(key);
    if (cached) return cached;

    const pattern = getContext().createPattern(source, "repeat");
    if (!pattern) return null;
    if (pattern.setTransform) {
      const matrix = createPatternTransform(normalizedScale);
      if (matrix) pattern.setTransform(matrix);
    }
    texturePatternCache.set(key, pattern);
    return pattern;
  }

  function getPaperNoiseTile(paperConfig) {
    const scaleBucket = Math.round((paperConfig?.scale || 1) * 100);
    const grainBucket = Math.round((paperConfig?.grain || 0) * 100);
    const wearBucket = Math.round((paperConfig?.wear || 0) * 100);
    const warmthBucket = Math.round((paperConfig?.warmth || 0) * 100);
    const key = `${scaleBucket}|${grainBucket}|${wearBucket}|${warmthBucket}`;
    const cached = textureNoiseTileCache.get(key);
    if (cached) return cached;

    const tile = createCanvas();
    tile.width = PAPER_NOISE_TILE_SIZE;
    tile.height = PAPER_NOISE_TILE_SIZE;
    const tileCtx = tile.getContext("2d");
    if (!tileCtx) return null;

    const rng = createSeededRandom(scaleBucket * 17 + grainBucket * 29 + wearBucket * 43 + warmthBucket * 59);
    tileCtx.clearRect(0, 0, tile.width, tile.height);

    const speckCount = Math.round(900 + grainBucket * 14);
    for (let index = 0; index < speckCount; index += 1) {
      const alpha = 0.012 + rng() * 0.03;
      const shade = Math.round(88 + rng() * 70);
      tileCtx.fillStyle = `rgba(${shade}, ${shade - 6}, ${Math.max(24, shade - 22)}, ${alpha})`;
      const x = rng() * tile.width;
      const y = rng() * tile.height;
      const size = rng() < 0.82 ? 1 : 2 + rng() * 1.8;
      tileCtx.fillRect(x, y, size, size);
    }

    const fiberCount = Math.round(260 + grainBucket * 2.6);
    tileCtx.lineCap = "round";
    for (let index = 0; index < fiberCount; index += 1) {
      const x = rng() * tile.width;
      const y = rng() * tile.height;
      const length = 4 + rng() * 12;
      const angle = rng() * Math.PI * 2;
      tileCtx.strokeStyle = `rgba(98, 74, 52, ${0.018 + rng() * 0.025})`;
      tileCtx.lineWidth = 0.35 + rng() * 0.8;
      tileCtx.beginPath();
      tileCtx.moveTo(x, y);
      tileCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      tileCtx.stroke();
    }

    const stainCount = Math.round(10 + wearBucket * 0.1);
    for (let index = 0; index < stainCount; index += 1) {
      const radius = 12 + rng() * 26;
      const x = rng() * tile.width;
      const y = rng() * tile.height;
      const gradient = tileCtx.createRadialGradient(x, y, radius * 0.12, x, y, radius);
      gradient.addColorStop(0, `rgba(128, 92, 54, ${0.022 + rng() * 0.028})`);
      gradient.addColorStop(1, "rgba(128, 92, 54, 0)");
      tileCtx.fillStyle = gradient;
      tileCtx.beginPath();
      tileCtx.arc(x, y, radius, 0, Math.PI * 2);
      tileCtx.fill();
    }

    if (warmthBucket > 0) {
      tileCtx.fillStyle = `rgba(171, 132, 78, ${0.02 + warmthBucket / 5500})`;
      tileCtx.fillRect(0, 0, tile.width, tile.height);
    }

    textureNoiseTileCache.set(key, tile);
    return tile;
  }

  function withSavedContext(drawFn) {
    const context = getContext();
    if (!context || typeof drawFn !== "function") return;
    context.save();
    try {
      drawFn(context);
    } finally {
      context.restore();
    }
  }

  function withTextureSphereClip(shouldClip, drawFn) {
    if (!getContext() || !getPathCanvas() || typeof drawFn !== "function") return;
    withSavedContext((context) => {
      if (shouldClip) {
        context.beginPath();
        getPathCanvas()({ type: "Sphere" });
        context.clip();
      }
      drawFn();
    });
  }

  function buildTextureAxisValues(limit, step) {
    const values = [];
    const safeStep = Math.max(1, Number(step) || 1);
    for (let value = -limit + safeStep; value < limit; value += safeStep) {
      values.push(Number(value.toFixed(6)));
    }
    return values;
  }

  function shouldIncludeTextureLabel(value, step) {
    const normalizedStep = Math.max(1, Number(step) || 1);
    return Math.abs(value / normalizedStep - Math.round(value / normalizedStep)) < 1e-6;
  }

  function formatLongitudeLabel(value) {
    const abs = Math.round(Math.abs(value));
    if (abs === 0) return "0°";
    return `${abs}°${value < 0 ? "W" : "E"}`;
  }

  function formatLatitudeLabel(value) {
    const abs = Math.round(Math.abs(value));
    if (abs === 0) return "0°";
    return `${abs}°${value < 0 ? "S" : "N"}`;
  }

  function buildTextureLine(kind, fixedValue, rotatePoint, label = "") {
    const coordinates = [];
    if (kind === "meridian") {
      for (let lat = -89.5; lat <= 89.5; lat += GRATICULE_SAMPLE_DEGREES) {
        coordinates.push(rotatePoint([fixedValue, lat]));
      }
      coordinates.push(rotatePoint([fixedValue, 89.5]));
    } else {
      for (let lon = -180; lon <= 180; lon += GRATICULE_SAMPLE_DEGREES) {
        coordinates.push(rotatePoint([lon, fixedValue]));
      }
      coordinates.push(rotatePoint([180, fixedValue]));
    }
    return {
      kind,
      value: fixedValue,
      label,
      geometry: {
        type: "LineString",
        coordinates,
      },
    };
  }

  function buildTextureGraticuleGeometry(cacheKey, {
    majorStep,
    minorStep,
    labelStep,
    rotation = [0, 0, 0],
    includeLabels = true,
  } = {}) {
    const cached = textureGeometryCache.get(cacheKey);
    if (cached) return cached;
    const rotatePoint = createGeoRotation(rotation);
    const geometry = {
      majorLines: [],
      minorLines: [],
    };
    const majorMeridians = new Set(buildTextureAxisValues(180, majorStep).map((value) => value.toFixed(6)));
    const majorParallels = new Set(buildTextureAxisValues(90, majorStep).map((value) => value.toFixed(6)));

    buildTextureAxisValues(180, majorStep).forEach((value) => {
      geometry.majorLines.push(
        buildTextureLine(
          "meridian",
          value,
          rotatePoint,
          includeLabels && shouldIncludeTextureLabel(value, labelStep) ? formatLongitudeLabel(value) : ""
        )
      );
    });
    buildTextureAxisValues(90, majorStep).forEach((value) => {
      geometry.majorLines.push(
        buildTextureLine(
          "parallel",
          value,
          rotatePoint,
          includeLabels && shouldIncludeTextureLabel(value, labelStep) ? formatLatitudeLabel(value) : ""
        )
      );
    });

    if (minorStep < majorStep) {
      buildTextureAxisValues(180, minorStep).forEach((value) => {
        if (majorMeridians.has(value.toFixed(6))) return;
        geometry.minorLines.push(buildTextureLine("meridian", value, rotatePoint));
      });
      buildTextureAxisValues(90, minorStep).forEach((value) => {
        if (majorParallels.has(value.toFixed(6))) return;
        geometry.minorLines.push(buildTextureLine("parallel", value, rotatePoint));
      });
    }

    textureGeometryCache.set(cacheKey, geometry);
    return geometry;
  }

  function getTextureLineAnchor(line) {
    if (!getProjection() || !Array.isArray(line?.geometry?.coordinates)) return null;
    let topMost = null;
    let bottomMost = null;
    let leftMost = null;
    let rightMost = null;
    line.geometry.coordinates.forEach((coordinate) => {
      const projected = getProjection()(coordinate);
      if (!projected || projected.length < 2 || !projected.every(Number.isFinite)) return;
      const [x, y] = projected;
      if (line.kind === "meridian") {
        if (!topMost || y < topMost.y) topMost = { x, y };
        if (!bottomMost || y > bottomMost.y) bottomMost = { x, y };
      } else {
        if (!leftMost || x < leftMost.x) leftMost = { x, y };
        if (!rightMost || x > rightMost.x) rightMost = { x, y };
      }
    });
    if (line.kind === "meridian") {
      const shouldUseBottomAnchor = Number(line.value) < 0;
      const anchor = shouldUseBottomAnchor ? (bottomMost || topMost) : (topMost || bottomMost);
      if (!anchor) return null;
      return shouldUseBottomAnchor
        ? { ...anchor, align: "center", baseline: "bottom", offsetX: 0, offsetY: -8 }
        : { ...anchor, align: "center", baseline: "top", offsetX: 0, offsetY: 8 };
    }
    const shouldUseRightAnchor = Number(line.value) >= 0;
    const anchor = shouldUseRightAnchor ? (rightMost || leftMost) : (leftMost || rightMost);
    if (!anchor) return null;
    return shouldUseRightAnchor
      ? { ...anchor, align: "right", baseline: "middle", offsetX: -8, offsetY: 0 }
      : { ...anchor, align: "left", baseline: "middle", offsetX: 8, offsetY: 0 };
  }

  function drawTextureLabels(lines, config, k, opacity) {
    if (!getContext() || !Array.isArray(lines) || !lines.length) return;
    const occupied = [];
    const minDistance = 56 / Math.max(0.8, k);
    const fontSize = clamp((Number(config.labelSize) || 12) / Math.max(0.75, k), 9, 20);
    const labelOpacity = clamp(opacity, 0, 0.92);

    getContext().save();
    try {
    getContext().lineJoin = "round";
    getContext().miterLimit = 2;
    getContext().strokeStyle = "rgba(248, 250, 252, 0.92)";
    getContext().lineWidth = 3.2 / Math.max(0.85, k);
    getContext().fillStyle = getSafeCanvasColor(config.labelColor, "#475569");
    getContext().globalAlpha = labelOpacity;
    getContext().font = `${fontSize}px ${TEXTURE_LABEL_SERIF_STACK}`;

    lines.forEach((line) => {
      if (!line?.label) return;
      const anchor = getTextureLineAnchor(line);
      if (!anchor) return;
      const x = anchor.x + anchor.offsetX / Math.max(0.8, k);
      const y = anchor.y + anchor.offsetY / Math.max(0.8, k);
      const overlaps = occupied.some((point) => Math.hypot(point.x - x, point.y - y) < minDistance);
      if (overlaps) return;
      occupied.push({ x, y });
      getContext().textAlign = anchor.align;
      getContext().textBaseline = anchor.baseline;
      getContext().strokeText(line.label, x, y);
      getContext().fillText(line.label, x, y);
    });

    } finally {
      getContext().restore();
    }
  }

  function drawOldPaperTexture(k, { interactive = false } = {}) {
    if (!getContext() || !getPathCanvas() || !getPathSvg()) return;
    const texture = getTextureStyleConfig();
    const paper = texture.paper || {};
    const assetImage = ensureTextureAssetImage(paper.assetId);
    const noiseTile = getPaperNoiseTile(paper);
    const sphereBounds = getPathSvg().bounds({ type: "Sphere" });
    const minX = sphereBounds?.[0]?.[0] || 0;
    const minY = sphereBounds?.[0]?.[1] || 0;
    const maxX = sphereBounds?.[1]?.[0] || getViewportSize().width;
    const maxY = sphereBounds?.[1]?.[1] || getViewportSize().height;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radius = Math.max(maxX - minX, maxY - minY) * 0.58;

    withTextureSphereClip(texture.sphereClip, () => {
      getContext().save();
      try {
      getContext().globalCompositeOperation = "multiply";
      getContext().globalAlpha = clamp(texture.opacity * (0.24 + paper.warmth * 0.22), 0, interactive ? 0.28 : 0.42);
      getContext().fillStyle = `rgba(205, 182, 138, ${0.42 + paper.warmth * 0.18})`;
      getContext().beginPath();
      getPathCanvas()({ type: "Sphere" });
      getContext().fill();

      if (assetImage) {
        const assetPattern = getTexturePattern(assetImage, `paper-asset:${paper.assetId}`, paper.scale);
        if (assetPattern) {
          getContext().globalCompositeOperation = getSafeBlendMode(paper.blendMode, "multiply");
          getContext().globalAlpha = clamp(texture.opacity * (interactive ? 0.15 : 0.34), 0, 0.42);
          getContext().fillStyle = assetPattern;
          getContext().beginPath();
          getPathCanvas()({ type: "Sphere" });
          getContext().fill();
        }
      }

      if (noiseTile) {
        const noisePattern = getTexturePattern(
          noiseTile,
          `paper-noise:${Math.round(paper.grain * 100)}:${Math.round(paper.wear * 100)}:${Math.round(paper.warmth * 100)}`,
          paper.scale * 0.88
        );
        if (noisePattern) {
          getContext().globalCompositeOperation = "multiply";
          getContext().globalAlpha = clamp(texture.opacity * (0.22 + paper.grain * 0.3 + paper.wear * 0.22), 0, interactive ? 0.24 : 0.48);
          getContext().fillStyle = noisePattern;
          getContext().beginPath();
          getPathCanvas()({ type: "Sphere" });
          getContext().fill();
        }
      }

      const vignette = getContext().createRadialGradient(
        centerX,
        centerY,
        radius * 0.24,
        centerX,
        centerY,
        radius * 1.06
      );
      vignette.addColorStop(0, "rgba(88, 62, 34, 0)");
      vignette.addColorStop(1, `rgba(88, 62, 34, ${0.18 + paper.vignette * 0.42})`);
      getContext().globalCompositeOperation = "multiply";
      getContext().globalAlpha = clamp(texture.opacity * (0.14 + paper.vignette * 0.65), 0, 0.32);
      getContext().fillStyle = vignette;
      getContext().fillRect(minX - 24, minY - 24, maxX - minX + 48, maxY - minY + 48);
      } finally {
        getContext().restore();
      }
    });
  }

  function drawProjectedTextureLines(lines, {
    color = "#64748b",
    width = 1,
    opacity = 0.2,
    dash = [],
    k = 1,
  } = {}) {
    if (!getContext() || !getPathCanvas() || !Array.isArray(lines) || !lines.length) return;
    getContext().save();
    try {
    getContext().strokeStyle = getSafeCanvasColor(color, "#64748b");
    getContext().globalAlpha = clamp(opacity, 0, 1);
    getContext().lineWidth = clamp(Number(width) || 1, 0.1, 4) / Math.max(0.0001, k);
    getContext().setLineDash(Array.isArray(dash) ? dash : []);
    lines.forEach((line) => {
      if (!line?.geometry) return;
      getContext().beginPath();
      getPathCanvas()(line.geometry);
      getContext().stroke();
    });
    } finally {
      getContext().restore();
    }
  }

  function getGraticuleTextureGeometry(config) {
    const cacheKey = [
      "graticule",
      config.majorStep,
      config.minorStep,
      config.labelStep,
      config.majorWidth,
      config.minorWidth,
    ].join("|");
    return buildTextureGraticuleGeometry(cacheKey, {
      majorStep: config.majorStep,
      minorStep: config.minorStep,
      labelStep: config.labelStep,
      includeLabels: true,
    });
  }

  function drawGraticuleTextureLines(k, { interactive = false } = {}) {
    const texture = getTextureStyleConfig();
    const config = texture.graticule || {};
    const geometry = getGraticuleTextureGeometry(config);

    withTextureSphereClip(texture.sphereClip, () => {
      drawProjectedTextureLines(geometry.minorLines, {
        color: config.color,
        width: config.minorWidth,
        opacity: texture.opacity * config.minorOpacity * (interactive ? 0.9 : 1),
        k,
      });
      drawProjectedTextureLines(geometry.majorLines, {
        color: config.color,
        width: config.majorWidth,
        opacity: texture.opacity * config.majorOpacity,
        k,
      });
    });
  }

  function drawGraticuleTextureLabels(k) {
    const texture = getTextureStyleConfig();
    const config = texture.graticule || {};
    const geometry = getGraticuleTextureGeometry(config);
    withTextureSphereClip(texture.sphereClip, () => {
      drawTextureLabels(
        geometry.majorLines,
        config,
        k,
        texture.opacity * clamp((config.majorOpacity * 1.25) + 0.08, 0, 0.78)
      );
    });
  }

  function drawDraftGridTexture(k, { interactive = false } = {}) {
    const texture = getTextureStyleConfig();
    const config = texture.draftGrid || {};
    const cacheKey = [
      "draft-grid",
      config.majorStep,
      config.minorStep,
      Math.round(config.lonOffset),
      Math.round(config.latOffset),
      Math.round(config.roll),
    ].join("|");
    const geometry = buildTextureGraticuleGeometry(cacheKey, {
      majorStep: config.majorStep,
      minorStep: config.minorStep,
      labelStep: 999,
      rotation: [config.lonOffset, config.latOffset, config.roll],
      includeLabels: false,
    });
    const majorDash = getDashPattern(config.dash || "dashed", Number(config.width) || 1);
    const minorDash = config.dash === "solid"
      ? []
      : getDashPattern(config.dash || "dashed", Math.max(0.5, (Number(config.width) || 1) * 0.75));
    const drawMinor = !interactive || k > 1.15;

    withTextureSphereClip(texture.sphereClip, () => {
      if (drawMinor) {
        drawProjectedTextureLines(geometry.minorLines, {
          color: config.color,
          width: Math.max(0.22, (Number(config.width) || 1) * 0.68),
          opacity: texture.opacity * config.minorOpacity,
          dash: minorDash,
          k,
        });
      }
      drawProjectedTextureLines(geometry.majorLines, {
        color: config.color,
        width: config.width,
        opacity: texture.opacity * config.majorOpacity,
        dash: majorDash,
        k,
      });
    });
  }


  function drawEffectsPass(k, { interactive = false } = {}) {
    const texture = getTextureStyleConfig();
    if (normalizeTextureMode(texture.mode) !== "paper") return;
    if (!isBootInteractionReady()) return;
    drawOldPaperTexture(k, { interactive });
  }

  function drawLineEffectsPass(k, { interactive = false } = {}) {
    const texture = getTextureStyleConfig();
    const mode = String(texture.mode || "none").trim().toLowerCase();
    if (!isBootInteractionReady()) return;
    if (mode === "graticule") {
      drawGraticuleTextureLines(k, { interactive });
      return;
    }
    if (mode === "draft_grid") {
      drawDraftGridTexture(k, { interactive });
    }
  }

  function drawTextureLabelEffectsPass(k) {
    const texture = getTextureStyleConfig();
    const mode = String(texture.mode || "none").trim().toLowerCase();
    if (!isBootInteractionReady()) return;
    if (mode === "graticule") {
      drawGraticuleTextureLabels(k);
    }
  }

  function drawDayNightPass(k, { interactive = false } = {}) {
    drawDayNightRuntimePass(k, { interactive });
  }

  function invalidateTextureRasterCaches() {
    texturePatternCache.clear();
    textureNoiseTileCache.clear();
  }

  return Object.freeze({
    drawEffectsPass,
    drawLineEffectsPass,
    drawTextureLabelEffectsPass,
    drawDayNightPass,
    invalidateTextureRasterCaches,
  });
}
