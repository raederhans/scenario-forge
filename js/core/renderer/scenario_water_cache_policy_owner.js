const DEFAULT_SCENARIO_WATER_CACHE_MODE_PARAM = "water_cache_mode";
const DEFAULT_SCENARIO_WATER_CACHE_MODE_ALT_PARAM = "scenario_water_cache_mode";
const DEFAULT_SCENARIO_WATER_CACHE_MODES = new Set(["adaptive", "reuse", "redraw", "direct"]);
const DEFAULT_SCENARIO_WATER_COVERAGE_ALGO_PARAM = "water_cache_coverage_algo";
const DEFAULT_SCENARIO_WATER_COVERAGE_ALGO_ALT_PARAM = "scenario_water_cache_coverage_algo";
const DEFAULT_SCENARIO_WATER_COVERAGE_ALGOS = new Set(["legacy", "grid"]);
const DEFAULT_SCENARIO_WATER_COVERAGE_GRID_BASE_COLUMNS = 64;
const DEFAULT_SCENARIO_WATER_COVERAGE_GRID_BASE_ROWS = 36;
const DEFAULT_SCENARIO_WATER_COVERAGE_GRID_MAX_DPR = 3;
const DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_FEATURE_MAX = 24;
const DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_COVERAGE_MAX = 0.2;
const DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_PREV_RENDERED_MAX = 28;

function toAllowedSet(value, defaultSet) {
  return value instanceof Set ? value : defaultSet;
}

