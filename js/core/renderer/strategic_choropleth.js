import { getFeatureId } from "../feature_identity.js";

const RESOURCE_METRIC_IDS = Object.freeze([
  "steel",
  "oil",
  "aluminium",
  "rubber",
  "tungsten",
  "chromium",
  "coal",
]);

const BUILDING_METRIC_IDS = Object.freeze([
  "infrastructure",
  "military_factories",
  "civilian_factories",
  "factories_total",
]);

export const STRATEGIC_CHOROPLETH_METRIC_IDS = Object.freeze([
  "manpower",
  ...RESOURCE_METRIC_IDS,
  ...BUILDING_METRIC_IDS,
]);

export const STRATEGIC_CHOROPLETH_METRICS = Object.freeze({
  manpower: Object.freeze({ id: "manpower", kind: "additive", family: "population", domainCap: "p95" }),
  steel: Object.freeze({ id: "steel", kind: "additive", family: "resource", domainCap: "p95" }),
  oil: Object.freeze({ id: "oil", kind: "additive", family: "resource", domainCap: "p95" }),
  aluminium: Object.freeze({ id: "aluminium", kind: "additive", family: "resource", domainCap: "p95" }),
  rubber: Object.freeze({ id: "rubber", kind: "additive", family: "resource", domainCap: "p95" }),
  tungsten: Object.freeze({ id: "tungsten", kind: "additive", family: "resource", domainCap: "p95" }),
  chromium: Object.freeze({ id: "chromium", kind: "additive", family: "resource", domainCap: "p95" }),
  coal: Object.freeze({ id: "coal", kind: "additive", family: "resource", domainCap: "p95" }),
  infrastructure: Object.freeze({ id: "infrastructure", kind: "level", family: "building", domainCap: "max" }),
  military_factories: Object.freeze({ id: "military_factories", kind: "additive", family: "building", domainCap: "p95" }),
  civilian_factories: Object.freeze({ id: "civilian_factories", kind: "additive", family: "building", domainCap: "p95" }),
  factories_total: Object.freeze({ id: "factories_total", kind: "additive", family: "building", domainCap: "p95" }),
});

const DEFAULT_DOMAIN_MAX = 1;

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, toFiniteNumber(value, 0)));
}

function normalizeMetricId(metricId) {
  return String(metricId || "").trim().toLowerCase();
}

function getBucket(payload, bucketId) {
  if (!payload || typeof payload !== "object") return null;
  const buckets = payload.buckets && typeof payload.buckets === "object" ? payload.buckets : {};
  const normalizedBucketId = String(bucketId || "").trim();
  return normalizedBucketId ? (buckets[normalizedBucketId] || null) : null;
}

export function isStrategicChoroplethMetric(metricId) {
  return Object.hasOwn(STRATEGIC_CHOROPLETH_METRICS, normalizeMetricId(metricId));
}

export function assertStrategicChoroplethMetric(metricId) {
  const normalizedMetricId = normalizeMetricId(metricId);
  if (!isStrategicChoroplethMetric(normalizedMetricId)) {
    throw new RangeError(`Unknown strategic choropleth metric: ${String(metricId || "").trim() || "<empty>"}`);
  }
  return normalizedMetricId;
}

export function resolveStrategicChoroplethBucketId(payload, featureOrId) {
  const featureId = getFeatureId(featureOrId);
  if (!featureId || !payload || typeof payload !== "object") return "";
  const bucketByFeature = payload.bucketByFeature && typeof payload.bucketByFeature === "object"
    ? payload.bucketByFeature
    : (
      payload.bucket_by_feature && typeof payload.bucket_by_feature === "object"
        ? payload.bucket_by_feature
        : {}
    );
  return String(bucketByFeature[featureId] || "").trim();
}

export function resolveStrategicChoroplethValue(payload, featureOrId, metricId) {
  const normalizedMetricId = assertStrategicChoroplethMetric(metricId);
  const bucketId = resolveStrategicChoroplethBucketId(payload, featureOrId);
  const bucket = getBucket(payload, bucketId);
  return Math.max(0, toFiniteNumber(bucket?.[normalizedMetricId], 0));
}

export function getStrategicChoroplethMetricDomain(payload, metricId, overrides = {}) {
  const normalizedMetricId = assertStrategicChoroplethMetric(metricId);
  const metricConfig = STRATEGIC_CHOROPLETH_METRICS[normalizedMetricId];
  const summary = payload?.metrics?.[normalizedMetricId] && typeof payload.metrics[normalizedMetricId] === "object"
    ? payload.metrics[normalizedMetricId]
    : {};
  const min = Math.max(0, toFiniteNumber(overrides.min ?? summary.min, 0));
  const summaryMax = toFiniteNumber(summary.max, DEFAULT_DOMAIN_MAX);
  const capKey = String(overrides.domainCap || metricConfig.domainCap || "").trim();
  const capValue = capKey ? toFiniteNumber(summary[capKey], NaN) : NaN;
  const requestedMax = toFiniteNumber(overrides.max ?? (Number.isFinite(capValue) && capValue > min ? capValue : summaryMax), DEFAULT_DOMAIN_MAX);
  const max = requestedMax > min ? requestedMax : min + DEFAULT_DOMAIN_MAX;
  return {
    metricId: normalizedMetricId,
    kind: String(summary.kind || metricConfig.kind),
    min,
    max,
    cap: Number.isFinite(capValue) ? capValue : null,
    absoluteMax: Math.max(min, toFiniteNumber(summaryMax, min)),
  };
}

export function getStrategicChoroplethT(value, domain) {
  const min = toFiniteNumber(domain?.min, 0);
  const max = toFiniteNumber(domain?.max, min + DEFAULT_DOMAIN_MAX);
  if (max <= min) return 0;
  return clampUnit((toFiniteNumber(value, min) - min) / (max - min));
}

export function buildStrategicChoroplethColorInput(payload, featureOrId, metricId, options = {}) {
  const normalizedMetricId = assertStrategicChoroplethMetric(metricId);
  const featureId = getFeatureId(featureOrId);
  const bucketId = resolveStrategicChoroplethBucketId(payload, featureOrId);
  const value = resolveStrategicChoroplethValue(payload, featureOrId, normalizedMetricId);
  const domain = getStrategicChoroplethMetricDomain(payload, normalizedMetricId, options.domain || {});
  return {
    metricId: normalizedMetricId,
    metric: STRATEGIC_CHOROPLETH_METRICS[normalizedMetricId],
    featureId,
    bucketId,
    value,
    domain,
    t: getStrategicChoroplethT(value, domain),
  };
}
