import {
  THEMATIC_WGI_LAYER_ID, THEMATIC_WGI_METRIC_ID, THEMATIC_WGI_DATA_VERSION,
  isThematicWgiScenarioSupported,
  resolveThematicWgiJoinKey, getThematicWgiObservation,
} from "./thematic_wgi_data.js";
import { getThematicIndicator, getThematicIndicatorNote } from "./thematic_indicator_catalog.js";
import { getScenarioStatsObservation, SCENARIO_STATS_IDS } from "./thematic_scenario_stats_data.js";
import { getMapDataBoundary } from "../map_data_boundary.js";
import { getObjectIdentityToken } from "../renderer/object_identity.js";

export const THEMATIC_WGI_COLORS = Object.freeze(["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"]);
export const THEMATIC_WGI_MISSING_COLOR = "#d4d4d8";
export const THEMATIC_WGI_UNMATCHED_COLOR = "#f5ede1";

export function normalizeThematicWgiStyle(raw, scenarioId) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const metricId = value.metricId ?? (SCENARIO_STATS_IDS.includes(scenarioId) ? "scenario_population" : THEMATIC_WGI_METRIC_ID);
  const metric = getThematicIndicator(metricId);
  return {
    enabled: value.enabled === true,
    layerId: String(value.layerId ?? metric?.layerId ?? THEMATIC_WGI_LAYER_ID),
    metricId: String(metricId),
    dataVersion: String(value.dataVersion ?? metric?.dataVersion ?? THEMATIC_WGI_DATA_VERSION),
  };
}

export function isThematicWgiRequested(state) {
  const value = state?.styleConfig?.thematic;
  return value?.enabled === true && isThematicWgiScenarioSupported(state.activeScenarioId)
    && (getThematicIndicator(value.metricId)?.family !== "scenario" || SCENARIO_STATS_IDS.includes(state.activeScenarioId));
}

function isHistoricalReference(state) {
  return isThematicWgiScenarioSupported(state?.activeScenarioId) && state.activeScenarioId !== "modern_world";
}

export function getThematicReferenceNote(state) {
  if (!isHistoricalReference(state)) return "";
  const selection = normalizeThematicWgiStyle(state.styleConfig?.thematic, state.activeScenarioId);
  const metric = getThematicIndicator(selection.metricId);
  if (metric?.family === "scenario") return state.currentLanguage === "zh"
    ? "剧本开局数据，按基线归属汇总，不随涂色变化。"
    : "Scenario start data, grouped by baseline ownership and unaffected by painting.";
  const year = metric?.year || 2024;
  const note = state.currentLanguage === "zh"
    ? `${year} 参考映射，非剧本年代测量值。`
    : `${year} reference mapping, not a measurement for the scenario year.`;
  return metric?.unit === "persons" ? `${note} ${state.currentLanguage === "zh"
    ? "现代参考国总人口，并非剧本疆域人口合计。"
    : "Modern reference-country total, not the population of the scenario territory."}` : note;
}

function isPoliticalFeature(feature) {
  return !!feature && !feature.properties?.water_type && !feature.properties?.special_type
    && !feature.properties?.atl_color_rule;
}

export function isThematicWgiSelectionSupported(raw, scenarioId) {
  const value = normalizeThematicWgiStyle(raw, scenarioId);
  const metric = getThematicIndicator(value.metricId);
  return !!metric && value.layerId === metric.layerId && value.dataVersion === metric.dataVersion;
}

export function isThematicWgiActive(state) {
  const selection = normalizeThematicWgiStyle(state?.styleConfig?.thematic, state?.activeScenarioId);
  const data = state?.thematicWgiRuntime?.data;
  return isThematicWgiRequested(state) && isThematicWgiSelectionSupported(selection)
    && !state.scenarioApplyInFlight
    && state.thematicWgiRuntime?.status === "ready"
    && data?.layerId === selection.layerId && data?.metricId === selection.metricId
    && data?.dataVersion === selection.dataVersion
    && (getThematicIndicator(selection.metricId).family !== "scenario" || (
      data.metrics?.[selection.metricId]?.available === true
      && (!state.scenarioBaselineHash || data.baselineHash === state.scenarioBaselineHash)))
    && (data.supportedScenarios || ["modern_world"]).includes(state.activeScenarioId);
}

export function getThematicWgiSignature(state) {
  const value = state?.styleConfig?.thematic;
  if (!value?.enabled) return "";
  return JSON.stringify([state.activeScenarioId, value.layerId, value.metricId, value.dataVersion,
    state.thematicWgiRuntime?.status, state.thematicWgiRuntime?.revision, !!state.scenarioApplyInFlight,
    isHistoricalReference(state) ? [state.scenarioBaselineHash,
      getObjectIdentityToken(state.scenarioBaselineOwnersByFeatureId),
      getObjectIdentityToken(state.scenarioCountriesByTag)] : null]);
}

function getReference(state, feature) {
  const origin = getMapDataBoundary(state).reference.getFeatureOrigin(feature);
  if (!isHistoricalReference(state)) {
    return { joinKey: resolveThematicWgiJoinKey(feature, origin.geographicCountryCode), origin };
  }
  // A scenario tag is not an ISO code. Use only its declared modern reference,
  // so a historical country's score does not split along modern borders.
  const scenarioTag = origin.scenarioGroupCode;
  const iso2 = state.scenarioCountriesByTag?.[scenarioTag]?.base_iso2;
  const joinKey = typeof iso2 === "string" && /^[A-Z]{2}$/.test(iso2)
    ? resolveThematicWgiJoinKey(null, iso2) : "";
  return { joinKey, origin, scenarioTag };
}

