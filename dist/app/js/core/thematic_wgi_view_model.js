import {
  THEMATIC_WGI_LAYER_ID, THEMATIC_WGI_METRIC_ID, THEMATIC_WGI_DATA_VERSION,
  isThematicWgiScenarioSupported,
  resolveThematicWgiJoinKey, getThematicWgiObservation,
} from "./thematic_wgi_data.js";
import { getThematicIndicator, getThematicIndicatorNote } from "./thematic_indicator_catalog.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { getObjectIdentityToken } from "./renderer/object_identity.js";

export const THEMATIC_WGI_COLORS = Object.freeze(["#edf8fb", "#b2e2e2", "#66c2a4", "#2ca25f", "#006d2c"]);
export const THEMATIC_WGI_MISSING_COLOR = "#d4d4d8";
export const THEMATIC_WGI_UNMATCHED_COLOR = "#f5ede1";

export function normalizeThematicWgiStyle(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const metric = getThematicIndicator(value.metricId ?? THEMATIC_WGI_METRIC_ID);
  return {
    enabled: value.enabled === true,
    layerId: String(value.layerId ?? metric?.layerId ?? THEMATIC_WGI_LAYER_ID),
    metricId: String(value.metricId ?? THEMATIC_WGI_METRIC_ID),
    dataVersion: String(value.dataVersion ?? metric?.dataVersion ?? THEMATIC_WGI_DATA_VERSION),
  };
}

export function isThematicWgiRequested(state) {
  const value = state?.styleConfig?.thematic;
  return value?.enabled === true && isThematicWgiScenarioSupported(state?.activeScenarioId);
}

function isHistoricalReference(state) {
  return isThematicWgiScenarioSupported(state?.activeScenarioId) && state.activeScenarioId !== "modern_world";
}

export function getThematicReferenceNote(state) {
  if (!isHistoricalReference(state)) return "";
  const metric = getThematicIndicator(state?.styleConfig?.thematic?.metricId);
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

export function isThematicWgiSelectionSupported(raw) {
  const value = normalizeThematicWgiStyle(raw);
  const metric = getThematicIndicator(value.metricId);
  return !!metric && value.layerId === metric.layerId && value.dataVersion === metric.dataVersion;
}

export function isThematicWgiActive(state) {
  const selection = normalizeThematicWgiStyle(state?.styleConfig?.thematic);
  const data = state?.thematicWgiRuntime?.data;
  return isThematicWgiRequested(state) && isThematicWgiSelectionSupported(state.styleConfig.thematic)
    && !state.scenarioApplyInFlight
    && state.thematicWgiRuntime?.status === "ready"
    && data?.layerId === selection.layerId && data?.metricId === selection.metricId
    && data?.dataVersion === selection.dataVersion
    && (data.supportedScenarios || ["modern_world"]).includes(state.activeScenarioId);
}

export function getThematicWgiSignature(state) {
  const value = state?.styleConfig?.thematic;
  if (!value?.enabled) return "";
  return JSON.stringify([state.activeScenarioId, value.layerId, value.metricId, value.dataVersion,
    state.thematicWgiRuntime?.status, state.thematicWgiRuntime?.revision, !!state.scenarioApplyInFlight,
    isHistoricalReference(state) ? ["scenario-base-iso2-v1",
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
    title: `${zh ? metric.labelZh : metric.labelEn} · ${metric.year}`,
    note: getThematicIndicatorNote(metric, state.currentLanguage),
    source: metric.attribution,
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
  const features = state.landDataFull?.features || state.landData?.features || [];
  const payload = state.thematicWgiRuntime?.data;
  if (!payload) return { matched: 0, missing: 0, unmatched: 0 };
  const previous = coverageCache.get(state);
  const geography = state.runtimeCanonicalCountryByFeatureId;
  const scenarioId = state.activeScenarioId;
  const owners = state.scenarioBaselineOwnersByFeatureId;
  const countries = state.scenarioCountriesByTag;
  if (previous?.features === features && previous.payload === payload && previous.geography === geography
    && previous.scenarioId === scenarioId && previous.owners === owners && previous.countries === countries) return previous.value;
  const groups = { value: new Set(), missing: new Set(), unmatched: new Set() };
  for (const feature of features) {
    if (!isPoliticalFeature(feature)) continue;
    const { joinKey, origin, scenarioTag } = getReference(state, feature);
    const observation = getThematicWgiObservation(payload, joinKey);
    groups[observation.status].add(isHistoricalReference(state) ? scenarioTag || "unknown"
      : joinKey || origin.geographicCountryCode || "unknown");
  }
  const value = { matched: groups.value.size, missing: groups.missing.size, unmatched: groups.unmatched.size };
  coverageCache.set(state, { features, payload, geography, scenarioId, owners, countries, value });
  return value;
}

export function getThematicWgiViewModel(state) {
  const selection = normalizeThematicWgiStyle(state?.styleConfig?.thematic);
  const supported = isThematicWgiScenarioSupported(state?.activeScenarioId);
  const runtime = state?.thematicWgiRuntime;
  const status = !supported ? "unsupported" : !selection.enabled ? "off"
    : !isThematicWgiSelectionSupported(selection) ? "version-unavailable"
      : runtime?.status === "ready" && !isThematicWgiActive(state) ? "idle" : runtime?.status || "idle";
  return { ...selection, supported, status, error: runtime?.error || "", year: getThematicIndicator(selection.metricId)?.year,
    historicalReference: isHistoricalReference(state), referenceNote: getThematicReferenceNote(state),
    legend: getThematicWgiLegend(state)?.entries || [],
    coverage: status === "ready" ? getCoverage(state) : { matched: 0, missing: 0, unmatched: 0 } };
}
