import { getStrategicFeatureInspection, STRATEGIC_METRIC_NAMES } from "./strategic_values_view_model.js";
// Translation helpers (Phase 13)
import { state as runtimeState } from "./state.js";
import { UI_COPY_CATALOG } from "./i18n_catalog.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  getCountryCode as getSharedFeatureCountryCode,
  getFeatureId as getSharedFeatureId,
} from "./feature_identity.js";
import { getScenarioCountryDisplayName } from "./scenario_country_display.js";
const state = runtimeState;

const US_LEGACY_ZONE_LABEL_RE = /(?:\bZone\s+\d+\b|第?\s*\d+\s*[区號号])/i;
let startupSupportKeyUsageAuditEnabled = false;
let startupSupportKeyUsageAuditState = null;

function setStartupSupportKeyUsageAuditEnabled(enabled = false) {
  startupSupportKeyUsageAuditEnabled = enabled === true;
  if (!startupSupportKeyUsageAuditEnabled) {
    startupSupportKeyUsageAuditState = null;
  }
}

function shouldCaptureStartupSupportKeyUsage() {
  return startupSupportKeyUsageAuditEnabled === true;
}

function getStartupSupportKeyUsageAuditState() {
  if (!shouldCaptureStartupSupportKeyUsage()) {
    return null;
  }
  if (!startupSupportKeyUsageAuditState) {
    startupSupportKeyUsageAuditState = {
      queryKeys: new Set(),
      directLocaleKeys: new Set(),
      aliasKeys: new Set(),
      aliasTargetKeys: new Set(),
      missKeys: new Set(),
    };
  }
  return startupSupportKeyUsageAuditState;
}

function recordStartupSupportKeyUsage({
  queryKey = "",
  directLocaleKey = "",
  aliasKey = "",
  aliasTargetKey = "",
  miss = false,
} = {}) {
  const auditState = getStartupSupportKeyUsageAuditState();
  if (!auditState) return;
  const normalizedQueryKey = String(queryKey || "").trim();
  if (normalizedQueryKey) {
    auditState.queryKeys.add(normalizedQueryKey);
  }
  const normalizedDirectLocaleKey = String(directLocaleKey || "").trim();
  if (normalizedDirectLocaleKey) {
    auditState.directLocaleKeys.add(normalizedDirectLocaleKey);
  }
  const normalizedAliasKey = String(aliasKey || "").trim();
  if (normalizedAliasKey) {
    auditState.aliasKeys.add(normalizedAliasKey);
  }
  const normalizedAliasTargetKey = String(aliasTargetKey || "").trim();
  if (normalizedAliasTargetKey) {
    auditState.aliasTargetKeys.add(normalizedAliasTargetKey);
  }
  if (miss && normalizedQueryKey) {
    auditState.missKeys.add(normalizedQueryKey);
  }
}

function resolveGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  const geoLocales = runtimeState.locales?.geo || {};
  if (geoLocales[candidate]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      directLocaleKey: candidate,
    });
    return geoLocales[candidate];
  }

  const stableKey = runtimeState.geoAliasToStableKey?.[candidate];
  if (stableKey && geoLocales[stableKey]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      aliasKey: candidate,
      aliasTargetKey: stableKey,
    });
    return geoLocales[stableKey];
  }
  recordStartupSupportKeyUsage({
    queryKey: candidate,
    miss: true,
  });
  return null;
}

function resolveGeoLocaleText(
  key,
  {
    allowCrossLanguageFallback = true,
    includeCandidateFallback = true,
  } = {}
) {
  const candidate = String(key || "").trim();
  if (!candidate) return "";
  const entry = resolveGeoLocaleEntry(candidate);
  if (!entry || typeof entry !== "object") return "";
  const preferred = runtimeState.currentLanguage === "zh" ? entry.zh : entry.en;
  const secondary = runtimeState.currentLanguage === "zh" ? entry.en : entry.zh;
  return String(
    preferred
      || (allowCrossLanguageFallback ? secondary : "")
      || (includeCandidateFallback ? candidate : "")
  ).trim();
}

function getPreferredGeoLabel(candidates = [], fallback = "", options = {}) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const localized = resolveGeoLocaleText(candidate, options);
    if (localized) return localized;
  }
  return String(fallback || "").trim();
}

function getStrictGeoLabel(candidates = [], fallback = "") {
  return getPreferredGeoLabel(candidates, fallback, {
    allowCrossLanguageFallback: false,
    includeCandidateFallback: false,
  });
}

function hasExplicitScenarioGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  if (!candidate) return false;
  const scenarioGeo = runtimeState.scenarioGeoLocalePatchData?.geo;
  return !!(
    scenarioGeo
    && typeof scenarioGeo === "object"
    && Object.prototype.hasOwnProperty.call(scenarioGeo, candidate)
  );
}

