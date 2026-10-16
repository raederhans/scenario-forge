export const THEMATIC_HDI_LAYER_ID = "social_human_development_v1";
export const THEMATIC_HDI_DATA_VERSION = "undp-hdr-2025:2023";
export const THEMATIC_HDI_METRIC_ID = "undp_hdi";
export const THEMATIC_HDI_METRICS = Object.freeze([
  Object.freeze({ id: THEMATIC_HDI_METRIC_ID, labelEn: "Human Development Index", labelZh: "人类发展指数", unit: "index_0_1" }),
  Object.freeze({ id: "undp_life_expectancy", labelEn: "Life expectancy", labelZh: "预期寿命", unit: "years" }),
  Object.freeze({ id: "undp_expected_schooling", labelEn: "Expected years of schooling", labelZh: "预期受教育年限", unit: "years" }),
  Object.freeze({ id: "undp_mean_schooling", labelEn: "Mean years of schooling", labelZh: "平均受教育年限", unit: "years" }),
  Object.freeze({ id: "undp_gni_per_capita", labelEn: "GNI per capita", labelZh: "人均国民总收入", unit: "usd_2021_ppp" }),
]);

export function isThematicHdiMetricSupported(metricId) {
  return THEMATIC_HDI_METRICS.some((metric) => metric.id === metricId);
}

const YEAR = 2023;
const BASE_PATH = "data/thematic_layers/social/human_development_v1/";
const SUPPORTED_SCENARIOS = ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];
const requestsByFetcher = new WeakMap();

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HDI data request failed: ${response.status}`);
  return response.json();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid HDI data: ${message}`);
}

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozenCopy(child)])));
  }
  return value;
}

function expectedNormalizedValue(metricId, raw) {
  const clamp = (value) => Math.min(100, Math.max(0, value));
  switch (metricId) {
    case "undp_hdi": return raw * 100;
    case "undp_life_expectancy": return clamp((raw - 20) / 65 * 100);
    case "undp_expected_schooling": return clamp(raw / 18 * 100);
    case "undp_mean_schooling": return clamp(raw / 15 * 100);
    case "undp_gni_per_capita": return clamp(Math.log(raw / 100) / Math.log(750) * 100);
  }
}

