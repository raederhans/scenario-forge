const defaultColorManager = {
  normalizeHexColor: () => null,
  hexToRgb: () => null,
};

export function createCityLightsRenderOwner({
  state = {}, assets = {}, assetProvider = null, getters = {}, helpers = {}, effects = {},
} = {}) {
  const runtimeState = state;
  const {
    HISTORICAL_1930_CITY_LIGHTS_ENTRIES = [],
    HISTORICAL_DERIVED_GLOW_MAX_ENTRIES = 520,
    HISTORICAL_DERIVED_GLOW_MIN_WEIGHT = 0.62,
    MODERN_CITY_LIGHTS_BASE_THRESHOLD = 0,
    MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD = Number.POSITIVE_INFINITY,
    MODERN_CITY_LIGHTS_GRID = [],
    MODERN_CITY_LIGHTS_GRID_HEIGHT = 0,
    MODERN_CITY_LIGHTS_GRID_WIDTH = 0,
    MODERN_CITY_LIGHTS_STATS = null,
    MODERN_CITY_LIGHTS_STEP_LAT_DEG = 1,
    MODERN_CITY_LIGHTS_STEP_LON_DEG = 1,
    MODERN_CITY_LIGHTS_URBAN_AREAS = null,
  } = assets;
  const {
    getContext = () => null,
    getPathCanvas = () => null,
    getProjection = () => null,
  } = getters;
  const {
    buildNightHemisphereFeature = () => null,
    clamp = (value, min, max) => Math.max(min, Math.min(max, value)),
    ColorManager = defaultColorManager,
    createCanvas = () => null,
    estimateProjectedAreaPx = () => 0,
    getCityAnchor = () => null,
    getCityCanonicalId = () => '',
    getCityCapitalScore = () => 0,
    getCityGeoCoordinates = () => null,
    getCityScreenPoint = () => null,
    getDefaultZoomTransform = () => ({ x: 0, y: 0, k: 1 }),
    getEffectiveCityCollection = () => ({ type: 'FeatureCollection', features: [] }),
    getFeatureGeoCentroid = () => null,
    getProjectedFeatureBounds = () => null,
    getProjectedGeographicPath = () => null,
    getRenderPassLayout = () => null,
    getSafeBlendMode = (preferred, fallback) => preferred || fallback,
    getTransformSignature = () => '',
    getUrbanCityPolicyOwner = () => null,
    getUrbanGlowMultiplierAt = () => 1,
    normalizeDayNightStyleConfig = (config) => config || {},
    normalizeIntensityFieldsState = (fields) => fields || {},
    normalizeLongitude = (value) => value,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    pathBoundsInScreen = () => false,
    prepareTargetContext = () => null,
    recordRenderPerfMetric = () => {},
    sampleIntensityField = () => null,
    stableJson = (value) => JSON.stringify(value),
    stringHash = (value) => {
      let hash = 0;
      const text = String(value || '');
      for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
      }
      return Math.abs(hash);
    },
    withRenderTarget = (targetContext, callback) => callback?.(),
  } = helpers;
  const onModernAssetsReady = typeof effects.onModernAssetsReady === "function"
    ? effects.onModernAssetsReady
    : () => {};
  const onModernAssetsError = typeof effects.onModernAssetsError === "function"
    ? effects.onModernAssetsError
    : () => {};
  let modernAssetLoadPromise = null;
  let urbanShapeLoadAttempted = false;
  let urbanShapeCanvas = null;
  let modernCityLightsCells = null;
  const lightBlobSpriteCache = new Map();
  const LIGHT_BLOB_SPRITE_SIZE = 96;
  const LIGHT_BLOB_SPRITE_LIMIT = 48;
  let modernCityLightsDrawStats = null;
  const globalUrbanByCityId = new Map();
  for (const feature of MODERN_CITY_LIGHTS_URBAN_AREAS?.features || []) {
    for (const cityId of feature.properties?.city_ids || []) globalUrbanByCityId.set(cityId, feature);
  }

  const modernCityLightsGeometryCache = {
    projectionKey: '',
    initialized: false,
    baseEntries: [],
    corridorEntries: [],
  };
  const modernCityLightsPopulationBoostCache = {
    cityCollection: null,
    urbanCollection: null,
    cityLayerRevision: -1,
    scenarioId: '',
    urbanEntries: [],
    cityEntries: [],
    urbanByFeature: new Map(),
    cityByFeature: new Map(),
  };
  const modernCityLightsStaticLayerCache = {
    key: '',
    canvas: null,
    width: 0,
    height: 0,
  };
  const historicalCityLightsDerivedGlowCache = {
    key: '',
    entries: [],
  };
  const historicalCityLightsFallbackCache = {
    cityCollection: null,
    cityLayerRevision: -1,
    scenarioId: '',
    secondaryRetention: -1,
    entries: [],
  };

  function getZoomTransform() {
    return runtimeState.zoomTransform || getDefaultZoomTransform();
  }

  function getNightLightPalette(styleVariant = "modern") {
    if (styleVariant === "historical_1930s") {
      return {
        halo: "#f4c972",
        core: "#ffd88b",
        glint: "#fff4c1",
      };
    }
    return {
      texture: "#d7bc76",
      corridor: "#fff0ba",
      halo: "#f5d89a",
      core: "#fff7d5",
      glint: "#fffdf0",
    };
  }

  function getUrbanLightWeight(feature, styleVariant = "modern") {
    const props = feature?.properties || {};
    const areaSqKm = Math.max(0, Number(props.area_sqkm ?? props.AREA_SQKM ?? 0));
    const scalerank = clamp(
      Math.round(Number(props.scalerank ?? props.SCALERANK ?? 8)) || 8,
      1,
      10
    );
    const areaScore = clamp(Math.log10(areaSqKm + 1) / 3.45, 0, 1.1);
    const rankScore = clamp((9 - scalerank) / 7, 0, 1.12);
    const metroBoost = areaSqKm >= 1500 ? 0.18 : areaSqKm >= 700 ? 0.08 : 0;

    if (styleVariant === "historical_1930s") {
      const keep = scalerank <= 5 || areaSqKm >= 220;
      if (!keep) return 0;
      return clamp((areaScore * 0.55) + (rankScore * 0.72) + metroBoost, 0.12, 0.92);
    }

    return clamp((areaScore * 0.62) + (rankScore * 0.78) + metroBoost, 0.08, 1.18);
  }

  function getModernCityLightsProjectionKey() {
    const projection = getProjection();
    if (!projection) return "";
    const scale = Number(projection.scale?.() || 0).toFixed(4);
    const translate = projection.translate?.() || [0, 0];
    const center = projection.center?.() || [0, 0];
    const rotate = projection.rotate?.() || [0, 0, 0];
    return [
      runtimeState.width || 0,
      runtimeState.height || 0,
      scale,
      ...translate.map((value) => Number(value || 0).toFixed(2)),
      ...center.map((value) => Number(value || 0).toFixed(2)),
      ...rotate.map((value) => Number(value || 0).toFixed(2)),
    ].join("|");
  }

  function getModernCityLightsGridValue(x, y) {
    const wrappedX = ((Math.round(x) % MODERN_CITY_LIGHTS_GRID_WIDTH) + MODERN_CITY_LIGHTS_GRID_WIDTH)
      % MODERN_CITY_LIGHTS_GRID_WIDTH;
    const clampedY = clamp(Math.round(y), 0, MODERN_CITY_LIGHTS_GRID_HEIGHT - 1);
    return MODERN_CITY_LIGHTS_GRID[(clampedY * MODERN_CITY_LIGHTS_GRID_WIDTH) + wrappedX] || 0;
  }
  
  function getModernCityLightsNormalizationDenominator() {
    const p90 = Number(MODERN_CITY_LIGHTS_STATS?.p90 ?? MODERN_CITY_LIGHTS_STATS?.p90_nonzero ?? 0);
    if (Number.isFinite(p90) && p90 > 0) {
      return Math.max(20, p90 * 0.35);
    }
    const maxValue = Number(MODERN_CITY_LIGHTS_STATS?.max ?? 255);
    if (Number.isFinite(maxValue) && maxValue > 0) {
      return Math.max(20, maxValue * 0.25);
    }
    return 255;
  }
  
  function normalizeModernCityLightsValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    const maximum = Number(MODERN_CITY_LIGHTS_STATS?.max);
    const maxValue = Number.isFinite(maximum) && maximum > 0 ? maximum : 255;
    const exposure = getModernCityLightsNormalizationDenominator();
    // Preserve the bright end instead of clipping every value above p90 * 0.82.
    return Math.log1p(Math.min(parsed, maxValue) / exposure) / Math.log1p(maxValue / exposure);
  }

  function getModernCityLightsCells() {
    if (modernCityLightsCells) return modernCityLightsCells;
    const cells = [];
    for (let y = 0; y < MODERN_CITY_LIGHTS_GRID_HEIGHT; y += 1) {
      for (let x = 0; x < MODERN_CITY_LIGHTS_GRID_WIDTH; x += 1) {
        const index = y * MODERN_CITY_LIGHTS_GRID_WIDTH + x;
        const value = MODERN_CITY_LIGHTS_GRID[index] || 0;
        if (value <= 0 || value < MODERN_CITY_LIGHTS_BASE_THRESHOLD) continue;
        const neighbors = new Set();
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = (x + dx + MODERN_CITY_LIGHTS_GRID_WIDTH) % MODERN_CITY_LIGHTS_GRID_WIDTH;
            const ny = clamp(y + dy, 0, MODERN_CITY_LIGHTS_GRID_HEIGHT - 1);
            const neighborIndex = ny * MODERN_CITY_LIGHTS_GRID_WIDTH + nx;
            const neighborValue = MODERN_CITY_LIGHTS_GRID[neighborIndex] || 0;
            if (neighborIndex !== index && neighborValue > 0 && neighborValue >= MODERN_CITY_LIGHTS_BASE_THRESHOLD) {
              neighbors.add(neighborIndex);
            }
          }
        }
        cells.push({
          gridX: x, gridY: y, value,
          lon: -180 + ((x + 0.5) * MODERN_CITY_LIGHTS_STEP_LON_DEG),
          lat: 90 - ((y + 0.5) * MODERN_CITY_LIGHTS_STEP_LAT_DEG),
          normalized: normalizeModernCityLightsValue(value),
          neighborCount: neighbors.size,
        });
      }
    }
    modernCityLightsCells = cells;
    return cells;
  }
  
  function sampleModernCityLightsGridNormalized(lon, lat) {
    if (!MODERN_CITY_LIGHTS_GRID?.length) return 0;
    const normalizedLon = (
      (normalizeLongitude(lon) + 180) / Math.max(MODERN_CITY_LIGHTS_STEP_LON_DEG, 0.0001)
    ) - 0.5;
    const normalizedLat = clamp(
      ((90 - clamp(lat, -89.999, 89.999)) / Math.max(MODERN_CITY_LIGHTS_STEP_LAT_DEG, 0.0001)) - 0.5,
      0,
      MODERN_CITY_LIGHTS_GRID_HEIGHT - 1
    );
    const x0 = Math.floor(normalizedLon);
    const y0 = Math.floor(normalizedLat);
    const tx = normalizedLon - x0;
    const ty = normalizedLat - y0;
    const y1 = Math.min(MODERN_CITY_LIGHTS_GRID_HEIGHT - 1, y0 + 1);
    const v00 = getModernCityLightsGridValue(x0, y0);
    const v10 = getModernCityLightsGridValue(x0 + 1, y0);
    const v01 = getModernCityLightsGridValue(x0, y1);
    const v11 = getModernCityLightsGridValue(x0 + 1, y1);
    const top = v00 + ((v10 - v00) * tx);
    const bottom = v01 + ((v11 - v01) * tx);
    return normalizeModernCityLightsValue(top + ((bottom - top) * ty));
  }
  
  function getModernCityLightsGeometry() {
    const projection = getProjection();
    const projectionKey = getModernCityLightsProjectionKey();
    if (
      modernCityLightsGeometryCache.projectionKey === projectionKey &&
      Array.isArray(modernCityLightsGeometryCache.baseEntries) &&
      modernCityLightsGeometryCache.initialized
    ) {
      return modernCityLightsGeometryCache;
    }
  
    const baseEntries = [];
    const corridorEntries = [];
    const halfLon = MODERN_CITY_LIGHTS_STEP_LON_DEG * 0.5;
    const halfLat = MODERN_CITY_LIGHTS_STEP_LAT_DEG * 0.5;
  
    for (const cell of getModernCityLightsCells()) {
      const { lon, lat, value } = cell;
      const center = projection ? projection([lon, lat]) : null;
      const east = projection ? projection([normalizeLongitude(lon + halfLon), lat]) : null;
      const west = projection ? projection([normalizeLongitude(lon - halfLon), lat]) : null;
      const north = projection ? projection([lon, clamp(lat + halfLat, -89.999, 89.999)]) : null;
      const south = projection ? projection([lon, clamp(lat - halfLat, -89.999, 89.999)]) : null;
      if (
        !Array.isArray(center) ||
        !Array.isArray(east) ||
        !Array.isArray(west) ||
        !Array.isArray(north) ||
        !Array.isArray(south)
      ) {
        continue;
      }
      const values = [...center, ...east, ...west, ...north, ...south];
      if (!values.every((entry) => Number.isFinite(Number(entry)))) continue;
  
      const ewDx = east[0] - west[0];
      const ewDy = east[1] - west[1];
      const nsDx = north[0] - south[0];
      const nsDy = north[1] - south[1];
      const rx = Math.hypot(ewDx, ewDy) * 0.5;
      const ry = Math.hypot(nsDx, nsDy) * 0.5;
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0.02 || ry <= 0.02 || rx > 12 || ry > 12) {
        continue;
      }
      const aspectRatio = Math.max(rx, ry) / Math.max(Math.min(rx, ry), 0.01);
      if (aspectRatio > 3.5) continue;
      const maxRadius = Math.min(rx, ry) * 2.2;
      const clampedRx = Math.min(rx, maxRadius);
      const clampedRy = Math.min(ry, maxRadius);
  
      const entry = {
        ...cell,
        x: center[0],
        y: center[1],
        rx: clampedRx,
        ry: clampedRy,
        rotation: Math.atan2(ewDy, ewDx),
      };
      baseEntries.push(entry);
      if (value >= MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD) {
        corridorEntries.push(entry);
      }
    }
  
    modernCityLightsGeometryCache.projectionKey = projectionKey;
    modernCityLightsGeometryCache.baseEntries = baseEntries;
    modernCityLightsGeometryCache.corridorEntries = corridorEntries;
    modernCityLightsGeometryCache.initialized = true;
    return modernCityLightsGeometryCache;
  }
  
  function shouldCullModernLightEntry(entry, overscan = 48) {
    const transform = getZoomTransform();
    const screenX = (entry.x * transform.k) + transform.x;
    const screenY = (entry.y * transform.k) + transform.y;
    return (
      screenX < -overscan ||
      screenX > runtimeState.width + overscan ||
      screenY < -overscan ||
      screenY > runtimeState.height + overscan
    );
  }
  
  function drawLightEllipse(x, y, rx, ry, rotation = 0) {
    const context = getContext();
    if (!context) return;
    if (typeof context.ellipse === "function") {
      context.beginPath();
      context.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(Math.max(rx, 0.0001), Math.max(ry, 0.0001));
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  
  function getLightBlobRgb(color) {
    const normalized = ColorManager.normalizeHexColor(color);
    const rgb = normalized ? ColorManager.hexToRgb(normalized) : null;
    if (rgb) return rgb;
    return { r: 255, g: 255, b: 255 };
  }
  
  function toRgbaString(rgb, alpha = 1) {
    const resolvedAlpha = clamp(Number(alpha) || 0, 0, 1);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedAlpha})`;
  }

  function getLightBlobSprite(rgb, innerStop, midStop, innerAlphaScale, midAlphaScale) {
    // Position, radius and opacity are intentionally absent: all lights sharing a
    // profile reuse one bitmap, including after a pan or a brightness adjustment.
    const key = [rgb.r, rgb.g, rgb.b, innerStop, midStop, innerAlphaScale, midAlphaScale].join(":");
    const cached = lightBlobSpriteCache.get(key);
    if (cached) return cached;
    const canvas = createCanvas(LIGHT_BLOB_SPRITE_SIZE, LIGHT_BLOB_SPRITE_SIZE, getContext());
    const spriteContext = canvas?.getContext?.("2d");
    if (!spriteContext) return null;
    canvas.width = LIGHT_BLOB_SPRITE_SIZE;
    canvas.height = LIGHT_BLOB_SPRITE_SIZE;
    const radius = LIGHT_BLOB_SPRITE_SIZE / 2;
    const gradient = spriteContext.createRadialGradient(radius, radius, 0, radius, radius, radius);
    gradient.addColorStop(0, toRgbaString(rgb, innerAlphaScale));
    gradient.addColorStop(innerStop, toRgbaString(rgb, Math.max(innerAlphaScale, midAlphaScale)));
    gradient.addColorStop(midStop, toRgbaString(rgb, midAlphaScale));
    gradient.addColorStop(1, toRgbaString(rgb, 0));
    spriteContext.fillStyle = gradient;
    spriteContext.fillRect(0, 0, canvas.width, canvas.height);
    if (lightBlobSpriteCache.size >= LIGHT_BLOB_SPRITE_LIMIT) {
      lightBlobSpriteCache.delete(lightBlobSpriteCache.keys().next().value);
    }
    lightBlobSpriteCache.set(key, canvas);
    if (modernCityLightsDrawStats) modernCityLightsDrawStats.spriteBuilds += 1;
    return canvas;
  }
  
  function drawSoftLightBlob(
    x,
    y,
    rx,
    ry,
    {
      rotation = 0,
      rgb = { r: 255, g: 255, b: 255 },
      alpha = 1,
      innerStop = 0.1,
      midStop = 0.5,
      innerAlphaScale = 0.88,
      midAlphaScale = 0.28,
    } = {},
  ) {
    const context = getContext();
    if (!context) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const resolvedRx = Math.max(Number(rx) || 0, 0.0001);
    const resolvedRy = Math.max(Number(ry) || 0, 0.0001);
    const resolvedAlpha = clamp(Number(alpha) || 0, 0, 1);
    if (resolvedAlpha <= 0.0001) return;
    if (modernCityLightsDrawStats) modernCityLightsDrawStats.blobs += 1;

    const sprite = getLightBlobSprite(
      rgb,
      clamp(Number(innerStop) || 0.1, 0.01, 0.92),
      clamp(Number(midStop) || 0.5, 0.08, 0.97),
      innerAlphaScale,
      midAlphaScale,
    );
    if (sprite) {
      context.save();
      try {
        context.globalAlpha *= resolvedAlpha;
        if (rotation) {
          context.translate(x, y);
          context.rotate(rotation);
          context.drawImage(sprite, -resolvedRx, -resolvedRy, resolvedRx * 2, resolvedRy * 2);
        } else {
          context.drawImage(sprite, x - resolvedRx, y - resolvedRy, resolvedRx * 2, resolvedRy * 2);
        }
      } finally {
        context.restore();
      }
      return;
    }
  
    context.save();
    context.translate(x, y);
    context.rotate(Number(rotation) || 0);
    context.scale(resolvedRx, resolvedRy);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, toRgbaString(rgb, resolvedAlpha * innerAlphaScale));
    gradient.addColorStop(
      clamp(Number(innerStop) || 0.1, 0.01, 0.92),
      toRgbaString(rgb, resolvedAlpha * Math.max(innerAlphaScale, midAlphaScale)),
    );
    gradient.addColorStop(
      clamp(Number(midStop) || 0.5, 0.08, 0.97),
      toRgbaString(rgb, resolvedAlpha * midAlphaScale),
    );
    gradient.addColorStop(1, toRgbaString(rgb, 0));
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  
  function getModernCityLightsZoomProfile() {
    const zoomScale = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1));
    const fadeT = clamp((zoomScale - 1) / 2.5, 0, 1);
    const detailT = clamp((zoomScale - 0.9) / 1.6, 0, 1);
    return {
      zoomScale,
      fadeT,
      detailT,
      // Zoom reveals the same illumination; it must not act as extra exposure.
      textureAlphaScale: 1 - (fadeT * 0.18),
      textureRadiusScale: 1,
      coreAlphaScale: 1,
      coreRadiusScale: 1,
    };
  }
  
  const DEFAULT_MODERN_DAY_NIGHT_CONFIG = normalizeDayNightStyleConfig({});
  
  function getModernDayNightNumber(config, key) {
    const parsed = Number(config?.[key]);
    return Number.isFinite(parsed) ? parsed : DEFAULT_MODERN_DAY_NIGHT_CONFIG[key];
  }
  
  function isModernPopulationBoostEnabled(config) {
    return config?.cityLightsPopulationBoostEnabled === undefined
      ? DEFAULT_MODERN_DAY_NIGHT_CONFIG.cityLightsPopulationBoostEnabled
      : !!config.cityLightsPopulationBoostEnabled;
  }
  
  function getModernPopulationBoostStrength(config) {
    if (!isModernPopulationBoostEnabled(config)) return 0;
    return clamp(getModernDayNightNumber(config, "cityLightsPopulationBoostStrength"), 0, 1.5);
  }
  
  function getModernCityLightsPopulationBoostData() {
    const cityCollection = getEffectiveCityCollection();
    const urbanCollection = MODERN_CITY_LIGHTS_URBAN_AREAS || runtimeState.urbanData;
    const cityLayerRevision = Number(runtimeState.cityLayerRevision || 0);
    const scenarioId = String(runtimeState.activeScenarioId || "");
    if (
      modernCityLightsPopulationBoostCache.cityCollection === cityCollection
      && modernCityLightsPopulationBoostCache.urbanCollection === urbanCollection
      && modernCityLightsPopulationBoostCache.cityLayerRevision === cityLayerRevision
      && modernCityLightsPopulationBoostCache.scenarioId === scenarioId
    ) {
      return modernCityLightsPopulationBoostCache;
    }
  
    const urbanIndex = getUrbanCityPolicyOwner().getUrbanFeatureIndex();
    const urbanEntriesById = new Map();
    const unmatchedCityEntries = [];
    if (Array.isArray(cityCollection?.features)) {
      const features = cityCollection.features;
      for (let featureIndex = 0, featureCount = features.length; featureIndex < featureCount; featureIndex += 1) {
        if (!(featureIndex in features)) continue;
        const feature = features[featureIndex];
        const props = feature?.properties || {};
        const population = Math.max(0, Number(props.__city_population || 0));
        const capitalScore = getCityCapitalScore(feature);
        const globalUrbanFeature = globalUrbanByCityId.get(getCityCanonicalId(feature));
        const urbanInfo = MODERN_CITY_LIGHTS_URBAN_AREAS
          ? { hasUrbanMatch: !!globalUrbanFeature, urbanMatchId: globalUrbanFeature?.properties?.id, urbanFeature: globalUrbanFeature }
          : getUrbanCityPolicyOwner().getCityUrbanRuntimeInfo(feature, urbanIndex);
        if (urbanInfo.hasUrbanMatch) {
          const current = urbanEntriesById.get(urbanInfo.urbanMatchId) || {
            urbanId: urbanInfo.urbanMatchId,
            urbanFeature: urbanInfo.urbanFeature,
            populationSum: 0,
            cityCount: 0,
            capitalScore: 0,
          };
          current.populationSum += population;
          current.cityCount += 1;
          current.capitalScore = Math.max(current.capitalScore, capitalScore);
          urbanEntriesById.set(urbanInfo.urbanMatchId, current);
          continue;
        }
        if (capitalScore > 0 || population >= 150000) {
          unmatchedCityEntries.push({
            feature,
            population,
            capitalScore,
          });
        }
      }
    }
  
    const urbanEntries = Array.from(urbanEntriesById.values())
      .map((entry) => {
        const areaSqKm = Math.max(
          0.01,
          Number(entry.urbanFeature?.properties?.area_sqkm ?? entry.urbanFeature?.properties?.AREA_SQKM ?? 0.01)
        );
        return {
          ...entry,
          areaSqKm,
          density: entry.populationSum / areaSqKm,
        };
      })
      .filter((entry) => entry.populationSum >= 100000 || entry.capitalScore > 0)
      .sort((left, right) => (
        (right.populationSum + (right.density * 1200))
        - (left.populationSum + (left.density * 1200))
      ));
  
    unmatchedCityEntries.sort((left, right) => (
      (right.population + (right.capitalScore * 1_000_000))
      - (left.population + (left.capitalScore * 1_000_000))
    ));
  
    modernCityLightsPopulationBoostCache.cityCollection = cityCollection;
    modernCityLightsPopulationBoostCache.urbanCollection = urbanCollection;
    modernCityLightsPopulationBoostCache.cityLayerRevision = cityLayerRevision;
    modernCityLightsPopulationBoostCache.scenarioId = scenarioId;
    modernCityLightsPopulationBoostCache.urbanEntries = urbanEntries;
    modernCityLightsPopulationBoostCache.cityEntries = unmatchedCityEntries;
    modernCityLightsPopulationBoostCache.urbanByFeature = new Map(urbanEntries.map((entry) => [entry.urbanFeature, entry]));
    modernCityLightsPopulationBoostCache.cityByFeature = new Map(unmatchedCityEntries.map((entry) => [entry.feature, entry]));
    return modernCityLightsPopulationBoostCache;
  }

  function getModernPopulationCoreGain(feature, config, urban = false) {
    const strength = getModernPopulationBoostStrength(config);
    if (strength <= 0) return 1;
    const data = getModernCityLightsPopulationBoostData();
    const entry = (urban ? data.urbanByFeature : data.cityByFeature).get(feature);
    if (!entry) return 1;
    const population = urban ? entry.populationSum : entry.population;
    const populationScore = clamp(Math.log10(population + 1) / 7.35, 0, 1);
    const densityScore = urban ? clamp(Math.log10(entry.density + 1) / 4.4, 0, 1) : 0;
    return 1 + strength * (populationScore * 0.3 + densityScore * 0.15 + Math.min(3, entry.capitalScore) * 0.025);
  }

  function getSoftLightAlpha(value, maximum) {
    // Leave headroom for population/exposure controls even in the brightest cities.
    return maximum * -Math.expm1(-Math.max(0, value) / maximum);
  }
  
  function getSignedHashUnit(seed) {
    return (((stringHash(seed) >>> 0) % 2001) / 1000) - 1;
  }
  
  function getModernCityLightLatitudeFade(gridY) {
    const cellLat = 90 - ((gridY + 0.5) * MODERN_CITY_LIGHTS_STEP_LAT_DEG);
    const absLat = Math.abs(cellLat);
    if (absLat <= 72) return 1;
    return clamp(1 - ((absLat - 72) / 16), 0.15, 1);
  }
  
  function drawModernCityLightsTexture(config, intensity) {
    const textureOpacity = clamp(getModernDayNightNumber(config, "cityLightsTextureOpacity"), 0, 1);
    const corridorStrength = clamp(getModernDayNightNumber(config, "cityLightsCorridorStrength"), 0, 1);
    if (textureOpacity <= 0 && corridorStrength <= 0) return;
    const geometry = getModernCityLightsGeometry();
    const zoomProfile = getModernCityLightsZoomProfile();
    const textureRgb = getLightBlobRgb(getNightLightPalette("modern").texture);
    const overscan = Math.max(32, Math.min(runtimeState.width, runtimeState.height) * 0.06);

    geometry.baseEntries.forEach((entry) => {
      // Include the footprint when culling broad splats near a viewport edge.
      const radiusScale = 2.1 * zoomProfile.textureRadiusScale;
      const footprint = Math.max(entry.rx, entry.ry) * radiusScale * zoomProfile.zoomScale;
      if (shouldCullModernLightEntry(entry, Math.max(overscan, footprint))) return;
      const normalized = entry.normalized;
      const connected = clamp((entry.neighborCount - 1) / 5, 0, 1);
      const corridorWeight = entry.value >= MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD
        ? connected * Math.pow(normalized, 2)
        : 0;
      // Overlapping, geographically fixed kernels reconstruct a continuous field.
      // Corridor contrast belongs to that field, not a second grid of bright dots.
      const fieldAlpha = textureOpacity * Math.pow(normalized, 1.15) * 0.3
        + corridorStrength * corridorWeight * 0.1;
      const alpha = clamp(
        intensity * fieldAlpha * zoomProfile.textureAlphaScale
          * getModernCityLightLatitudeFade(entry.gridY)
          * getUrbanGlowMultiplierAt(entry.lon, entry.lat),
        0, 0.42,
      );
      if (alpha <= 0.002) return;
      drawSoftLightBlob(entry.x, entry.y, entry.rx * radiusScale, entry.ry * radiusScale, {
        rotation: entry.rotation,
        rgb: textureRgb,
        alpha,
        innerStop: 0.04,
        midStop: 0.5,
        innerAlphaScale: 1,
        midAlphaScale: 0.28,
      });
    });
  }

  function collectModernUrbanCoreEntries(k, config, intensity) {
    const pathCanvas = getPathCanvas();
    if (!pathCanvas) return [];
    const urbanCollection = MODERN_CITY_LIGHTS_URBAN_AREAS || runtimeState.urbanData;
    if (!Array.isArray(urbanCollection?.features) || !urbanCollection.features.length) return [];
    const textureOpacity = clamp(getModernDayNightNumber(config, "cityLightsTextureOpacity"), 0, 1);
    const coreSharpness = clamp(getModernDayNightNumber(config, "cityLightsCoreSharpness"), 0, 1);
    const textureOpacityScale = 0.32 + (textureOpacity * 0.68);
    const transform = getZoomTransform();
    const zoomProfile = getModernCityLightsZoomProfile();
    const zoomScale = Math.max(0.0001, Number(transform?.k || 1));
    const minProjectedAreaPx = zoomScale <= 1.15 ? 4.6 : zoomScale <= 1.7 ? 3.2 : 2.2;
    const overscan = Math.max(32, Math.min(runtimeState.width, runtimeState.height) * 0.06);
    const entries = [];
  
    const features = urbanCollection.features;
    for (let featureIndex = 0, featureCount = features.length; featureIndex < featureCount; featureIndex += 1) {
      if (!(featureIndex in features)) continue;
      const feature = features[featureIndex];
      if (!pathBoundsInScreen(feature)) continue;
      const projectedArea = estimateProjectedAreaPx(feature, k);
      if (projectedArea < minProjectedAreaPx) continue;
      // The global asset restores resolvable shapes; existing city points already
      // represent subpixel settlements without another layer of bright speckles.
      if (MODERN_CITY_LIGHTS_URBAN_AREAS && projectedArea <= 16) continue;
  
      const heuristicWeight = getUrbanLightWeight(feature, "modern");
      if (heuristicWeight <= 0) continue;
      if (zoomScale <= 1.15 && heuristicWeight < 0.72) continue;
  
      const geographicCentroid = feature.properties?.anchor || getFeatureGeoCentroid(feature);
      const sample = geographicCentroid
        ? sampleModernCityLightsGridNormalized(geographicCentroid[0], geographicCentroid[1])
        : 0;
      const glowMultiplier = geographicCentroid
        ? getUrbanGlowMultiplierAt(geographicCentroid[0], geographicCentroid[1])
        : 1;
      const sampledBoost = clamp(0.56 + (Math.pow(sample, 0.52) * 1.4), 0.8, 1.8);
      const weight = clamp(heuristicWeight * sampledBoost * glowMultiplier, 0.06, 1.4);
      if (sample <= 0.01 && heuristicWeight < 0.34) continue;
      if (weight < 0.16) continue;
      if (zoomScale <= 1.35 && weight < 0.44) continue;
  
      const centroid = feature.properties?.anchor
        ? getProjection()?.(feature.properties.anchors?.[0] || feature.properties.anchor)
        : pathCanvas.centroid(feature);
      const cx = Number(centroid?.[0]);
      const cy = Number(centroid?.[1]);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
  
      const screenX = (cx * transform.k) + transform.x;
      const screenY = (cy * transform.k) + transform.y;
      const shapeT = clamp((Math.sqrt(projectedArea) - 4) / 8, 0, 1);
      const shapePath = shapeT > 0 ? getProjectedGeographicPath(feature) : null;
      const shapeBlend = shapePath ? shapeT * shapeT * (3 - 2 * shapeT) : 0;
      // A visible arm of a large city remains visible even when its anchor is offscreen.
      if (!shapeBlend && (
        screenX < -overscan ||
        screenX > runtimeState.width + overscan ||
        screenY < -overscan ||
        screenY > runtimeState.height + overscan
      )) {
        continue;
      }
  
      const identitySeed = String(
        feature?.properties?.nameascii ||
        feature?.properties?.name ||
        feature?.properties?.NAME ||
        feature?.id ||
        `${cx}:${cy}`
      );
      const orientation = getSignedHashUnit(`${identitySeed}:rotation`) * (Math.PI / 60);
      const baseRadiusPx = 0.88 + (weight * (1.1 + (coreSharpness * 0.82)));
      const aspectRatio = clamp(1.04 + (coreSharpness * 0.06) + (sample * 0.06), 1.04, 1.18);
      const populationGain = getModernPopulationCoreGain(feature, config, true);
      const haloAlpha = getSoftLightAlpha(
        intensity * weight * populationGain * (0.10 + (textureOpacity * 0.12) + (sample * 0.16) + ((1 - coreSharpness) * 0.04)) * zoomProfile.coreAlphaScale,
        0.4
      );
      const coreAlpha = getSoftLightAlpha(
        intensity * weight * populationGain * textureOpacityScale * (0.22 + (coreSharpness * 0.32) + (sample * 0.24)) * zoomProfile.coreAlphaScale,
        0.7
      );
      entries.push({
        feature,
        cx,
        cy,
        screenX,
        screenY,
        weight,
        sample,
        orientation,
        baseRadiusPx,
        aspectRatio,
        haloAlpha,
        coreAlpha,
        shapePath,
        shapeBlend,
      });
    }
    return entries;
  }

  function drawModernUrbanShapes(entries, palette) {
    const shapedEntries = entries.filter((entry) => entry.shapeBlend > 0);
    if (!shapedEntries.length) return;
    const context = getContext();
    const width = context.canvas.width;
    const height = context.canvas.height;
    // One shared, CSS-resolution surface softens the boundary during upsampling.
    // No per-city blur, readback, or bitmap allocation on the cached frame path.
    const ratio = Math.min(1, 0.75 / Math.max(1, Number(runtimeState.dpr || 1)));
    const maskWidth = Math.max(1, Math.ceil(width * ratio));
    const maskHeight = Math.max(1, Math.ceil(height * ratio));
    urbanShapeCanvas ||= createCanvas(maskWidth, maskHeight, context);
    const maskContext = urbanShapeCanvas?.getContext?.("2d");
    if (!maskContext) return;
    if (urbanShapeCanvas.width !== maskWidth) urbanShapeCanvas.width = maskWidth;
    if (urbanShapeCanvas.height !== maskHeight) urbanShapeCanvas.height = maskHeight;
    maskContext.setTransform(1, 0, 0, 1, 0, 0);
    maskContext.clearRect(0, 0, maskWidth, maskHeight);
    const transform = getZoomTransform();
    const scaleX = maskWidth / Math.max(1, runtimeState.width);
    const scaleY = maskHeight / Math.max(1, runtimeState.height);
    maskContext.setTransform(scaleX * transform.k, 0, 0, scaleY * transform.k, scaleX * transform.x, scaleY * transform.y);
    const coreRgb = getLightBlobRgb(palette.core);
    withRenderTarget(maskContext, () => {
      shapedEntries.forEach((entry) => {
        const bounds = getProjectedFeatureBounds(entry.feature);
        const fallbackBounds = !bounds ? getPathCanvas()?.bounds?.(entry.feature) : null;
        const minX = bounds?.minX ?? fallbackBounds?.[0]?.[0];
        const minY = bounds?.minY ?? fallbackBounds?.[0]?.[1];
        const maxX = bounds?.maxX ?? fallbackBounds?.[1]?.[0];
        const maxY = bounds?.maxY ?? fallbackBounds?.[1]?.[1];
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
        maskContext.save();
        try {
          maskContext.globalCompositeOperation = "source-over";
          maskContext.globalAlpha = entry.coreAlpha * entry.shapeBlend * 0.06;
          maskContext.fillStyle = palette.halo;
          maskContext.fill(entry.shapePath, "evenodd");
          maskContext.clip(entry.shapePath, "evenodd");
          maskContext.globalAlpha = 1;
          const anchors = entry.feature.properties?.anchors;
          const points = Array.isArray(anchors) && anchors.length
            ? anchors.slice(0, 3).map((point) => getProjection()?.(point)).filter(Boolean)
            : [[entry.cx, entry.cy]];
          points.forEach((point) => drawSoftLightBlob(point[0], point[1],
            Math.max(2 / transform.k, (maxX - minX) * 0.65),
            Math.max(2 / transform.k, (maxY - minY) * 0.65), {
              rgb: coreRgb, alpha: entry.coreAlpha * entry.shapeBlend * 0.55 / Math.sqrt(points.length),
              innerStop: 0.04, midStop: 0.48, innerAlphaScale: 1, midAlphaScale: 0.30,
            }));
        } finally {
          maskContext.restore();
        }
        if (modernCityLightsDrawStats) modernCityLightsDrawStats.urbanShapes += 1;
      });
    });
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.imageSmoothingEnabled = true;
      context.drawImage(urbanShapeCanvas, 0, 0, width, height);
    } finally {
      context.restore();
    }
  }
  
  function drawModernCityLightsCores(k, config, _intensity, coreEntries = null) {
    const palette = getNightLightPalette("modern");
    const zoomProfile = getModernCityLightsZoomProfile();
    const haloRgb = getLightBlobRgb(palette.halo);
    const coreRgb = getLightBlobRgb(palette.core);
    const coreSharpness = clamp(getModernDayNightNumber(config, "cityLightsCoreSharpness"), 0, 1);
    const haloSpread = 1.35 - (coreSharpness * 0.2);
    const coreSpread = 1.25 - (coreSharpness * 0.22);
    const haloAlphaScale = 1 + ((1 - coreSharpness) * 0.2);
    const coreAlphaScale = 0.9 + (coreSharpness * 0.5);
    const coreInnerStop = 0.04 + ((1 - coreSharpness) * 0.06);
    const coreMidStop = 0.36 + ((1 - coreSharpness) * 0.18);
    const entries = Array.isArray(coreEntries) ? coreEntries : [];
    drawModernUrbanShapes(entries, palette);
    entries.forEach((entry) => {
      const pointAlpha = 1 - entry.shapeBlend * 0.7;
      drawSoftLightBlob(
        entry.cx,
        entry.cy,
        (entry.baseRadiusPx * entry.aspectRatio * 1.12 * haloSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        (entry.baseRadiusPx * 1.06 * haloSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        {
          rotation: entry.orientation,
          rgb: haloRgb,
          alpha: entry.haloAlpha * haloAlphaScale * pointAlpha,
          innerStop: 0.06 + ((1 - coreSharpness) * 0.04),
          midStop: 0.5 + ((1 - coreSharpness) * 0.16),
          innerAlphaScale: 0.94,
          midAlphaScale: 0.22 + ((1 - coreSharpness) * 0.12),
        }
      );
  
      drawSoftLightBlob(
        entry.cx,
        entry.cy,
        (entry.baseRadiusPx * entry.aspectRatio * 0.94 * coreSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        (entry.baseRadiusPx * 0.88 * coreSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        {
          rotation: entry.orientation,
          rgb: coreRgb,
          alpha: entry.coreAlpha * coreAlphaScale * pointAlpha,
          innerStop: coreInnerStop,
          midStop: coreMidStop,
          innerAlphaScale: 1,
          midAlphaScale: 0.34 + (coreSharpness * 0.18),
        }
      );
    });
  }
  
  function drawModernCityFallbackLights(k, config, intensity, urbanCoreEntries = []) {
    const cityCollection = getEffectiveCityCollection();
    if (!Array.isArray(cityCollection?.features) || !cityCollection.features.length) return;
    const palette = getNightLightPalette("modern");
    const coreSharpness = clamp(getModernDayNightNumber(config, "cityLightsCoreSharpness"), 0, 1);
    const textureOpacity = clamp(getModernDayNightNumber(config, "cityLightsTextureOpacity"), 0, 1);
    const textureOpacityScale = 0.32 + (textureOpacity * 0.68);
    const zoomProfile = getModernCityLightsZoomProfile();
    const haloRgb = getLightBlobRgb(palette.halo);
    const coreRgb = getLightBlobRgb(palette.core);
    const zoomScale = Math.max(0.0001, Number(runtimeState.zoomTransform?.k || 1));
    const overscan = Math.max(28, Math.min(runtimeState.width, runtimeState.height) * 0.05);
    const urbanIndex = getUrbanCityPolicyOwner().getUrbanFeatureIndex();
    const minPopulation = zoomScale <= 1.1 ? 60000 : zoomScale <= 1.8 ? 30000 : 15000;
    const visibleUrbanCityIds = new Set(urbanCoreEntries.flatMap((entry) => entry.feature.properties?.city_ids || []));
  
    const features = cityCollection.features;
    for (let featureIndex = 0, featureCount = features.length; featureIndex < featureCount; featureIndex += 1) {
      if (!(featureIndex in features)) continue;
      const feature = features[featureIndex];
      const props = feature?.properties || {};
      const population = Math.max(0, Number(props.__city_population || 0));
      const isCapital = !!props.__city_is_country_capital;
      if (!isCapital && population < minPopulation) continue;
      if (visibleUrbanCityIds.has(getCityCanonicalId(feature))) continue;
      if (!MODERN_CITY_LIGHTS_URBAN_AREAS && getUrbanCityPolicyOwner().getCityUrbanRuntimeInfo(feature, urbanIndex).hasUrbanMatch) continue;
      const anchor = getCityAnchor(feature);
      const screenPoint = getCityScreenPoint(anchor);
      if (!anchor || !screenPoint) continue;
      if (
        screenPoint[0] < -overscan ||
        screenPoint[0] > runtimeState.width + overscan ||
        screenPoint[1] < -overscan ||
        screenPoint[1] > runtimeState.height + overscan
      ) {
        continue;
      }
      const overlapsUrbanCore = urbanCoreEntries.some((entry) => (
        Math.hypot(entry.screenX - screenPoint[0], entry.screenY - screenPoint[1]) <= Math.max(18, entry.baseRadiusPx * 10)
      ));
      if (overlapsUrbanCore) continue;
  
      const populationScore = clamp(Math.log10(population + 1) / 6.5, 0.18, 1);
      const geographicCoords = getCityGeoCoordinates(feature);
      const sample = geographicCoords
        ? sampleModernCityLightsGridNormalized(geographicCoords[0], geographicCoords[1])
        : 0;
      const glowMultiplier = geographicCoords
        ? getUrbanGlowMultiplierAt(geographicCoords[0], geographicCoords[1])
        : 1;
      const weight = clamp(
        ((isCapital ? 0.46 : 0.28) + (populationScore * 0.52) + (sample * 0.44)) * glowMultiplier,
        0.2,
        1.12
      );
      if (zoomScale <= 1.1 && weight < 0.45) continue;
  
      const identitySeed = String(
        getCityCanonicalId(feature) ||
        props.name_en ||
        props.name ||
        feature?.id ||
        `${anchor[0]}:${anchor[1]}`
      );
      const orientation = getSignedHashUnit(`${identitySeed}:rotation`) * (Math.PI / 80);
      const baseRadiusPx = 0.58 + (weight * (0.82 + (coreSharpness * 0.46)));
      const aspectRatio = clamp(1.04 + (coreSharpness * 0.05) + (sample * 0.04), 1.04, 1.14);
      const haloSpread = 1.28 - (coreSharpness * 0.18);
      const coreSpread = 1.2 - (coreSharpness * 0.2);
      const haloAlphaScale = 1 + ((1 - coreSharpness) * 0.18);
      const coreAlphaScale = 0.9 + (coreSharpness * 0.48);
      const coreInnerStop = 0.04 + ((1 - coreSharpness) * 0.05);
      const coreMidStop = 0.36 + ((1 - coreSharpness) * 0.16);
      const populationGain = getModernPopulationCoreGain(feature, config);
      const haloAlpha = getSoftLightAlpha(
        intensity * weight * populationGain * (0.08 + (sample * 0.14) + ((1 - coreSharpness) * 0.04)) * zoomProfile.coreAlphaScale,
        0.30
      );
      const coreAlpha = getSoftLightAlpha(
        intensity * weight * populationGain * textureOpacityScale * (0.18 + (coreSharpness * 0.3) + (sample * 0.24)) * zoomProfile.coreAlphaScale,
        0.48
      );
  
      drawSoftLightBlob(
        anchor[0],
        anchor[1],
        (baseRadiusPx * aspectRatio * 1.14 * haloSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        (baseRadiusPx * 1.04 * haloSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        {
          rotation: orientation,
          rgb: haloRgb,
          alpha: haloAlpha * haloAlphaScale,
          innerStop: 0.05 + ((1 - coreSharpness) * 0.04),
          midStop: 0.48 + ((1 - coreSharpness) * 0.16),
          innerAlphaScale: 0.92,
          midAlphaScale: 0.22 + ((1 - coreSharpness) * 0.12),
        }
      );
  
      drawSoftLightBlob(
        anchor[0],
        anchor[1],
        (baseRadiusPx * aspectRatio * 0.98 * coreSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        (baseRadiusPx * 0.94 * coreSpread * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
        {
          rotation: orientation,
          rgb: coreRgb,
          alpha: coreAlpha * coreAlphaScale,
          innerStop: coreInnerStop,
          midStop: coreMidStop,
          innerAlphaScale: 1,
          midAlphaScale: 0.34 + (coreSharpness * 0.18),
        }
      );
    }
  }
  
  function getModernCityLightsStaticConfigSignature(config) {
    return stableJson({
      intensity: getModernDayNightNumber(config, "cityLightsIntensity").toFixed(3),
      textureOpacity: getModernDayNightNumber(config, "cityLightsTextureOpacity").toFixed(3),
      corridorStrength: getModernDayNightNumber(config, "cityLightsCorridorStrength").toFixed(3),
      coreSharpness: getModernDayNightNumber(config, "cityLightsCoreSharpness").toFixed(3),
      populationBoostEnabled: isModernPopulationBoostEnabled(config),
      populationBoostStrength: getModernDayNightNumber(config, "cityLightsPopulationBoostStrength").toFixed(3),
    });
  }
  
  function getModernCityLightsStaticLayerKey(config) {
    const context = getContext();
    const canvasWidth = Number(context?.canvas?.width || 0);
    const canvasHeight = Number(context?.canvas?.height || 0);
    const intensityFields = normalizeIntensityFieldsState(runtimeState.intensityFields);
    const urbanGlowRevision = Number(intensityFields?.channels?.urbanGlow?.revision || 0);
    return [
      canvasWidth,
      canvasHeight,
      Number(runtimeState.dpr || 1).toFixed(3),
      getTransformSignature(getZoomTransform()),
      getModernCityLightsProjectionKey(),
      runtimeState.activeScenarioId || "",
      runtimeState.topologyRevision || 0,
      runtimeState.contextLayerRevision || 0,
      runtimeState.cityLayerRevision || 0,
      `field:urbanGlow:${urbanGlowRevision}`,
      getModernCityLightsStaticConfigSignature(config),
    ].join("::");
  }
  
  function createModernCityLightsStaticLayerCanvas(width, height) {
    const context = getContext();
    const canvas = createCanvas(width, height, context);
    if (!canvas) return null;
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  
  function drawModernCityLightsStaticLayer(k, config, intensity) {
    const context = getContext();
    if (!context) return;
    context.save();
    try {
      context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");
      drawModernCityLightsTexture(config, intensity);
      const urbanCoreEntries = collectModernUrbanCoreEntries(k, config, intensity);
      drawModernCityLightsCores(k, config, intensity, urbanCoreEntries);
      drawModernCityFallbackLights(k, config, intensity, urbanCoreEntries);
    } finally {
      context.restore();
    }
  }
  
  function getModernCityLightsStaticLayerCanvas(k, config, intensity) {
    const context = getContext();
    const width = Number(context?.canvas?.width || 0);
    const height = Number(context?.canvas?.height || 0);
    if (width <= 0 || height <= 0) return null;
    const key = getModernCityLightsStaticLayerKey(config);
    if (
      modernCityLightsStaticLayerCache.key === key
      && modernCityLightsStaticLayerCache.canvas
      && modernCityLightsStaticLayerCache.width === width
      && modernCityLightsStaticLayerCache.height === height
    ) {
      recordRenderPerfMetric("modernCityLightsStaticLayerCache", 0, { hit: true, globalUrbanReady: !!MODERN_CITY_LIGHTS_URBAN_AREAS });
      return modernCityLightsStaticLayerCache.canvas;
    }
  
    const started = now();
    const canvas = modernCityLightsStaticLayerCache.canvas || createModernCityLightsStaticLayerCanvas(width, height);
    if (!canvas) return null;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const layerContext = canvas.getContext?.("2d");
    if (!layerContext) return null;
  
    const layout = getRenderPassLayout("dayNight");
    modernCityLightsDrawStats = { blobs: 0, spriteBuilds: 0, urbanShapes: 0 };
    const drawStats = modernCityLightsDrawStats;
    try {
      withRenderTarget(layerContext, () => {
        const layerK = prepareTargetContext(layerContext, runtimeState.zoomTransform, layout);
        drawModernCityLightsStaticLayer(layerK || k, config, intensity);
      });
    } finally {
      modernCityLightsDrawStats = null;
    }
    modernCityLightsStaticLayerCache.key = key;
    modernCityLightsStaticLayerCache.canvas = canvas;
    modernCityLightsStaticLayerCache.width = width;
    modernCityLightsStaticLayerCache.height = height;
    recordRenderPerfMetric("modernCityLightsStaticLayerCache", Math.max(0, now() - started), {
      hit: false, ...drawStats, spriteCacheSize: lightBlobSpriteCache.size, width, height,
      globalUrbanReady: !!MODERN_CITY_LIGHTS_URBAN_AREAS,
    });
    return canvas;
  }
  
  function getHistoricalCityLightsDensity(config) {
    const density = Number(config?.historicalCityLightsDensity);
    return clamp(Number.isFinite(density) ? density : 1.25, 0.75, 2);
  }

  function getHistoricalCityLightsSecondaryRetention(config) {
    const secondaryRetention = Number(config?.historicalCityLightsSecondaryRetention);
    return clamp(Number.isFinite(secondaryRetention) ? secondaryRetention : 0.55, 0, 1);
  }

  function interpolateHistoricalThreshold(strictValue, relaxedValue, secondaryRetention) {
    return strictValue + ((relaxedValue - strictValue) * secondaryRetention);
  }

  function getHistoricalCityLightCapitalBoost(capitalKind = "") {
    const normalizedKind = String(capitalKind || "").trim().toLowerCase();
    if (normalizedKind === "country_capital") return 0.16;
    if (normalizedKind === "admin_capital") return 0.08;
    return 0;
  }

  function sanitizeHistoricalCityLightEntry(rawEntry) {
    const lon = normalizeLongitude(Number(rawEntry?.lon));
    const lat = clamp(Number(rawEntry?.lat), -89.999, 89.999);
    const weight = clamp(Number(rawEntry?.weight), 0, 1.08);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || weight <= 0) {
      return null;
    }
    return {
      lon,
      lat,
      weight,
      capitalKind: String(rawEntry?.capitalKind || rawEntry?.capital_kind || "").trim().toLowerCase(),
      population: Math.max(0, Number(rawEntry?.population || 0)),
      nameAscii: String(rawEntry?.nameAscii || rawEntry?.name_ascii || rawEntry?.name || "").trim(),
    };
  }

  function shouldRenderHistoricalCityLightEntry(entry, secondaryRetention = 0) {
    const capitalKind = String(entry?.capitalKind || "").trim().toLowerCase();
    const population = Math.max(0, Number(entry?.population || 0));
    const weight = clamp(Number(entry?.weight || 0), 0, 1.08);
    if (capitalKind === "country_capital") {
      return true;
    }
    const normalizedRetention = clamp(Number(secondaryRetention) || 0, 0, 1);
    if (capitalKind === "admin_capital") {
      const adminPopulationThreshold = interpolateHistoricalThreshold(1000000, 700000, normalizedRetention);
      const adminWeightThreshold = interpolateHistoricalThreshold(0.7, 0.55, normalizedRetention);
      return population >= adminPopulationThreshold || weight >= adminWeightThreshold;
    }
    const cityPopulationThreshold = interpolateHistoricalThreshold(2200000, 1500000, normalizedRetention);
    const cityWeightThreshold = interpolateHistoricalThreshold(0.8, 0.65, normalizedRetention);
    return population >= cityPopulationThreshold || weight >= cityWeightThreshold;
  }

  function getHistoricalProxyAssetEntries(secondaryRetention = 0) {
    if (!Array.isArray(HISTORICAL_1930_CITY_LIGHTS_ENTRIES) || !HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length) {
      return [];
    }
    return HISTORICAL_1930_CITY_LIGHTS_ENTRIES
      .map(sanitizeHistoricalCityLightEntry)
      .filter((entry) => shouldRenderHistoricalCityLightEntry(entry, secondaryRetention))
      .filter(Boolean);
  }

  function computeHistoricalFallbackCityLightWeight(feature) {
    const props = feature?.properties || {};
    const population = Math.max(
      0,
      Number(
        props.__city_population
        ?? props.population
        ?? props.pop_max
        ?? props.POP_MAX
        ?? 0
      )
    );
    const isCountryCapital = !!(props.__city_is_country_capital ?? props.is_country_capital);
    const isAdminCapital = !!(props.__city_is_admin_capital ?? props.is_admin_capital);
    const baseTier = String(props.__city_base_tier || props.base_tier || "").trim().toLowerCase();
    const tierBoost = baseTier === "major" ? 0.1 : baseTier === "regional" ? 0.04 : 0;
    const scalerank = clamp(
      Math.round(Number(props.__city_scalerank ?? props.scalerank ?? props.SCALERANK ?? 8)) || 8,
      1,
      10
    );
    const rankBoost = scalerank <= 3 ? 0.06 : 0;
    const populationScore = clamp(Math.log10(population + 1) / 7.1, 0.16, 1);
    const capitalBoost = isCountryCapital ? 0.34 : isAdminCapital ? 0.2 : 0;
    return clamp((populationScore * 0.74) + capitalBoost + tierBoost + rankBoost, 0.18, 1.02);
  }

  function shouldIncludeHistoricalFallbackCity(feature, secondaryRetention = 0) {
    const props = feature?.properties || {};
    const normalizedRetention = clamp(Number(secondaryRetention) || 0, 0, 1);
    if (!!(props.__city_is_country_capital ?? props.is_country_capital)) return true;
    const adminPopulation = Math.max(
      0,
      Number(
        props.__city_population
        ?? props.population
        ?? props.pop_max
        ?? props.POP_MAX
        ?? 0
      )
    );
    if (
      !!(props.__city_is_admin_capital ?? props.is_admin_capital)
      && adminPopulation >= interpolateHistoricalThreshold(2000000, 1200000, normalizedRetention)
    ) {
      return true;
    }
    const scalerank = clamp(
      Math.round(Number(props.__city_scalerank ?? props.scalerank ?? props.SCALERANK ?? 8)) || 8,
      1,
      10
    );
    if (scalerank <= 1) return true;
    const population = Math.max(
      0,
      Number(
        props.__city_population
        ?? props.population
        ?? props.pop_max
        ?? props.POP_MAX
        ?? 0
      )
    );
    const cityPopulationThreshold = interpolateHistoricalThreshold(4200000, 2400000, normalizedRetention);
    return population >= cityPopulationThreshold;
  }

  function getHistoricalProxyFallbackEntries(secondaryRetention = 0) {
    const cityCollection = getEffectiveCityCollection();
    const cityLayerRevision = Number(runtimeState.cityLayerRevision || 0);
    const scenarioId = String(runtimeState.activeScenarioId || "");
    const normalizedRetention = clamp(Number(secondaryRetention) || 0, 0, 1);
    if (
      historicalCityLightsFallbackCache.cityCollection === cityCollection
      && historicalCityLightsFallbackCache.cityLayerRevision === cityLayerRevision
      && historicalCityLightsFallbackCache.scenarioId === scenarioId
      && historicalCityLightsFallbackCache.secondaryRetention === normalizedRetention
    ) {
      return historicalCityLightsFallbackCache.entries;
    }

    const entries = Array.isArray(cityCollection?.features)
      ? cityCollection.features
        .filter((feature) => shouldIncludeHistoricalFallbackCity(feature, normalizedRetention))
        .map((feature) => {
          const coordinates = getCityGeoCoordinates(feature);
          if (!coordinates) return null;
          const props = feature?.properties || {};
          return sanitizeHistoricalCityLightEntry({
            lon: coordinates[0],
            lat: coordinates[1],
            weight: computeHistoricalFallbackCityLightWeight(feature),
            capitalKind: props.__city_capital_kind || props.capital_kind || "",
            population: props.__city_population ?? props.population ?? 0,
            nameAscii: props.name_ascii || props.__city_name_ascii || props.name_en || props.name || "",
          });
        })
        .filter((entry) => shouldRenderHistoricalCityLightEntry(entry, normalizedRetention))
        .filter(Boolean)
        .sort((left, right) => right.weight - left.weight)
      : [];

    historicalCityLightsFallbackCache.cityCollection = cityCollection;
    historicalCityLightsFallbackCache.cityLayerRevision = cityLayerRevision;
    historicalCityLightsFallbackCache.scenarioId = scenarioId;
    historicalCityLightsFallbackCache.secondaryRetention = normalizedRetention;
    historicalCityLightsFallbackCache.entries = entries;
    return entries;
  }

  function getHistoricalNightLightEntries(config) {
    const secondaryRetention = getHistoricalCityLightsSecondaryRetention(config);
    const assetEntries = getHistoricalProxyAssetEntries(secondaryRetention);
    if (assetEntries.length) {
      return assetEntries;
    }
    return getHistoricalProxyFallbackEntries(secondaryRetention);
  }

  function getHistoricalDerivedGlowEntries(historicalEntries, config) {
    if (!Array.isArray(historicalEntries) || !historicalEntries.length) return [];
    const projection = getProjection();
    const projectionKey = getModernCityLightsProjectionKey();
    const retention = getHistoricalCityLightsSecondaryRetention(config).toFixed(3);
    const first = historicalEntries[0];
    const last = historicalEntries[historicalEntries.length - 1];
    const key = [
      projectionKey,
      retention,
      historicalEntries.length,
      first?.nameAscii || "",
      first?.weight || 0,
      last?.nameAscii || "",
      last?.weight || 0,
    ].join("|");
    if (historicalCityLightsDerivedGlowCache.key === key) {
      return historicalCityLightsDerivedGlowCache.entries;
    }

    const entries = [];
    for (const entry of historicalEntries) {
      if (entries.length >= HISTORICAL_DERIVED_GLOW_MAX_ENTRIES) break;
      const weight = clamp(Number(entry?.weight || 0), 0, 1.08);
      if (weight < HISTORICAL_DERIVED_GLOW_MIN_WEIGHT) continue;
      const projected = projection ? projection([entry.lon, entry.lat]) : null;
      if (!Array.isArray(projected) || !projected.every((value) => Number.isFinite(Number(value)))) continue;
      entries.push({
        lon: entry.lon,
        lat: entry.lat,
        cx: Number(projected[0]),
        cy: Number(projected[1]),
        weight,
        rotation: (stringHash(entry.nameAscii || `${entry.lon}:${entry.lat}:derived`) % 180) * (Math.PI / 180),
      });
    }
    historicalCityLightsDerivedGlowCache.key = key;
    historicalCityLightsDerivedGlowCache.entries = entries;
    return entries;
  }

  function drawHistoricalDerivedGlowLayer(k, historicalEntries, config, intensity, density, palette) {
    const context = getContext();
    if (!context) return;
    const glowEntries = getHistoricalDerivedGlowEntries(historicalEntries, config);
    if (!glowEntries.length) return;
    const overscan = Math.max(28, Math.min(runtimeState.width, runtimeState.height) * 0.06);
    context.fillStyle = palette.halo;
    glowEntries.forEach((entry) => {
      const transform = getZoomTransform();
      const screenX = (entry.cx * transform.k) + transform.x;
      const screenY = (entry.cy * transform.k) + transform.y;
      if (
        screenX < -overscan ||
        screenX > runtimeState.width + overscan ||
        screenY < -overscan ||
        screenY > runtimeState.height + overscan
      ) {
        return;
      }
      const glowMultiplier = getUrbanGlowMultiplierAt(entry.lon, entry.lat);
      const glowRadiusPx = (1.1 + (entry.weight * 1.45 * glowMultiplier)) * density;
      context.globalAlpha = clamp(intensity * density * entry.weight * glowMultiplier * 0.036, 0, 0.085);
      drawLightEllipse(
        entry.cx,
        entry.cy,
        (glowRadiusPx * 1.75) / Math.max(0.0001, k),
        (glowRadiusPx * 0.82) / Math.max(0.0001, k),
        entry.rotation
      );
    });
  }

  function drawHistoricalNightLightsLayer(k, config, solarState) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas) return;
    const historicalEntries = getHistoricalNightLightEntries(config);
    if (!historicalEntries.length) {
      return;
    }
    const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
    if (!nightHemisphere) return;

    const variant = "historical_1930s";
    const intensity = clamp(getModernDayNightNumber(config, "cityLightsIntensity"), 0, 1.8);
    if (intensity <= 0) return;
    const density = getHistoricalCityLightsDensity(config);
    const palette = getNightLightPalette(variant);
    const projection = getProjection();
    const overscan = Math.max(24, Math.min(runtimeState.width, runtimeState.height) * 0.05);

    context.save();
    context.beginPath();
    pathCanvas(nightHemisphere);
    context.clip();
    context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");
    drawHistoricalDerivedGlowLayer(k, historicalEntries, config, intensity, density, palette);

    historicalEntries.forEach((entry) => {
      const projected = projection ? projection([entry.lon, entry.lat]) : null;
      if (!Array.isArray(projected) || !projected.every((value) => Number.isFinite(Number(value)))) return;
      const weight = clamp(Number(entry.weight || 0), 0, 1.08);
      if (weight <= 0) return;
      const glowMultiplier = getUrbanGlowMultiplierAt(entry.lon, entry.lat);

      const cx = Number(projected[0]);
      const cy = Number(projected[1]);

      const transform = getZoomTransform();
      const screenX = (cx * transform.k) + transform.x;
      const screenY = (cy * transform.k) + transform.y;
      if (
        screenX < -overscan ||
        screenX > runtimeState.width + overscan ||
        screenY < -overscan ||
        screenY > runtimeState.height + overscan
      ) {
        return;
      }

      const capitalBoost = getHistoricalCityLightCapitalBoost(entry.capitalKind);
      const baseRadiusPx = (0.52 + (weight * (0.68 + (capitalBoost * 0.28)))) * density;
      const haloRadiusPx = baseRadiusPx * (1.24 + (capitalBoost * 0.3));
      const haloAlphaMax = clamp(0.28 * density, 0, 0.48);
      const coreAlphaMax = clamp(0.52 * density, 0, 0.82);
      const haloAlpha = clamp(intensity * weight * glowMultiplier * 0.12 * density, 0, haloAlphaMax);
      const coreAlpha = clamp(intensity * weight * glowMultiplier * 0.22 * density, 0, coreAlphaMax);
      const orientation = (stringHash(
        entry.nameAscii ||
        `${entry.lon}:${entry.lat}`
      ) % 180) * (Math.PI / 180);

      context.fillStyle = palette.halo;
      context.globalAlpha = haloAlpha;
      drawLightEllipse(
        cx,
        cy,
        (haloRadiusPx * 1.04) / Math.max(0.0001, k),
        (haloRadiusPx * 0.78) / Math.max(0.0001, k),
        orientation
      );

      context.fillStyle = palette.core;
      context.globalAlpha = coreAlpha;
      drawLightEllipse(
        cx,
        cy,
        baseRadiusPx / Math.max(0.0001, k),
        (baseRadiusPx * 0.64) / Math.max(0.0001, k),
        orientation
      );
    });

    context.restore();
  }

  function drawNightLightsLayer(k, config, solarState) {
    if (!config?.cityLightsEnabled) {
      urbanShapeLoadAttempted = false;
      return;
    }
    const variant = String(config.cityLightsStyle || "modern").trim().toLowerCase();
    if (variant === "modern") {
      if (assetProvider && !assetProvider.isModernAssetsReady()) {
        if (!modernAssetLoadPromise) {
          modernAssetLoadPromise = assetProvider.ensureModernAssets()
            .then(() => onModernAssetsReady())
            .catch((error) => onModernAssetsError(error))
            .finally(() => {
              modernAssetLoadPromise = null;
            });
        }
        return;
      }
      if (assetProvider?.ensureUrbanShapeAssets && !assetProvider.isUrbanShapeAssetsReady() && !urbanShapeLoadAttempted) {
        urbanShapeLoadAttempted = true;
        assetProvider.ensureUrbanShapeAssets()
          .then(() => onModernAssetsReady())
          .catch((error) => onModernAssetsError(error));
      }
      drawModernNightLightsLayer(k, config, solarState);
      return;
    }
    urbanShapeLoadAttempted = false;
    drawHistoricalNightLightsLayer(k, config, solarState);
  }

  function drawModernNightLightsLayer(k, config, solarState) {
    const context = getContext();
    const pathCanvas = getPathCanvas();
    if (!context || !pathCanvas) return;
    const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
    if (!nightHemisphere) return;
    const intensity = clamp(getModernDayNightNumber(config, "cityLightsIntensity"), 0, 1.8);
    if (intensity <= 0) return;
  
    context.save();
    context.beginPath();
    pathCanvas(nightHemisphere);
    context.clip();
    const staticLayerCanvas = getModernCityLightsStaticLayerCanvas(k, config, intensity);
    if (staticLayerCanvas) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");
      context.drawImage(staticLayerCanvas, 0, 0);
    } else {
      drawModernCityLightsStaticLayer(k, config, intensity);
    }
    context.restore();
  }

  return Object.freeze({
    collectModernUrbanCoreEntries,
    drawLightEllipse,
    drawHistoricalNightLightsLayer,
    drawModernNightLightsLayer,
    drawNightLightsLayer,
    getHistoricalCityLightsDensity,
    getHistoricalCityLightsSecondaryRetention,
    getHistoricalDerivedGlowEntries,
    getHistoricalNightLightEntries,
    getLightBlobRgb,
    getModernCityLightsGeometry,
    getModernCityLightsPopulationBoostData,
    getModernCityLightsStaticLayerKey,
    getModernCityLightsZoomProfile,
    getModernDayNightNumber,
    getNightLightPalette,
    getSignedHashUnit,
    normalizeModernCityLightsValue,
    sanitizeHistoricalCityLightEntry,
    shouldCullModernLightEntry,
    shouldRenderHistoricalCityLightEntry,
    toRgbaString,
  });
}