function getSafeRawFeatureLabel(candidates = []) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const entry = resolveGeoLocaleEntry(candidate);
    if (!entry || typeof entry !== "object") continue;
    const entryEn = String(entry.en || "").trim();
    const entryZh = String(entry.zh || "").trim();
    const isSafeDirectMatch = (entryEn && entryEn === candidate) || (!entryEn && entryZh === candidate);
    if (!isSafeDirectMatch) continue;
    const localized = resolveGeoLocaleText(candidate, {
      allowCrossLanguageFallback: true,
      includeCandidateFallback: false,
    });
    if (localized) return localized;
  }
  return "";
}

function isUsFeature(feature) {
  const featureId = getSharedFeatureId(feature);
  const countryCode = getSharedFeatureCountryCode(feature);
  return countryCode === "US" || featureId.startsWith("US_");
}

function isUsLegacyZoneLabel(text) {
  return US_LEGACY_ZONE_LABEL_RE.test(String(text || "").trim());
}

function getGeoFeatureDisplayLabel(feature, fallback = "") {
  const props = feature?.properties || {};
  const rawNameCandidates = [
    props.label,
    props.name,
    props.name_en,
    props.NAME,
  ];
  const canonicalRawName = String(
    rawNameCandidates.find((value) => String(value || "").trim()) || ""
  ).trim();
  const preferredIdCandidates = [];
  [
    props.__city_host_feature_id,
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    preferredIdCandidates.push(candidate);
  });
  [
    props.id,
    feature?.id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    if (hasExplicitScenarioGeoLocaleEntry(candidate)) {
      preferredIdCandidates.push(candidate);
    }
  });
  const explicitLabel = getPreferredGeoLabel(preferredIdCandidates, "", {
    allowCrossLanguageFallback: true,
    includeCandidateFallback: false,
  });
  const shouldBypassUsLegacyZoneLabel = (
    explicitLabel
    && isUsFeature(feature)
    && canonicalRawName
    && !isUsLegacyZoneLabel(canonicalRawName)
    && isUsLegacyZoneLabel(explicitLabel)
  );
  if (explicitLabel && !shouldBypassUsLegacyZoneLabel) {
    return explicitLabel;
  }

  const safeRawLabel = getSafeRawFeatureLabel(rawNameCandidates);
  if (safeRawLabel) {
    return safeRawLabel;
  }

  return String(
    rawNameCandidates.find((value) => String(value || "").trim())
    || props.id
    || feature?.id
    || fallback
  ).trim();
}

function t(key, type = "geo") {
  if (!key) return "";
  // geo 文案优先走 runtime locale / alias 真相源；
  // UI 文案则先看 runtime 注入，再退回静态 catalog，保证启动期和完整加载后共用同一套调用入口。
  const entry = type === "geo" ? resolveGeoLocaleEntry(key) : runtimeState.locales?.[type]?.[key];
  const lang = runtimeState.currentLanguage === "zh" ? "zh" : "en";
  if (entry?.[lang] || entry?.en) {
    return entry?.[lang] || entry?.en || key;
  }
  if (type !== "geo") {
    const inlineEntry = UI_COPY_CATALOG[key];
    if (inlineEntry?.[lang] || inlineEntry?.en) {
      return inlineEntry?.[lang] || inlineEntry?.en || key;
    }
  }
  return key;
}

function getTooltipFeatureId(feature) {
  return getSharedFeatureId(feature);
}

function normalizeTooltipCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function getTooltipFeatureCountryCode(feature, { useIdFallback = false } = {}) {
  return normalizeTooltipCountryCode(getSharedFeatureCountryCode(feature, { useIdFallback }));
}

function getTooltipRegionName(feature, fallback) {
  const rawName =
    getGeoFeatureDisplayLabel(feature) ||
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    fallback;
  return rawName || fallback;
}

function normalizeTooltipComparisonValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getTooltipCountryContext(feature) {
  if (runtimeState.mapSemanticMode === "blank") {
    return {
      countryCode: "",
      countryDisplayName: "",
    };
  }
  const featureId = getTooltipFeatureId(feature);
  const scenarioBaselineCode = runtimeState.activeScenarioId
    ? normalizeTooltipCountryCode(runtimeState.scenarioBaselineOwnersByFeatureId?.[featureId] || "")
    : "";
  const countryCode = scenarioBaselineCode || getTooltipFeatureCountryCode(feature, { useIdFallback: true });
  const rawCountryName =
    getScenarioCountryDisplayName(runtimeState.scenarioCountriesByTag?.[countryCode]) ||
    runtimeState.countryNames?.[countryCode] ||
    countryCode;
  const countryDisplayName = t(rawCountryName, "geo") || rawCountryName || countryCode;
  return {
    countryCode,
    countryDisplayName,
  };
}

