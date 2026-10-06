import countryCodeMapping from "../../data/thematic_layers/wgi_country_code_mapping.json" with { type: "json" };
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";

export const THEMATIC_WGI_LAYER_ID = "political_wgi_state_capacity_v1";
export const THEMATIC_WGI_METRIC_ID = "wgi_government_effectiveness_score_0_100";
export const THEMATIC_WGI_DATA_VERSION = "wgi-2025-revision-v7:2024";
export const THEMATIC_WGI_SCENARIO_IDS = Object.freeze([
  "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962",
]);
export function isThematicWgiScenarioSupported(scenarioId) {
  return THEMATIC_WGI_SCENARIO_IDS.includes(scenarioId);
}
export const THEMATIC_WGI_METRICS = Object.freeze([
  Object.freeze({ id: THEMATIC_WGI_METRIC_ID, labelEn: "Government effectiveness", labelZh: "政府效能" }),
  Object.freeze({ id: "wgi_rule_of_law_score_0_100", labelEn: "Rule of law", labelZh: "法治" }),
  Object.freeze({ id: "wgi_voice_and_accountability_score_0_100", labelEn: "Voice and accountability", labelZh: "发声与问责" }),
  Object.freeze({ id: "wgi_political_stability_score_0_100", labelEn: "Political stability and absence of violence", labelZh: "政治稳定与免于暴力" }),
  Object.freeze({ id: "wgi_regulatory_quality_score_0_100", labelEn: "Regulatory quality", labelZh: "监管质量" }),
  Object.freeze({ id: "wgi_control_of_corruption_score_0_100", labelEn: "Control of corruption", labelZh: "腐败控制" }),
]);

export function isThematicWgiMetricSupported(metricId) {
  return THEMATIC_WGI_METRICS.some((metric) => metric.id === metricId);
}

const YEAR = 2024;
const BASE_PATH = "data/thematic_layers/political/wgi_state_capacity_v1/";
const ISO_A2_TO_A3 = Object.freeze({ ...countryCodeMapping.by_iso_a2 });
const requestsByFetcher = new WeakMap();

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WGI data request failed: ${response.status}`);
  return response.json();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid WGI data: ${message}`);
}

function frozenCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozenCopy(child)])));
  }
  return value;
}

