export const THEMATIC_POPULATION_LAYER_ID = "population_wdi_population_v1";
export const THEMATIC_POPULATION_DATA_VERSION = "wdi-2026-07-13:2023";
export const THEMATIC_POPULATION_METRIC_ID = "wdi_population_total";
export const THEMATIC_POPULATION_METRICS = Object.freeze([
  Object.freeze({ id: THEMATIC_POPULATION_METRIC_ID, labelEn: "Total population", labelZh: "总人口", unit: "persons" }),
  Object.freeze({ id: "wdi_population_density", labelEn: "National population density", labelZh: "国家平均人口密度", unit: "persons_per_km2" }),
  Object.freeze({ id: "wdi_urban_population_share", labelEn: "Urban population share", labelZh: "城镇人口占比", unit: "percent" }),
  Object.freeze({ id: "wdi_population_65_plus_share", labelEn: "Population aged 65 and above", labelZh: "65岁及以上人口占比", unit: "percent" }),
  Object.freeze({ id: "wdi_total_fertility_rate", labelEn: "Total fertility rate", labelZh: "总和生育率", unit: "births_per_woman" }),
]);

export function isThematicPopulationMetricSupported(metricId) {
  return THEMATIC_POPULATION_METRICS.some((metric) => metric.id === metricId);
}

const YEAR = 2023;
const BASE_PATH = "data/thematic_layers/population/wdi_population_v1/";
const SUPPORTED_SCENARIOS = ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"];
const requestsByFetcher = new WeakMap();

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`population data request failed: ${response.status}`);
  return response.json();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid population data: ${message}`);
}

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozenCopy(child)])));
  }
  return value;
}

function expectedNormalizedValue(metricId, raw) {
  switch (metricId) {
    case "wdi_population_total": return Math.min(100, raw / 1.5e9 * 100);
    case "wdi_population_density": return Math.min(100, raw / 1000 * 100);
    case "wdi_urban_population_share":
    case "wdi_population_65_plus_share": return raw;
    case "wdi_total_fertility_rate": return Math.min(100, raw / 8 * 100);
  }
}

function normalizePayload(manifest, metrics, metricId) {
  requireCondition(manifest?.schema_version === 1 && manifest.layer_id === THEMATIC_POPULATION_LAYER_ID, "manifest identity");
  const source = Array.isArray(manifest.provenance)
    ? manifest.provenance.find((entry) => entry?.source_id === "world_bank_wdi_population") : null;
  requireCondition(source?.version === "2026-07-13" && source.release === "World Development Indicators"
    && source.selected_year === YEAR && manifest.period?.year === YEAR, "release version or year");
  requireCondition(manifest.source_policy === "real_source_cache_only" && manifest.status !== "fixture"
    && metrics?.status !== "fixture", "real-source policy");
  const consumer = manifest.runtime_consumer;
  requireCondition(consumer?.data_version === THEMATIC_POPULATION_DATA_VERSION, "runtime data version");
  requireCondition(consumer.status === "main_map_ready" && consumer.supports_main_map_render === true
    && Array.isArray(consumer.supported_scenarios) && consumer.supported_scenarios.includes("modern_world")
    && new Set(consumer.supported_scenarios).size === consumer.supported_scenarios.length
    && consumer.supported_scenarios.every((id) => SUPPORTED_SCENARIOS.includes(id)), "runtime main-map support");
  requireCondition(Array.isArray(manifest.metric_ids) && Array.isArray(consumer.supported_metrics)
    && consumer.supported_metrics.length > 0
    && new Set(consumer.supported_metrics).size === consumer.supported_metrics.length
    && consumer.supported_metrics.every((id) => isThematicPopulationMetricSupported(id) && manifest.metric_ids.includes(id))
    && consumer.supported_metrics.includes(metricId), "runtime metric support");
  requireCondition(metrics?.schema_version === 1 && metrics.layer_id === THEMATIC_POPULATION_LAYER_ID
    && metrics.geography_level === "admin0" && metrics.join_key_type === "iso_a3", "metrics identity");
  requireCondition(Array.isArray(metrics.metric_ids) && metrics.metric_ids.includes(metricId)
    && Array.isArray(metrics.features), "official metric or feature rows");
  const descriptor = THEMATIC_POPULATION_METRICS.find((metric) => metric.id === metricId);
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
      && (descriptor.unit !== "persons" || Number.isInteger(raw))
      && (descriptor.unit !== "percent" || raw <= 100)), `${joinKey} raw value range`);
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
      ...(Object.hasOwn(metric, "uncertainty") ? { uncertainty: frozenCopy(metric.uncertainty) } : {}),
    });
  }
  requireCondition(values + missing > 0, "empty observations");
  return Object.freeze({
    layerId: THEMATIC_POPULATION_LAYER_ID,
    dataVersion: THEMATIC_POPULATION_DATA_VERSION,
    metricId,
    supportedScenarios: Object.freeze([...consumer.supported_scenarios]),
    year: YEAR,
    byIsoA3: Object.freeze(byIsoA3),
    counts: Object.freeze({ features: values + missing, values, missing }),
  });
}

export async function loadThematicPopulationData({ metricId = THEMATIC_POPULATION_METRIC_ID, scenarioId = "modern_world", fetchJson = defaultFetchJson } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("population fetchJson must be a function");
  if (!isThematicPopulationMetricSupported(metricId)) throw new RangeError(`Unsupported population metric: ${metricId}`);
  if (!SUPPORTED_SCENARIOS.includes(scenarioId)) throw new RangeError(`Unsupported population scenario: ${scenarioId}`);
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
