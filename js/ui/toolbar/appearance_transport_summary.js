import { getTransportOverviewLineSummaryMeta } from "../../core/transport_capability_registry.js";
import { getTransportOverviewFilteredFeatureCount } from "../../core/transport_overview_visibility_policy.js";

const TRANSPORT_RENDER_METRIC_NAMES = Object.freeze({
  airport: "drawAirportsLayer",
  port: "drawPortsLayer",
  rail: "drawRailwaysLayer",
  road: "drawRoadsLayer",
});
const TRANSPORT_POINT_FAMILY_NOUNS = Object.freeze({
  airport: ["airport", "airports"],
  port: ["port", "ports"],
});

function translateUi(translate, key) {
  return typeof translate === "function" ? translate(key, "ui") : key;
}

function formatTransportLabelValue(value) {
  return String(value || "")
    .trim()
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatTransportPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export function formatTransportScopeLabel(value) {
  return formatTransportLabelValue(value);
}

export function formatTransportThresholdLabel(value) {
  return formatTransportLabelValue(value);
}

function getTransportFamilyCollection(familyId, collections = {}) {
  if (familyId === "rail") return collections.rail;
  if (familyId === "road") return collections.road;
  if (familyId === "port") return collections.port;
  if (familyId === "airport") return collections.airport;
  return null;
}

const transportSummaryCollectionCache = new WeakMap();

function getTransportCollectionSummaryCache(collection) {
  if (!collection || typeof collection !== "object") return null;
  const features = Array.isArray(collection.features) ? collection.features : null;
  if (!features) return null;
  const cached = transportSummaryCollectionCache.get(collection);
  if (cached && cached.features === features && cached.length === features.length) {
    return cached;
  }
  const next = {
    features,
    length: features.length,
    filteredCounts: new Map(),
    lineCoverage: new Map(),
  };
  transportSummaryCollectionCache.set(collection, next);
  return next;
}

function normalizeTransportSummaryKeyToken(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function getTransportSummaryCountScope(familyConfig = {}, effectiveScope = {}) {
  return {
    scope: normalizeTransportSummaryKeyToken(effectiveScope.scope || familyConfig.scope),
    importanceThreshold: normalizeTransportSummaryKeyToken(effectiveScope.importanceThreshold || familyConfig.importanceThreshold),
  };
}

function buildFilteredCountCacheKey({
  familyId,
  familyConfig,
  effectiveScope,
  zoomScale,
  visualMode,
}) {
  const scale = Number(zoomScale || 1);
  const scaleKey = Number.isFinite(scale) ? scale.toFixed(3) : "1.000";
  const countScope = getTransportSummaryCountScope(familyConfig, effectiveScope);
  return [
    normalizeTransportSummaryKeyToken(familyId),
    countScope.scope,
    countScope.importanceThreshold,
    scaleKey,
    normalizeTransportSummaryKeyToken(visualMode),
  ].join("|");
}

function computeTransportFamilyFilteredCount({
  familyId,
  collection,
  familyConfig,
  effectiveScope,
  zoomScale,
  visualMode,
}) {
  return getTransportOverviewFilteredFeatureCount({
    familyId,
    collection,
    familyConfig,
    effectiveScope,
    zoomScale,
    visualMode,
  });
}

export function getTransportFamilyFilteredCount({
  familyId,
  familyConfig,
  effectiveScope,
  collections,
  zoomScale,
  visualMode,
}) {
  const collection = getTransportFamilyCollection(familyId, collections);
  const collectionCache = getTransportCollectionSummaryCache(collection);
  if (!collectionCache) {
    return computeTransportFamilyFilteredCount({
      familyId,
      collection,
      familyConfig,
      effectiveScope,
      zoomScale,
      visualMode,
    });
  }
  const cacheKey = buildFilteredCountCacheKey({
    familyId,
    familyConfig,
    effectiveScope,
    zoomScale,
    visualMode,
  });
  if (collectionCache.filteredCounts.has(cacheKey)) {
    return collectionCache.filteredCounts.get(cacheKey);
  }
  const filteredCount = computeTransportFamilyFilteredCount({
    familyId,
    collection,
    familyConfig,
    effectiveScope,
    zoomScale,
    visualMode,
  });
  collectionCache.filteredCounts.set(cacheKey, filteredCount);
  return filteredCount;
}

export function getTransportFamilyRenderMetric(familyId, metricsSource) {
  const metricName = TRANSPORT_RENDER_METRIC_NAMES[familyId];
  if (!metricName) return null;
  const metrics = metricsSource && typeof metricsSource === "object" ? metricsSource : {};
  // transport summary 以 contextBreakdown 为首选真相源，因为 renderer 现在把
  // interactive pass、country overlay 和 hidden reason 都写在这里；旧顶层字段只保留兼容读取。
  const breakdown = metrics.contextBreakdown && typeof metrics.contextBreakdown === "object"
    ? metrics.contextBreakdown
    : {};
  const metric = breakdown[metricName] || metrics[metricName] || null;
  return metric && typeof metric === "object" ? metric : null;
}

export function isTransportFamilyRenderSettlingMetric(metric) {
  if (!metric || typeof metric !== "object") return true;
  const reason = String(metric.reason || "").trim().toLowerCase();
  // “settling” 表示 UI 还处在 renderer 过渡态：可能正在 staged apply，也可能
  // interactive pass 还没进入可见统计，所以 summary 先显示加载中，避免把 0 visible 误报成空数据。
  return !!metric.interactive
    || reason === "hidden"
    || reason === "interactive-pass"
    || reason === "staged-apply"
    || reason === "no-path";
}

export function formatTransportFamilyCountText(familyId, count, translate) {
  if (!Number.isFinite(count)) return "";
  const roundedCount = Math.max(0, Math.round(count));
  if (familyId === "rail") return `${roundedCount.toLocaleString()} ${translateUi(translate, roundedCount === 1 ? "railway" : "railways")}`;
  if (familyId === "road") return `${roundedCount.toLocaleString()} ${translateUi(translate, roundedCount === 1 ? "road" : "roads")}`;
  const nouns = TRANSPORT_POINT_FAMILY_NOUNS[familyId];
  if (!nouns) return "";
  const noun = roundedCount === 1 ? nouns[0] : nouns[1];
  return `${roundedCount.toLocaleString()} ${translateUi(translate, noun)}`;
}

export function formatTransportLoadedAuxiliaryText(familyId, count, translate) {
  const countText = formatTransportFamilyCountText(familyId, count, translate);
  return countText ? `${countText} ${translateUi(translate, "loaded")}` : "";
}

function getTransportLineClassCoverageState(familyId, collections) {
  const meta = getTransportOverviewLineSummaryMeta(familyId);
  const collection = getTransportFamilyCollection(familyId, collections);
  const features = Array.isArray(collection?.features) ? collection.features : [];
  if (!meta) return null;
  const collectionCache = getTransportCollectionSummaryCache(collection);
  const cacheKey = String(familyId || "").trim().toLowerCase();
  if (collectionCache?.lineCoverage.has(cacheKey)) {
    return collectionCache.lineCoverage.get(cacheKey);
  }
  const presentClasses = new Set();
  features.forEach((feature) => {
    const className = String(feature?.properties?.class || "").trim().toLowerCase();
    if (meta.classOrder.includes(className)) presentClasses.add(className);
  });
  const orderedClasses = meta.classOrder.filter((className) => presentClasses.has(className));
  const state = {
    orderedClasses,
    missingRoadSecondary: familyId === "road" && !presentClasses.has("primary") && !presentClasses.has("secondary"),
    missingRailSecondary: familyId === "rail" && !presentClasses.has("secondary"),
  };
  collectionCache?.lineCoverage.set(cacheKey, state);
  return state;
}

export function getTransportLineClassCoverage(familyId, collections, translate) {
  const coverageState = getTransportLineClassCoverageState(familyId, collections);
  if (!coverageState?.orderedClasses?.length) return "";
  const visibleClasses = coverageState.orderedClasses.join("/");
  if (coverageState.missingRoadSecondary) {
    return `${translateUi(translate, "Loaded classes:")} ${visibleClasses} (${translateUi(translate, "primary/secondary pending")})`;
  }
  if (coverageState.missingRailSecondary) {
    return `${translateUi(translate, "Loaded classes:")} ${visibleClasses} (${translateUi(translate, "secondary full-only")})`;
  }
  return `${translateUi(translate, "Loaded classes:")} ${visibleClasses}`;
}

export function buildTransportLineSummaryDetails(familyId, collections, translate) {
  const meta = getTransportOverviewLineSummaryMeta(familyId);
  if (!meta) return [];
  return [
    getTransportLineClassCoverage(familyId, collections, translate),
    `${translateUi(translate, "Phase:")} ${translateUi(translate, meta.phaseText)}`,
    `${translateUi(translate, "Source:")} ${translateUi(translate, meta.sourceText)}`,
  ].filter(Boolean);
}

export function buildTransportFamilySummaryText({
  familyId,
  masterEnabled,
  familyEnabled,
  familyConfig,
  effectiveScope,
  collections,
  metrics,
  zoomScale,
  visualMode,
  translate,
}) {
  if (!familyEnabled || !masterEnabled) return translateUi(translate, "Off");
  const metric = getTransportFamilyRenderMetric(familyId, metrics);
  const filteredCount = getTransportFamilyFilteredCount({
    familyId,
    familyConfig,
    effectiveScope,
    collections,
    zoomScale,
    visualMode,
  });
  if (isTransportFamilyRenderSettlingMetric(metric)) {
    return formatTransportLoadedAuxiliaryText(familyId, filteredCount, translate)
      || translateUi(translate, "Loading/settling");
  }
  const visibleCount = Math.max(0, Math.round(Number(metric.visibleFeatureCount || 0)));
  return formatTransportFamilyCountText(familyId, visibleCount, translate);
}
