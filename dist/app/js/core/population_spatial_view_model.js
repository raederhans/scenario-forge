import {
  POPULATION_LAYER_ID, POPULATION_DATA_VERSION, POPULATION_YEAR, POPULATION_SCENARIO_IDS,
} from "./population_spatial_data.js";
import { getFeatureId } from "./feature_identity.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { getObjectIdentityToken } from "./renderer/object_identity.js";

export const POPULATION_DENSITY_THRESHOLDS = Object.freeze([1, 10, 50, 200, 1000, 5000]);
export const POPULATION_DENSITY_COLORS = Object.freeze([
  "#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026",
]);
export const POPULATION_MISSING_COLOR = "#d4d4d8";
export const POPULATION_UNESTIMATED_COLOR = "#e6d9f2";

export function normalizePopulationStyle(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    enabled: value.enabled === true,
    mode: value.mode === "heatmap" ? "heatmap" : "density",
    opacity: typeof value.opacity === "number" && Number.isFinite(value.opacity)
      ? Math.max(0, Math.min(1, value.opacity)) : 0.8,
    dataVersion: typeof value.dataVersion === "string" ? value.dataVersion : POPULATION_DATA_VERSION,
  };
}

export function isPopulationSupportedScenario(scenarioId) {
  return POPULATION_SCENARIO_IDS.includes(scenarioId);
}

export function isPopulationRequested(state) {
  return state?.styleConfig?.population?.enabled === true
    && isPopulationSupportedScenario(state.activeScenarioId)
    && normalizePopulationStyle(state.styleConfig.population).dataVersion === POPULATION_DATA_VERSION;
}

export function getPopulationGeometryVersion(state) {
  return state?.activeScenarioManifest?.source?.runtime_topology_sha256 || "";
}

export function isPopulationActive(state) {
  const data = state?.populationRuntime?.data;
  return isPopulationRequested(state) && !state.scenarioApplyInFlight
    && state.populationRuntime?.status === "ready"
    && data?.layerId === POPULATION_LAYER_ID && data.dataVersion === POPULATION_DATA_VERSION
    && data.year === POPULATION_YEAR && data.scenarioId === state.activeScenarioId
    && !!getPopulationGeometryVersion(state) && data.geometryVersion === getPopulationGeometryVersion(state);
}

export function getPopulationSignature(state) {
  if (!state?.styleConfig?.population?.enabled) return "";
  return JSON.stringify([state.activeScenarioId, normalizePopulationStyle(state.styleConfig.population),
    getPopulationGeometryVersion(state), state.populationRuntime?.status, state.populationRuntime?.revision,
    !!state.scenarioApplyInFlight, getObjectIdentityToken(state.scenarioBaselineOwnersByFeatureId)]);
}

export function getPopulationReferenceNote(state) {
  if (!isPopulationSupportedScenario(state?.activeScenarioId) || state.activeScenarioId === "modern_world") return "";
  return state.currentLanguage === "zh"
    ? "2020 年现代人口空间分布映射到剧本疆域，非剧本年代人口估计。"
    : "2020 modern population distribution mapped to scenario territory; not a scenario-year population estimate.";
}

export function getPopulationFeatureInspection(state, feature) {
  if (!isPopulationActive(state)) return null;
  const featureId = getFeatureId(feature, { fallback: "" });
  const observation = state.populationRuntime.data.byFeatureId[featureId];
  return {
    ...(observation || { feature_id: featureId, status: "missing", population: null,
      land_area_km2: null, density: null, coverage_fraction: null }),
    featureId, year: POPULATION_YEAR,
    referenceMapping: state.activeScenarioId !== "modern_world",
  };
}

export function getPopulationDensityColor(density) {
  if (typeof density !== "number" || !Number.isFinite(density) || density < 0) return POPULATION_MISSING_COLOR;
  let index = 0;
  while (index < POPULATION_DENSITY_THRESHOLDS.length && density >= POPULATION_DENSITY_THRESHOLDS[index]) index += 1;
  return POPULATION_DENSITY_COLORS[index];
}

export function resolvePopulationFeatureColor(state, feature) {
  if (normalizePopulationStyle(state?.styleConfig?.population).mode !== "density") return null;
  const row = getPopulationFeatureInspection(state, feature);
  if (!row || row.status === "water_not_applicable") return null;
  if (row.status === "unestimated_scenario_land") return POPULATION_UNESTIMATED_COLOR;
  return getPopulationDensityColor(row.density);
}