function normalizePayload(manifest, metrics, metricId) {
  requireCondition(manifest?.schema_version === 1 && manifest.layer_id === THEMATIC_HDI_LAYER_ID, "manifest identity");
  const source = Array.isArray(manifest.provenance)
    ? manifest.provenance.find((entry) => entry?.source_id === "undp_hdr_2025") : null;
  requireCondition(source?.version === "2025" && source.release === "Human Development Report 2025"
    && source.selected_year === YEAR && manifest.period?.year === YEAR, "release version or year");
  requireCondition(manifest.source_policy === "real_source_cache_only" && manifest.status !== "fixture"
    && metrics?.status !== "fixture", "real-source policy");
  const consumer = manifest.runtime_consumer;
  requireCondition(consumer?.data_version === THEMATIC_HDI_DATA_VERSION, "runtime data version");
  requireCondition(consumer.status === "main_map_ready" && consumer.supports_main_map_render === true
    && Array.isArray(consumer.supported_scenarios) && consumer.supported_scenarios.includes("modern_world")
    && new Set(consumer.supported_scenarios).size === consumer.supported_scenarios.length
    && consumer.supported_scenarios.every((id) => SUPPORTED_SCENARIOS.includes(id)), "runtime main-map support");
  requireCondition(Array.isArray(manifest.metric_ids) && Array.isArray(consumer.supported_metrics)
    && consumer.supported_metrics.length > 0
    && new Set(consumer.supported_metrics).size === consumer.supported_metrics.length
    && consumer.supported_metrics.every((id) => isThematicHdiMetricSupported(id) && manifest.metric_ids.includes(id))
    && consumer.supported_metrics.includes(metricId), "runtime metric support");
  requireCondition(metrics?.schema_version === 1 && metrics.layer_id === THEMATIC_HDI_LAYER_ID
    && metrics.geography_level === "admin0" && metrics.join_key_type === "iso_a3", "metrics identity");
  requireCondition(Array.isArray(metrics.metric_ids) && metrics.metric_ids.includes(metricId)
    && Array.isArray(metrics.features), "official metric or feature rows");
  const descriptor = THEMATIC_HDI_METRICS.find((metric) => metric.id === metricId);
  const byIsoA3 = Object.create(null);
  let values = 0;
  let missing = 0;
  for (const row of metrics.features) {
    const joinKey = row?.join_key;
    requireCondition(typeof joinKey === "string" && /^[A-Z]{3}$/.test(joinKey)
      && !Object.hasOwn(byIsoA3, joinKey), "duplicate or invalid join key");
    const metric = row.values?.[metricId];
    requireCondition(metric?.year === YEAR && metric.unit === descriptor.unit, `${joinKey} metric year or unit`);
    const raw = metric.raw_value;
    const normalized = metric.normalized_value;
    requireCondition(raw === null || (typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      && (metricId !== THEMATIC_HDI_METRIC_ID || raw <= 1)
      && (metricId !== "undp_gni_per_capita" || raw > 0)), `${joinKey} raw value range`);
    requireCondition(raw === null ? normalized === null
      : typeof normalized === "number" && Number.isFinite(normalized) && normalized >= 0 && normalized <= 100
        && Math.abs(normalized - expectedNormalizedValue(metricId, raw)) <= 1e-8, `${joinKey} normalization`);
    requireCondition(raw === null ? metric.source_status === "source_gap" : metric.source_status === "observed", `${joinKey} observation status`);
    if (raw === null) missing += 1;
    else values += 1;
    byIsoA3[joinKey] = Object.freeze({
      status: raw === null ? "missing" : "value",
      value: raw,
      normalizedValue: normalized,
      unit: descriptor.unit,
      metricId,
      joinKey,
      name: String(row.name ?? ""),
      year: YEAR,
      sourceStatus: metric.source_status,
      uncertainty: frozenCopy(metric.uncertainty ?? null),
    });
  }
  requireCondition(values + missing > 0, "empty observations");
  return Object.freeze({
    layerId: THEMATIC_HDI_LAYER_ID,
    dataVersion: THEMATIC_HDI_DATA_VERSION,
    metricId,
    supportedScenarios: Object.freeze([...consumer.supported_scenarios]),
    year: YEAR,
    byIsoA3: Object.freeze(byIsoA3),
    counts: Object.freeze({ features: values + missing, values, missing }),
  });
}

export async function loadThematicHdiData({ metricId = THEMATIC_HDI_METRIC_ID, scenarioId = "modern_world", fetchJson = defaultFetchJson } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("HDI fetchJson must be a function");
  if (!isThematicHdiMetricSupported(metricId)) throw new RangeError(`Unsupported HDI metric: ${metricId}`);
  if (!SUPPORTED_SCENARIOS.includes(scenarioId)) throw new RangeError(`Unsupported HDI scenario: ${scenarioId}`);
  let cache = requestsByFetcher.get(fetchJson);
  if (!cache) {
    cache = { documents: null, payloads: new Map() };
    cache.documents = Promise.all([
      fetchJson(`${BASE_PATH}manifest.json`),
      fetchJson(`${BASE_PATH}metrics.admin0.json`),
    ]).then((documents) => documents.map(frozenCopy));
    requestsByFetcher.set(fetchJson, cache);
    cache.documents.catch(() => {
      if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson);
    });
  }
  let request = cache.payloads.get(metricId);
  if (!request) {
    request = cache.documents.then(([manifest, metrics]) => normalizePayload(manifest, metrics, metricId));
    cache.payloads.set(metricId, request);
    request.catch(() => {
      if (cache.payloads.get(metricId) === request) cache.payloads.delete(metricId);
      if (requestsByFetcher.get(fetchJson) === cache) requestsByFetcher.delete(fetchJson);
    });
  }
  const payload = await request;
  if (!payload.supportedScenarios.includes(scenarioId) && requestsByFetcher.get(fetchJson) === cache) {
    requestsByFetcher.delete(fetchJson);
  }
  requireCondition(payload.supportedScenarios.includes(scenarioId), "requested scenario is not advertised");
  return payload;
}
