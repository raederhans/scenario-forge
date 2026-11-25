import { resolveDataUrl } from "../data_base_url.js";
import { UI_COPY_CATALOG } from "../i18n_catalog.js";

const BASE_PATH = "data/thematic_layers/scenario/country_stats_v1/";
export const SCENARIO_STATS_LAYER_ID = "scenario_country_stats_v1";
export const SCENARIO_STATS_VERSION = "scenario-country-stats-v1";
export const SCENARIO_STATS_IDS = Object.freeze(["hoi4_1936", "hoi4_1939", "tno_1962"]);
const colors = Object.freeze(["#e5f5f9", "#b2e2e2", "#73b6ce", "#3182ae", "#08519c"]);
const formatCutoff = new Intl.NumberFormat("en", { notation: "compact" });

export const SCENARIO_STATS_METRICS = Object.freeze([
  ["scenario_population", "Population (scenario start)", "人口（剧本开局）", "persons", [1000000, 5000000, 20000000, 50000000]],
  ["scenario_land_area_km2", "Land area", "陆地面积", "km2", [50000, 200000, 1000000, 3000000]],
  ["scenario_population_density", "Population density", "人口密度", "persons_per_km2", [5, 25, 75, 150]],
  ["scenario_factories_total", "Factories", "工厂总数", "factories", [3, 10, 25, 60]],
  ["scenario_civilian_factories", "Civilian factories", "民用工厂", "factories", [2, 6, 15, 35]],
  ["scenario_military_factories", "Military factories", "军用工厂", "factories", [1, 4, 10, 25]],
  ["scenario_factories_per_million", "Factories per million people", "每百万人工厂数", "factories_per_million", [0.5, 1.5, 3, 5]],
  ["scenario_military_factory_share", "Military factory share", "军工占比", "percent", [15, 25, 35, 45]],
  ["scenario_steel", "Steel", "钢", "resource_points", [1, 10, 50, 150]],
  ["scenario_oil", "Oil", "石油", "resource_points", [1, 10, 50, 150]],
  ["scenario_resources_total", "Strategic resources total", "战略资源合计", "resource_points", [10, 50, 150, 400]],
  ["scenario_core_share", "Core territory share", "本国核心领土占比", "percent", [50, 75, 90, 99]],
].map(([id, labelEn, labelZh, unit, thresholds]) => Object.freeze({
  id, labelEn, labelZh, unit, thresholds: Object.freeze(thresholds), colors,
  family: "scenario", layerId: SCENARIO_STATS_LAYER_ID, dataVersion: SCENARIO_STATS_VERSION,
  labels: Object.freeze([`<${formatCutoff.format(thresholds[0])}`,
    ...thresholds.slice(1).map((n, i) => `${formatCutoff.format(thresholds[i])}–<${formatCutoff.format(n)}`),
    `≥${formatCutoff.format(thresholds.at(-1))}`]),
})));

async function defaultFetchJson(path) {
  const response = await fetch(resolveDataUrl(path));
  if (!response.ok) throw new Error(`Scenario statistics request failed: ${response.status}`);
  return response.json();
}

function matchesVersion(doc) {
  return doc?.schema_version === 1 && doc.layer_id === SCENARIO_STATS_LAYER_ID && doc.data_version === SCENARIO_STATS_VERSION;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateDocument(doc, declaredMetrics) {
  if (!isPlainObject(doc.metrics)
    || !declaredMetrics.every((id) => Object.hasOwn(doc.metrics, id))
    || !Object.values(doc.metrics).every((metric) => typeof metric?.available === "boolean")) {
    throw new Error("Invalid scenario statistics metrics");
  }
  const ids = Object.keys(doc.metrics);
  if (!isPlainObject(doc.countries) || !Object.values(doc.countries).every((row) => isPlainObject(row)
    && ids.every((id) => row[id] === null || Number.isFinite(row[id])))) {
    throw new Error("Invalid scenario statistics countries");
  }
  if (Object.hasOwn(doc, "non_political_tags") && !(Array.isArray(doc.non_political_tags)
    && doc.non_political_tags.every((tag) => typeof tag === "string"))) {
    throw new Error("Invalid scenario statistics non-political tags");
  }
}

const documentsByFetcher = new WeakMap();
export async function loadScenarioStatsDocument({ scenarioId, baselineHash, fetchJson = defaultFetchJson }) {
  if (!SCENARIO_STATS_IDS.includes(scenarioId)) throw new RangeError(`Unsupported scenario: ${scenarioId}`);
  let cache = documentsByFetcher.get(fetchJson);
  if (!cache) {
    cache = new Map();
    documentsByFetcher.set(fetchJson, cache);
  }
  const key = JSON.stringify([scenarioId, baselineHash || ""]);
  if (!cache.has(key)) {
    const request = (async () => {
      const manifest = await fetchJson(`${BASE_PATH}manifest.json`);
      const entry = manifest?.scenarios?.[scenarioId];
      if (!matchesVersion(manifest) || !entry?.path || !/^[a-f\d]{64}$/i.test(entry.baseline_hash)
        || (baselineHash && baselineHash !== entry.baseline_hash)) throw new Error("Invalid scenario statistics manifest or baseline");
      const doc = await fetchJson(BASE_PATH + entry.path);
      if (!matchesVersion(doc) || doc.scenario_id !== scenarioId || doc.baseline_hash !== entry.baseline_hash) {
        throw new Error("Invalid scenario statistics identity or baseline");
      }
      validateDocument(doc, manifest.metric_ids);
      return doc;
    })();
    cache.set(key, request);
    request.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

function scenarioSource(metricId, scenarioId) {
  switch (metricId) {
    case "scenario_land_area_km2": return "Scenario parcel geometry area (GHSL 2020 companion)";
    case "scenario_core_share": return "Scenario cores × parcel area";
    case "scenario_population_density":
    case "scenario_factories_per_million":
    case "scenario_military_factory_share": return "Derived from scenario state data and parcel area";
    default: return `${scenarioId.toUpperCase().replace("_", " ")} state data · scenario start · split states apportioned by 2020 population or area`;
  }
}

export function getScenarioStatsSource(data, language) {
  return UI_COPY_CATALOG[data.source][language === "zh" ? "zh" : "en"];
}

export async function loadScenarioStatsData(options) {
  const doc = await loadScenarioStatsDocument(options);
  const { metricId, scenarioId } = options;
  if (typeof doc.metrics?.[metricId]?.available !== "boolean") throw new Error(`Missing scenario metric: ${metricId}`);
  const year = Number(String(doc.as_of_date ?? "").match(/^\d{4}/)?.[0]) || null;
  return {
    layerId: SCENARIO_STATS_LAYER_ID, dataVersion: SCENARIO_STATS_VERSION, metricId,
    supportedScenarios: [scenarioId], baselineHash: doc.baseline_hash, metrics: doc.metrics, countries: doc.countries,
    nonPoliticalTags: doc.non_political_tags ?? [], year, source: scenarioSource(metricId, scenarioId),
  };
}

export function getScenarioStatsObservation(data, tag) {
  if (!tag || !Object.hasOwn(data.countries, tag)) return { status: "unmatched", value: null, joinKey: tag };
  const value = data.countries[tag][data.metricId];
  return { status: value == null ? "missing" : "value", value, joinKey: tag, metricId: data.metricId };
}
