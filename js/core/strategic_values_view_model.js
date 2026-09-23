import {
  STRATEGIC_CHOROPLETH_METRIC_IDS,
  STRATEGIC_CHOROPLETH_METRICS,
  getStrategicChoroplethMetricDomain,
  isStrategicChoroplethMetric,
} from "./renderer/strategic_choropleth.js";
import { isScenarioStrategicValuesUsable } from "./scenario/strategic_values.js";

export const STRATEGIC_RESOURCE_IDS = Object.freeze([
  "steel", "oil", "aluminium", "rubber", "tungsten", "chromium", "coal",
]);

export function normalizeStrategicValuesStyle(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const opacity = value.opacity === null || value.opacity === undefined || value.opacity === ""
    ? NaN : Number(value.opacity);
  const palette = String(value.palette || "").toLowerCase();
  const resourceFilter = String(value.resourceFilter || "").toLowerCase();
  return {
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.75,
    palette: ["auto", "blue", "green", "rose"].includes(palette) ? palette : "auto",
    resourceFilter: ["all", ...STRATEGIC_RESOURCE_IDS].includes(resourceFilter) ? resourceFilter : "all",
  };
}

const COLOR_STOPS = Object.freeze({
  blue: Object.freeze(["#e0f2fe", "#0369a1"]),
  green: Object.freeze(["#ecfdf5", "#047857"]),
  rose: Object.freeze(["#f1f5f9", "#be123c"]),
});

export function getStrategicValuesColorStops(palette, family) {
  const requested = String(palette || "").toLowerCase();
  const selected = requested === "auto"
    ? (family === "resource" ? "blue" : family === "building" ? "rose" : "green")
    : requested;
  return COLOR_STOPS[selected] || COLOR_STOPS.green;
}

function text(value) { return String(value ?? "").trim(); }
function own(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }

export function getStrategicValuesViewModel(state) {
  const scenarioId = text(state?.activeScenarioId);
  const bundle = state?.scenarioBundleCacheById?.[scenarioId] || null;
  const manifest = bundle?.manifest || null;
  const payload = state?.scenarioStrategicValuesData;
  const bundlePayload = bundle?.strategicValuesPayload;
  const supported = !!text(manifest?.strategic_values_url)
    || (Array.isArray(bundle?.chunkRegistry?.byLayer?.strategicvalues)
      && bundle.chunkRegistry.byLayer.strategicvalues.length > 0);
  const activeIdentity = !!payload && text(payload.scenarioId ?? payload.scenario_id) === scenarioId
    && (!text(manifest?.baseline_hash) || text(payload.baselineHash ?? payload.baseline_hash) === text(manifest.baseline_hash));
  const errors = activeIdentity && Array.isArray(payload?.diagnostics?.errors) ? payload.diagnostics.errors : [];
  const pending = !!bundle?.optionalLayerPromises?.strategicvalues;
  const failed = !!bundle?.optionalLayerErrors?.strategicvalues || (activeIdentity && errors.length > 0)
    || (bundle?.optionalLayerSettledByKey?.strategicvalues === true && !isScenarioStrategicValuesUsable(bundlePayload));
  let status = "unsupported";
  if (supported) {
    status = failed ? "failed" : activeIdentity && isScenarioStrategicValuesUsable(payload)
      ? "ready" : pending ? "loading" : "not-loaded";
  }
  const metricId = isStrategicChoroplethMetric(state?.strategicChoroplethMetric)
    ? text(state.strategicChoroplethMetric).toLowerCase() : "";
  const buckets = status === "ready" && payload?.buckets && typeof payload.buckets === "object" ? payload.buckets : {};
  const bucketIds = Object.keys(buckets).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const mappedIds = new Set(Object.values(payload?.bucketByFeature || {}).map(text));
  const mappedBucketIds = bucketIds.filter((id) => mappedIds.has(id));
  const valuedBucketIds = metricId ? mappedBucketIds.filter((id) => own(buckets[id], metricId)
    && buckets[id][metricId] !== null && buckets[id][metricId] !== ""
    && Number.isFinite(Number(buckets[id][metricId]))) : [];
  const domain = status === "ready" && metricId ? getStrategicChoroplethMetricDomain(payload, metricId) : null;
  const values = valuedBucketIds.map((id) => Number(buckets[id][metricId]));
  const allZero = values.length > 0 && values.every((value) => value === 0);
  return {
    status, scenarioId, scenarioName: text(manifest?.display_name || scenarioId),
    asOf: text(manifest?.bookmark_date || manifest?.as_of_date),
    metricId, metric: metricId ? STRATEGIC_CHOROPLETH_METRICS[metricId] : null,
    domain, payload: status === "ready" ? payload : null,
    bucketIds, mappedBucketIds, valuedBucketIds, allZero,
    coverage: { mapped: mappedBucketIds.length, total: bucketIds.length, valued: valuedBucketIds.length },
    errors,
  };
}

export function getStrategicBucketInspection(view, bucketId) {
  const id = text(bucketId);
  const bucket = view?.payload?.buckets?.[id];
  if (!bucket) return null;
  const metricId = view.metricId;
  const raw = metricId && own(bucket, metricId) ? bucket[metricId] : undefined;
  const value = raw === undefined || raw === null || raw === "" ? null : Number(raw);
  return {
    id, stateId: text(bucket.state_id ?? bucket.stateId),
    owner: text(bucket.owner_tag ?? bucket.ownerTag),
    attribution: text(bucket.attribution),
    value: Number.isFinite(value) ? value : null,
    hasValue: raw !== undefined && raw !== null && raw !== "" && Number.isFinite(value),
  };
}

export { STRATEGIC_CHOROPLETH_METRIC_IDS };

export const STRATEGIC_METRIC_NAMES = {
  manpower: ["Manpower", "人力"], steel: ["Steel", "钢铁"], oil: ["Oil", "石油"],
  aluminium: ["Aluminium", "铝"], rubber: ["Rubber", "橡胶"], tungsten: ["Tungsten", "钨"],
  chromium: ["Chromium", "铬"], coal: ["Coal", "煤炭"],
  infrastructure: ["Infrastructure", "基础设施"],
  military_factories: ["Military factories", "军用工厂"],
  civilian_factories: ["Civilian factories", "民用工厂"],
  factories_total: ["Total factories", "工厂总数"],
};

// Fast point lookup for map hover; do not build or sort the full catalog per pointer move.
export function getStrategicFeatureInspection(state, featureId) {
  const payload = state?.scenarioStrategicValuesData;
  const metricId = state?.strategicChoroplethMetric;
  if (!isStrategicChoroplethMetric(metricId) || !isScenarioStrategicValuesUsable(payload)) return null;
  if (state.activeScenarioId && payload.scenarioId !== state.activeScenarioId) return null;
  const bucketId = payload.bucketByFeature?.[featureId];
  if (!bucketId) return { metricId, mapped: false, hasValue: false };
  return { ...getStrategicBucketInspection({ payload, metricId }, bucketId), metricId, mapped: true };
}