export function getThematicWgiFeatureInspection(state, feature) {
  if (!isPoliticalFeature(feature) || !isThematicWgiActive(state)) return null;
  const data = state.thematicWgiRuntime.data;
  if (getThematicIndicator(data.metricId).family === "scenario") {
    const tag = getMapDataBoundary(state).reference.getFeatureOrigin(feature).scenarioGroupCode;
    return getScenarioStatsObservation(data, tag);
  }
  const reference = getReference(state, feature);
  const observation = getThematicWgiObservation(state.thematicWgiRuntime.data, reference.joinKey);
  return !isHistoricalReference(state) ? observation : {
    ...observation, referenceMapping: true, scenarioTag: reference.scenarioTag,
    referenceCountryCode: reference.joinKey,
  };
}

export function getThematicWgiColor(observation, metricId = observation?.metricId ?? THEMATIC_WGI_METRIC_ID) {
  if (observation?.status === "value") {
    const metric = getThematicIndicator(metricId);
    let index = 0;
    while (index < metric.thresholds.length && observation.value >= metric.thresholds[index]) index += 1;
    return metric.colors[index];
  }
  return observation?.status === "missing" ? THEMATIC_WGI_MISSING_COLOR : THEMATIC_WGI_UNMATCHED_COLOR;
}

export function resolveThematicWgiFeatureColor(state, feature) {
  const observation = getThematicWgiFeatureInspection(state, feature);
  return observation ? getThematicWgiColor(observation, state.thematicWgiRuntime.data.metricId) : null;
}

export function getThematicWgiLegend(state) {
  if (!isThematicWgiActive(state)) return null;
  const zh = state.currentLanguage === "zh";
  const metric = getThematicIndicator(state.thematicWgiRuntime.data.metricId);
  return {
    title: `${zh ? metric.labelZh : metric.labelEn} · ${metric.year ?? state.thematicWgiRuntime.data.year}`,
    note: getThematicIndicatorNote(metric, state.currentLanguage),
    source: metric.attribution ?? state.thematicWgiRuntime.data.source,
    binCount: metric.colors.length,
    referenceNote: getThematicReferenceNote(state),
    entries: [
      ...metric.colors.map((color, index) => ({ color, label: metric.labels[index] })),
      { color: THEMATIC_WGI_MISSING_COLOR, label: zh ? "来源缺失" : "Source missing" },
      { color: THEMATIC_WGI_UNMATCHED_COLOR, label: zh ? "未匹配／未覆盖" : "Unmatched / not covered" },
    ],
  };
}

const coverageCache = new WeakMap();
function getCoverage(state) {
  const features = state.landDataFull?.features || state.landData?.features;
  const payload = state.thematicWgiRuntime?.data;
  if (!payload) return { matched: 0, missing: 0, unmatched: 0 };
  const previous = coverageCache.get(state);
  const geography = state.runtimeCanonicalCountryByFeatureId;
  const scenarioId = state.activeScenarioId;
  const owners = state.scenarioBaselineOwnersByFeatureId;
  const countries = state.scenarioCountriesByTag;
  if (previous && previous.features === features && previous.payload === payload && previous.geography === geography
    && previous.scenarioId === scenarioId && previous.owners === owners && previous.countries === countries) return previous.value;
  const groups = { value: new Set(), missing: new Set(), unmatched: new Set() };
  if (getThematicIndicator(payload.metricId).family === "scenario") {
    const reference = getMapDataBoundary(state).reference;
    for (const id of Object.keys(reference.getScenarioAssignments())) {
      const tag = reference.getScenarioGroupCode(id);
      groups[getScenarioStatsObservation(payload, tag).status].add(tag);
    }
  } else {
    for (const feature of features || []) {
      if (!isPoliticalFeature(feature)) continue;
      const { joinKey, origin, scenarioTag } = getReference(state, feature);
      const observation = getThematicWgiObservation(payload, joinKey);
      groups[observation.status].add(isHistoricalReference(state) ? scenarioTag || "unknown"
        : joinKey || origin.geographicCountryCode || "unknown");
    }
  }
  const value = { matched: groups.value.size, missing: groups.missing.size, unmatched: groups.unmatched.size };
  coverageCache.set(state, { features, payload, geography, scenarioId, owners, countries, value });
  return value;
}

export function getThematicWgiViewModel(state) {
  const selection = normalizeThematicWgiStyle(state?.styleConfig?.thematic, state?.activeScenarioId);
  const supported = isThematicWgiScenarioSupported(state?.activeScenarioId);
  const runtime = state?.thematicWgiRuntime;
  const native = getThematicIndicator(selection.metricId)?.family === "scenario";
  const data = runtime?.data;
  const currentDocument = native && data?.layerId === selection.layerId && data.supportedScenarios.includes(state.activeScenarioId);
  const wrongBaseline = currentDocument && state.scenarioBaselineHash && data.baselineHash !== state.scenarioBaselineHash;
  const unavailable = native && (!SCENARIO_STATS_IDS.includes(state.activeScenarioId)
    || (currentDocument && data.metrics?.[selection.metricId]?.available === false));
  const status = !supported ? "unsupported" : !selection.enabled ? "off"
    : wrongBaseline ? "version-unavailable" : unavailable ? "metric-unavailable"
    : !isThematicWgiSelectionSupported(selection) ? "version-unavailable"
      : runtime?.status === "ready" && !isThematicWgiActive(state) ? "idle" : runtime?.status || "idle";
  return { ...selection, supported, status, error: runtime?.error || "", year: getThematicIndicator(selection.metricId)?.year ?? data?.year,
    historicalReference: isHistoricalReference(state), referenceNote: getThematicReferenceNote(state),
    legend: getThematicWgiLegend(state)?.entries || [],
    coverage: status === "ready" ? getCoverage(state) : { matched: 0, missing: 0, unmatched: 0 } };
}