function defaultCloneZoomTransform(transform = null) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function createScenarioWaterCachePolicyOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    scenarioWaterCacheModeParam = DEFAULT_SCENARIO_WATER_CACHE_MODE_PARAM,
    scenarioWaterCacheModeAltParam = DEFAULT_SCENARIO_WATER_CACHE_MODE_ALT_PARAM,
    scenarioWaterCacheModes = DEFAULT_SCENARIO_WATER_CACHE_MODES,
    scenarioWaterCoverageAlgoParam = DEFAULT_SCENARIO_WATER_COVERAGE_ALGO_PARAM,
    scenarioWaterCoverageAlgoAltParam = DEFAULT_SCENARIO_WATER_COVERAGE_ALGO_ALT_PARAM,
    scenarioWaterCoverageAlgos = DEFAULT_SCENARIO_WATER_COVERAGE_ALGOS,
    scenarioWaterCoverageGridBaseColumns = DEFAULT_SCENARIO_WATER_COVERAGE_GRID_BASE_COLUMNS,
    scenarioWaterCoverageGridBaseRows = DEFAULT_SCENARIO_WATER_COVERAGE_GRID_BASE_ROWS,
    scenarioWaterCoverageGridMaxDpr = DEFAULT_SCENARIO_WATER_COVERAGE_GRID_MAX_DPR,
    scenarioWaterLowComplexityFeatureMax = DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_FEATURE_MAX,
    scenarioWaterLowComplexityCoverageMax = DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_COVERAGE_MAX,
    scenarioWaterLowComplexityPrevRenderedMax = DEFAULT_SCENARIO_WATER_LOW_COMPLEXITY_PREV_RENDERED_MAX,
  } = constants;
  const allowedCacheModes = toAllowedSet(scenarioWaterCacheModes, DEFAULT_SCENARIO_WATER_CACHE_MODES);
  const allowedCoverageAlgos = toAllowedSet(scenarioWaterCoverageAlgos, DEFAULT_SCENARIO_WATER_COVERAGE_ALGOS);
  const {
    readSearchParam = () => "",
    getDevicePixelRatio = () => 1,
    getPreviousRenderedCount = () => 0,
  } = getters;
  const {
    cloneZoomTransform = defaultCloneZoomTransform,
    collectSafeWaterRegionGeometryParts = () => [],
    computeProjectedGeoBounds = () => null,
    isWaterRegionRenderable = () => true,
  } = helpers;

  function normalizeScenarioWaterCacheStrategyMode(rawMode) {
    const normalized = String(rawMode || "").trim().toLowerCase();
    return allowedCacheModes.has(normalized) ? normalized : "";
  }

  function getFirstValidScenarioWaterCacheStrategyMode(...rawModes) {
    for (let index = 0; index < rawModes.length; index += 1) {
      const mode = normalizeScenarioWaterCacheStrategyMode(rawModes[index]);
      if (mode) return mode;
    }
    return "";
  }

  function getForcedScenarioWaterCacheMode() {
    const queryMode = getFirstValidScenarioWaterCacheStrategyMode(
      readSearchParam(scenarioWaterCacheModeParam),
      readSearchParam(scenarioWaterCacheModeAltParam),
    );
    if (queryMode) return { mode: queryMode, source: "query-param" };

    const profile = state.renderProfile && typeof state.renderProfile === "object" ? state.renderProfile : null;
    const profileMode = profile
      ? getFirstValidScenarioWaterCacheStrategyMode(profile.waterCacheMode, profile.scenarioWaterCacheMode)
      : "";
    if (profileMode) return { mode: profileMode, source: "render-profile" };

    const stateMode = getFirstValidScenarioWaterCacheStrategyMode(state.scenarioWaterCacheMode, state.waterCacheMode);
    if (stateMode) return { mode: stateMode, source: "state" };

    return { mode: "adaptive", source: "default" };
  }

  function normalizeScenarioWaterCoverageAlgo(rawValue) {
    const normalized = String(rawValue || "").trim().toLowerCase();
    return allowedCoverageAlgos.has(normalized) ? normalized : "";
  }

  function getFirstValidScenarioWaterCoverageAlgo(...rawValues) {
    for (let index = 0; index < rawValues.length; index += 1) {
      const algo = normalizeScenarioWaterCoverageAlgo(rawValues[index]);
      if (algo) return algo;
    }
    return "";
  }

  function getForcedScenarioWaterCoverageAlgo() {
    const queryAlgo = getFirstValidScenarioWaterCoverageAlgo(
      readSearchParam(scenarioWaterCoverageAlgoParam),
      readSearchParam(scenarioWaterCoverageAlgoAltParam),
    );
    if (queryAlgo) return { algo: queryAlgo, source: "query-param" };

    const profile = state.renderProfile && typeof state.renderProfile === "object" ? state.renderProfile : null;
    const profileAlgo = profile
      ? getFirstValidScenarioWaterCoverageAlgo(profile.waterCacheCoverageAlgo, profile.scenarioWaterCacheCoverageAlgo)
      : "";
    if (profileAlgo) return { algo: profileAlgo, source: "render-profile" };

    const stateAlgo = getFirstValidScenarioWaterCoverageAlgo(state.waterCacheCoverageAlgo, state.scenarioWaterCacheCoverageAlgo);
    if (stateAlgo) return { algo: stateAlgo, source: "state" };

    return { algo: "grid", source: "default" };
  }

  function getViewportSize() {
    const width = Number(state.width || 0);
    const height = Number(state.height || 0);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 0,
      height: Number.isFinite(height) && height > 0 ? height : 0,
    };
  }

  function getScreenBounds(part, transform) {
    const bounds = computeProjectedGeoBounds(part);
    if (!bounds) return null;
    const minX = bounds.minX * transform.k + transform.x;
    const minY = bounds.minY * transform.k + transform.y;
    const maxX = bounds.maxX * transform.k + transform.x;
    const maxY = bounds.maxY * transform.k + transform.y;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return { minX, minY, maxX, maxY };
  }

  function getScenarioWaterVisibleCoverageRatioLegacy(waterFeatures = []) {
    const { width, height } = getViewportSize();
    const viewportArea = width * height;
    if (!(viewportArea > 0)) return 0;
    const transform = cloneZoomTransform(state.zoomTransform);
    let clippedArea = 0;
    for (const feature of Array.isArray(waterFeatures) ? waterFeatures : []) {
      if (!isWaterRegionRenderable(feature)) continue;
      for (const part of collectSafeWaterRegionGeometryParts(feature)) {
        const bounds = getScreenBounds(part, transform);
        if (!bounds) continue;
        const clippedWidth = Math.max(0, Math.min(bounds.maxX, width) - Math.max(bounds.minX, 0));
        const clippedHeight = Math.max(0, Math.min(bounds.maxY, height) - Math.max(bounds.minY, 0));
        if (clippedWidth > 0 && clippedHeight > 0) clippedArea += clippedWidth * clippedHeight;
      }
    }
    return clampUnit(clippedArea / viewportArea);
  }

  function getScenarioWaterVisibleCoverageRatioGrid(waterFeatures = []) {
    const { width, height } = getViewportSize();
    if (!(width > 0 && height > 0)) return 0;
    const transform = cloneZoomTransform(state.zoomTransform);
    const dpr = Math.max(1, Math.min(scenarioWaterCoverageGridMaxDpr, Number(getDevicePixelRatio() || 1)));
    const gridColumns = Math.max(1, Math.round(scenarioWaterCoverageGridBaseColumns * dpr));
    const gridRows = Math.max(1, Math.round(scenarioWaterCoverageGridBaseRows * dpr));
    const totalCellCount = gridColumns * gridRows;
    if (!(totalCellCount > 0)) return 0;
    const covered = new Uint8Array(totalCellCount);
    let coveredCount = 0;
    for (const feature of Array.isArray(waterFeatures) ? waterFeatures : []) {
      if (!isWaterRegionRenderable(feature)) continue;
      if (coveredCount >= totalCellCount) break;
      for (const part of collectSafeWaterRegionGeometryParts(feature)) {
        if (coveredCount >= totalCellCount) break;
        const bounds = getScreenBounds(part, transform);
        if (!bounds) continue;
        const clippedMinX = Math.max(0, Math.min(bounds.minX, width));
        const clippedMinY = Math.max(0, Math.min(bounds.minY, height));
        const clippedMaxX = Math.max(0, Math.min(bounds.maxX, width));
        const clippedMaxY = Math.max(0, Math.min(bounds.maxY, height));
        if (!(clippedMaxX > clippedMinX && clippedMaxY > clippedMinY)) continue;
        const colStart = Math.max(0, Math.min(gridColumns - 1, Math.floor((clippedMinX / width) * gridColumns)));
        const colEnd = Math.max(0, Math.min(gridColumns - 1, Math.ceil((clippedMaxX / width) * gridColumns) - 1));
        const rowStart = Math.max(0, Math.min(gridRows - 1, Math.floor((clippedMinY / height) * gridRows)));
        const rowEnd = Math.max(0, Math.min(gridRows - 1, Math.ceil((clippedMaxY / height) * gridRows) - 1));
        if (colEnd < colStart || rowEnd < rowStart) continue;
        for (let row = rowStart; row <= rowEnd; row += 1) {
          const rowOffset = row * gridColumns;
          for (let col = colStart; col <= colEnd; col += 1) {
            const cellIndex = rowOffset + col;
            if (covered[cellIndex]) continue;
            covered[cellIndex] = 1;
            coveredCount += 1;
            if (coveredCount >= totalCellCount) break;
          }
          if (coveredCount >= totalCellCount) break;
        }
      }
    }
    return clampUnit(coveredCount / totalCellCount);
  }

  function getScenarioWaterVisibleCoverageRatio(waterFeatures = [], options = {}) {
    const algo = normalizeScenarioWaterCoverageAlgo(options?.algo) || getForcedScenarioWaterCoverageAlgo().algo;
    return algo === "legacy"
      ? getScenarioWaterVisibleCoverageRatioLegacy(waterFeatures)
      : getScenarioWaterVisibleCoverageRatioGrid(waterFeatures);
  }

  function getScenarioWaterCacheComplexitySignals(waterFeatures = []) {
    const coverageAlgoDecision = getForcedScenarioWaterCoverageAlgo();
    const visibleCoverageRatio = getScenarioWaterVisibleCoverageRatio(waterFeatures, { algo: coverageAlgoDecision.algo });
    return {
      featureCount: Array.isArray(waterFeatures) ? waterFeatures.length : 0,
      visibleCoverageRatio: Number(visibleCoverageRatio.toFixed(4)),
      previousRenderedCount: Math.max(0, Number(getPreviousRenderedCount() || 0)),
      waterCoverageAlgo: coverageAlgoDecision.algo,
      waterCoverageAlgoSource: coverageAlgoDecision.source,
    };
  }

  function shouldUseDirectScenarioWaterDraw(signals) {
    return (
      Number(signals?.featureCount || 0) <= scenarioWaterLowComplexityFeatureMax
      && Number(signals?.previousRenderedCount || 0) <= scenarioWaterLowComplexityPrevRenderedMax
      && Number(signals?.visibleCoverageRatio || 0) <= scenarioWaterLowComplexityCoverageMax
    );
  }

  return {
    normalizeScenarioWaterCacheStrategyMode,
    getFirstValidScenarioWaterCacheStrategyMode,
    getForcedScenarioWaterCacheMode,
    normalizeScenarioWaterCoverageAlgo,
    getFirstValidScenarioWaterCoverageAlgo,
    getForcedScenarioWaterCoverageAlgo,
    getScenarioWaterVisibleCoverageRatioLegacy,
    getScenarioWaterVisibleCoverageRatioGrid,
    getScenarioWaterVisibleCoverageRatio,
    getScenarioWaterCacheComplexitySignals,
    shouldUseDirectScenarioWaterDraw,
  };
}