function getTooltipAdmin1Name(feature, { regionName = "", countryDisplayName = "" } = {}) {
  const candidates = [
    feature?.properties?.admin1_group,
    feature?.properties?.constituent_country,
  ];
  const regionKey = normalizeTooltipComparisonValue(regionName);
  const countryKey = normalizeTooltipComparisonValue(countryDisplayName);

  for (const candidate of candidates) {
    const rawValue = String(candidate || "").trim();
    if (!rawValue) continue;
    const displayValue = t(rawValue, "geo") || rawValue;
    const comparisonValue = normalizeTooltipComparisonValue(displayValue);
    if (!comparisonValue) continue;
    if (comparisonValue === regionKey || comparisonValue === countryKey) continue;
    return displayValue;
  }

  return "";
}

function buildLegacyTooltipModel(feature, { isWaterRegion = false, isSpecialRegion = false } = {}) {
  const fallback = isWaterRegion ? t("Unknown Water Region", "ui") : t("Unknown Region", "ui");
  const name = getTooltipRegionName(feature, fallback);
  const code = getTooltipFeatureCountryCode(feature);
  const labelKey = isWaterRegion ? "Water Region" : "Region";
  const label = runtimeState.currentLanguage === "zh" ? t(labelKey, "ui") : labelKey;
  const waterType = isWaterRegion ? String(feature?.properties?.water_type || "").trim() : "";
  const specialType = isSpecialRegion ? String(feature?.properties?.special_type || "").trim() : "";
  const lines = [];

  if (!name && !code) {
    lines.push(label);
  } else if (waterType) {
    lines.push(`${label}: ${name} (${waterType})`);
  } else if (specialType) {
    lines.push(`${label}: ${name} (${specialType})`);
  } else if (code) {
    lines.push(`${label}: ${name} (${code})`);
  } else {
    lines.push(`${label}: ${name}`);
  }

  return {
    regionName: name,
    admin1Name: "",
    countryCode: code,
    countryDisplayName: "",
    lines,
  };
}

function buildTooltipModel(feature) {
  if (!feature) {
    return {
      regionName: "",
      admin1Name: "",
      countryCode: "",
      countryDisplayName: "",
      lines: [],
    };
  }

  const isWaterRegion = !!feature?.properties?.water_type;
  const isSpecialRegion = !!feature?.properties?.special_type;
  if (isWaterRegion || isSpecialRegion) {
    return buildLegacyTooltipModel(feature, { isWaterRegion, isSpecialRegion });
  }

  const regionName = getTooltipRegionName(feature, t("Unknown Region", "ui"));
  const { countryCode, countryDisplayName } = getTooltipCountryContext(feature);
  const admin1Name = getTooltipAdmin1Name(feature, {
    regionName,
    countryDisplayName,
  });
  const lines = [regionName];
  if (admin1Name) {
    lines.push(admin1Name);
  }
  if (countryDisplayName) {
    lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
  }

  return {
    regionName,
    admin1Name,
    countryCode,
    countryDisplayName,
    lines: lines.filter(Boolean),
  };
}

function renderTooltipText(model) {
  const lines = Array.isArray(model?.lines) ? model.lines.filter(Boolean) : [];
  return lines.join("\n");
}

function getTooltipText(feature) {
  const base = renderTooltipText(buildTooltipModel(feature));
  if (!feature || feature.properties?.water_type || feature.properties?.special_type) return base;
  const strategic = getStrategicFeatureInspection(runtimeState, getSharedFeatureId(feature));
  if (!strategic) return base;
  const zh = runtimeState.currentLanguage === "zh";
  const label = STRATEGIC_METRIC_NAMES[strategic.metricId]?.[zh ? 1 : 0] || strategic.metricId;
  const value = strategic.hasValue ? strategic.value.toLocaleString() : (zh ? "无数据" : "No data");
  const source = strategic.mapped ? ` · ${zh ? "来源区域" : "source region"} ${strategic.id}` : "";
  return `${base}\n${label}: ${value}${source}\n${zh ? "剧本游戏数值" : "Scenario game values"}`;
}

function consumeStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  startupSupportKeyUsageAuditState = null;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(runtimeState.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(runtimeState.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function getStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(runtimeState.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(runtimeState.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function clearStartupSupportKeyUsageAuditReport() {
  startupSupportKeyUsageAuditState = null;
}

export {
  clearStartupSupportKeyUsageAuditReport,
  consumeStartupSupportKeyUsageAuditReport,
  getStartupSupportKeyUsageAuditReport,
  setStartupSupportKeyUsageAuditEnabled,
  t,
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getGeoFeatureDisplayLabel,
  getTooltipCountryContext,
  buildTooltipModel,
  renderTooltipText,
  getTooltipText,
};