function normalizePayload(manifest, metrics, metricId) {
  const source = manifest?.provenance?.find((entry) => entry.source_id === "world_bank_wgi_2025_revision");
  requireCondition(manifest?.schema_version === 1 && manifest.layer_id === THEMATIC_WGI_LAYER_ID, "manifest identity");
  requireCondition(source?.version === "7"
    && source.release === "WGI 2025 Revision: Governance Estimates and Absolute Scores (1996-2024)"
    && source.selected_year === YEAR && manifest.period?.year === YEAR, "release version or year");
  requireCondition(manifest.source_policy === "real_source_cache_only" && manifest.status !== "fixture", "real-source policy");
  const consumer = manifest.runtime_consumer;
  requireCondition(consumer?.data_version === THEMATIC_WGI_DATA_VERSION, "runtime data version");
  requireCondition(consumer.status === "main_map_ready" && consumer.supports_main_map_render === true
    && Array.isArray(consumer.supported_scenarios) && consumer.supported_scenarios.includes("modern_world")
    && new Set(consumer.supported_scenarios).size === consumer.supported_scenarios.length
    && consumer.supported_scenarios.every(isThematicWgiScenarioSupported), "runtime main-map support");
  requireCondition(Array.isArray(manifest.metric_ids) && Array.isArray(consumer.supported_metrics)
    && consumer.supported_metrics.length > 0
    && new Set(consumer.supported_metrics).size === consumer.supported_metrics.length
    && consumer.supported_metrics.every((id) => isThematicWgiMetricSupported(id) && manifest.metric_ids.includes(id))
    && consumer.supported_metrics.includes(metricId), "runtime metric support");
  requireCondition(metrics?.schema_version === 1 && metrics.layer_id === THEMATIC_WGI_LAYER_ID
    && metrics.geography_level === "admin0" && metrics.join_key_type === "iso_a3", "metrics identity");
  requireCondition(metrics.metric_ids?.includes(metricId) && Array.isArray(metrics.features), "official metric or feature rows");
  const byIsoA3 = Object.create(null);
  let values = 0;
  let missing = 0;
  for (const row of metrics.features) {
    const joinKey = row?.join_key;
    requireCondition(typeof joinKey === "string" && /^[A-Z]{3}$/.test(joinKey)
      && !Object.hasOwn(byIsoA3, joinKey), "duplicate or invalid join key");
    const metric = row.values?.[metricId];
    requireCondition(metric?.year === YEAR && metric.unit === "score_0_100", `${joinKey} metric year or unit`);
    const value = metric.normalized_value;
    requireCondition(value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100), `${joinKey} score range`);
    requireCondition(metric.raw_value === value, `${joinKey} official score passthrough`);
    requireCondition(value === null ? metric.source_status === "source_gap" : metric.source_status === "observed", `${joinKey} observation status`);
    if (value === null) missing += 1;
    else values += 1;
    byIsoA3[joinKey] = Object.freeze({
      status: value === null ? "missing" : "value",
      value,
      joinKey,
      name: String(row.name ?? ""),
      year: YEAR,
      sourceStatus: metric.source_status,
      uncertainty: frozenCopy(metric.uncertainty ?? null),
    });
  }
  requireCondition(values + missing > 0, "empty observations");
  return Object.freeze({
    layerId: THEMATIC_WGI_LAYER_ID,
    dataVersion: THEMATIC_WGI_DATA_VERSION,
    metricId,
    supportedScenarios: Object.freeze([...consumer.supported_scenarios]),
    year: YEAR,
    range: Object.freeze([0, 100]),
    byIsoA3: Object.freeze(byIsoA3),
    counts: Object.freeze({ features: values + missing, values, missing }),
  });
}

export async function loadThematicWgiData({ metricId = THEMATIC_WGI_METRIC_ID, scenarioId = "modern_world", fetchJson = defaultFetchJson } = {}) {
  if (typeof fetchJson !== "function") throw new TypeError("WGI fetchJson must be a function");
  if (!isThematicWgiMetricSupported(metricId)) throw new RangeError(`Unsupported WGI metric: ${metricId}`);
  if (!isThematicWgiScenarioSupported(scenarioId)) throw new RangeError(`Unsupported WGI scenario: ${scenarioId}`);
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

function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

// Supply a geographic ISO-2 code or a scenario's explicitly declared modern
// reference ISO-2 code here, never a raw scenario owner tag.
export function resolveThematicWgiJoinKey(feature, geographicCountryCode = "") {
  const props = feature?.properties;
  const upperIso3 = normalizeCode(props?.ISO_A3);
  if (/^[A-Z]{3}$/.test(upperIso3)) return upperIso3;
  const lowerIso3 = normalizeCode(props?.iso_a3);
  if (/^[A-Z]{3}$/.test(lowerIso3)) return lowerIso3;
  let alpha2 = normalizeCode(geographicCountryCode);
  if (!alpha2) alpha2 = normalizeCode(props?.ISO_A2) || normalizeCode(props?.iso_a2) || normalizeCode(props?.cntr_code);
  if (!/^[A-Z]{2}$/.test(alpha2)) return "";
  alpha2 = normalizeCountryCodeAlias(alpha2);
  return ISO_A2_TO_A3[alpha2] || "";
}

export function getThematicWgiObservation(payload, joinKey) {
  const key = normalizeCode(joinKey);
  const observation = payload?.byIsoA3?.[key];
  if (observation) return observation;
  return Object.freeze({ status: "unmatched", value: null, joinKey: key, uncertainty: null });
}