export function getPopulationLegend(state) {
  if (!isPopulationActive(state)) return null;
  const zh = state.currentLanguage === "zh";
  return {
    title: zh ? "人口密度 · 2020" : "Population density · 2020",
    note: normalizePopulationStyle(state.styleConfig.population).mode === "heatmap"
      ? (zh ? "人／平方公里有效人口栅格面积；1 km 来源栅格聚合。" : "Persons per km² of valid population raster area; aggregated from 1 km source cells.")
      : (zh ? "人／平方公里政治地块面积（减去 Natural Earth 湖泊）；2020 年栅格人口估计。"
        : "Persons per km² of political geometry minus Natural Earth lakes; 2020 gridded population estimates."),
    source: "European Commission, Joint Research Centre · GHSL GHS-POP R2023A (2020)",
    referenceNote: getPopulationReferenceNote(state), binCount: POPULATION_DENSITY_COLORS.length,
    entries: [
      ...POPULATION_DENSITY_COLORS.map((color, index) => ({ color,
        label: ["0–<1", "1–<10", "10–<50", "50–<200", "200–<1,000", "1,000–<5,000", "≥5,000"][index] })),
      { color: POPULATION_MISSING_COLOR, label: zh ? "数据缺失／未覆盖" : "Missing / not covered" },
      { color: POPULATION_UNESTIMATED_COLOR, label: zh ? "架空陆地未估计" : "Scenario land unestimated" },
    ],
  };
}

// All sums use immutable full payload rows, never viewport geometry or paint owners.
export function sumPopulationFeatures(state, featureIds) {
  if (!isPopulationActive(state)) return null;
  const ids = [...new Set(Array.from(featureIds || [], (id) => String(id).trim()).filter(Boolean))];
  const rows = state.populationRuntime.data.byFeatureId;
  const counts = { features: ids.length, observed: 0, partial: 0, missing: 0, unestimated: 0, water: 0 };
  let knownPopulation = 0;
  let landAreaKm2 = 0;
  let knownLandAreaKm2 = 0;
  let coveredAreaKm2 = 0;
  for (const id of ids) {
    const row = rows[id];
    if (!row) { counts.missing += 1; continue; }
    if (row.status === "water_not_applicable") { counts.water += 1; continue; }
    if (typeof row.land_area_km2 === "number") {
      landAreaKm2 += row.land_area_km2;
      coveredAreaKm2 += row.land_area_km2 * (row.coverage_fraction ?? 0);
    }
    if (row.status === "unestimated_scenario_land") counts.unestimated += 1;
    else if (row.population === null) counts.missing += 1;
    else {
      knownPopulation += row.population;
      knownLandAreaKm2 += row.land_area_km2;
      if (row.status === "partial_coverage") counts.partial += 1;
      else counts.observed += 1;
    }
  }
  const known = counts.observed + counts.partial > 0;
  const complete = ids.length > 0 && counts.missing + counts.unestimated + counts.partial === 0;
  return Object.freeze({
    year: POPULATION_YEAR, status: complete ? "complete" : known ? "partial" : "missing", complete,
    population: known ? knownPopulation : null, knownPopulation: known ? knownPopulation : null,
    landAreaKm2, knownLandAreaKm2, density: complete && known && knownLandAreaKm2 > 0 ? knownPopulation / knownLandAreaKm2 : null,
    coverageFraction: landAreaKm2 > 0 ? coveredAreaKm2 / landAreaKm2 : null,
    counts: Object.freeze(counts), featureIds: Object.freeze(ids),
  });
}

export function getPopulationCountrySummary(state, countryCode) {
  if (!isPopulationActive(state)) return null;
  return sumPopulationFeatures(state, getMapDataBoundary(state).reference.getScenarioGroupFeatureIds(countryCode));
}

export function getPopulationViewModel(state) {
  const style = normalizePopulationStyle(state?.styleConfig?.population);
  const supported = isPopulationSupportedScenario(state?.activeScenarioId);
  const runtime = state?.populationRuntime;
  const status = !supported ? "unsupported" : !style.enabled ? "off"
    : style.dataVersion !== POPULATION_DATA_VERSION ? "version-unavailable"
      : runtime?.status === "ready" && !isPopulationActive(state) ? "idle" : runtime?.status || "idle";
  return { ...style, supported, status, year: POPULATION_YEAR, error: runtime?.error || "",
    historicalReference: supported && state.activeScenarioId !== "modern_world",
    referenceNote: getPopulationReferenceNote(state), legend: getPopulationLegend(state)?.entries || [],
    coverage: isPopulationActive(state) ? state.populationRuntime.data.counts : null };
}
