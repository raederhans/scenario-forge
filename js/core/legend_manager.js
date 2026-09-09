// Legend manager (Phase 13)

import { getScenarioCountryDisplayName } from "./scenario_country_display.js";
import {
  DEFAULT_LEGEND_CONFIG,
  DEFAULT_LEGEND_CONTROL,
  LEGEND_CONTROL_LIMITS,
  normalizeColor,
  normalizeLabels,
  normalizeLegendConfig,
  normalizeLegendControl,
  getUniqueLegendColors,
  getLegendColorRevisionKey,
} from "./legend_state_normalizers.js";
import { patchLegendState, setLegendLabelState, ensureLegendState } from "./state/actions/legend_actions.js";
import {
  getFeatureId,
  getFeatureOwnerCode,
} from "./sovereignty_manager.js";
import {
  getSpecialZoneLegendLayers,
  getSpecialZoneLegendSignature,
} from "./special_zone_layers.js";

const MODERN_MAJOR_POWER_ORDER = Object.freeze([
  "USA",
  "GER",
  "JAP",
  "CHI",
  "PRC",
  "ENG",
  "FRA",
  "RUS",
  "SOV",
  "IND",
  "RAJ",
  "ITA",
  "CAN",
  "BRA",
  "AST",
  "TUR",
  "MEX",
  "ARG",
  "SAF",
]);

const CONTINENT_OPTIONS = Object.freeze([
  { id: "all", label: "全部大洲" },
  { id: "europe", label: "欧洲" },
  { id: "asia", label: "亚洲" },
  { id: "middle-east", label: "中东" },
  { id: "africa", label: "非洲" },
  { id: "north-america", label: "北美" },
  { id: "south-america", label: "南美" },
  { id: "oceania", label: "大洋洲" },
  { id: "antarctica", label: "南极洲" },
]);

const FALLBACK_LEGEND_COLORS = Object.freeze([
  "#9a1b1e",
  "#2f4f6f",
  "#6f8f5f",
  "#cfa264",
  "#8a4768",
  "#4f6f91",
  "#59636f",
  "#b05b3c",
  "#457b72",
  "#82639a",
  "#9b8d45",
  "#3f5d8a",
  "#8c3f3f",
  "#5e7758",
  "#ba7d49",
]);

const MAJOR_POWER_BOOST = 2.2;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function hashString(value) {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashString(seed || "legend");
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function polygonRingArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area += Number(current?.[0] || 0) * Number(next?.[1] || 0);
    area -= Number(next?.[0] || 0) * Number(current?.[1] || 0);
  }
  return Math.abs(area) / 2;
}

function fallbackFeatureArea(feature) {
  const geometry = feature?.geometry || {};
  const coordinates = geometry.coordinates;
  if (geometry.type === "Polygon") {
    return (coordinates || []).reduce((total, ring) => total + polygonRingArea(ring), 0);
  }
  if (geometry.type === "MultiPolygon") {
    return (coordinates || []).reduce((total, polygon) => (
      total + (polygon || []).reduce((polygonTotal, ring) => polygonTotal + polygonRingArea(ring), 0)
    ), 0);
  }
  return 1;
}

function getFeatureArea(feature) {
  if (typeof globalThis.d3?.geoArea === "function") {
    const value = Number(globalThis.d3.geoArea(feature));
    if (Number.isFinite(value) && value > 0) return value;
  }
  const fallback = fallbackFeatureArea(feature);
  return fallback > 0 ? fallback : 1;
}

function normalizeContinentId(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/(europe|europa|欧洲)/i.test(text)) return "europe";
  if (/(middle.?east|levant|arabia|中东)/i.test(text)) return "middle-east";
  if (/(asia|亚洲|east asia|south asia|central asia|siberia)/i.test(text)) return "asia";
  if (/(africa|非洲)/i.test(text)) return "africa";
  if (/(north.?america|北美)/i.test(text)) return "north-america";
  if (/(south.?america|latin.?america|南美)/i.test(text)) return "south-america";
  if (/(oceania|australia|pacific|大洋洲)/i.test(text)) return "oceania";
  if (/(antarctica|南极)/i.test(text)) return "antarctica";
  return text.replace(/_/g, "-");
}

function getFeatureContinentId(feature, appState, ownerCode = "") {
  const props = feature?.properties || {};
  const candidates = [
    props.continent_id,
    props.continent,
    props.CONTINENT,
    props.continent_label,
    props.region,
    props.REGION_UN,
    props.subregion,
    props.SUBREGION,
    appState?.scenarioCountriesByTag?.[ownerCode]?.continent_id,
    appState?.scenarioCountriesByTag?.[ownerCode]?.continent_label,
    appState?.scenarioCountriesByTag?.[ownerCode]?.subregion_label,
  ];
  for (const value of candidates) {
    const normalized = normalizeContinentId(String(value || ""));
    if (normalized) return normalized;
  }
  return "";
}

function getFeatureOwner(feature, appState) {
  const id = getFeatureId(feature);
  return normalizeCode(
    getFeatureOwnerCode(id, { skipEnsure: true })
    || appState?.sovereigntyByFeatureId?.[id]
    || appState?.runtimeCanonicalCountryByFeatureId?.[id]
    || feature?.properties?.ISO_A3
    || feature?.properties?.ADM0_A3
    || feature?.properties?.SOV_A3
    || feature?.properties?.iso_a3
  );
}

function getCountryDisplayName(appState, code) {
  const normalized = normalizeCode(code);
  const record = appState?.scenarioCountriesByTag?.[normalized] || {};
  const explicitName = getExplicitScenarioCountryDisplayName(appState, record);
  if (explicitName) return explicitName;
  const name = getScenarioCountryDisplayName(record, "");
  return getLocalizedLegendName(appState, [
    name,
    record.display_name,
    record.displayName,
    record.display_name_en,
    record.displayNameEn,
    appState?.countryNames?.[normalized],
    normalized,
  ]) || normalized;
}

function getExplicitScenarioCountryDisplayName(appState, record = {}) {
  const language = appState?.currentLanguage === "zh" ? "zh" : "en";
  const fields = language === "zh"
    ? [record.display_name_zh, record.displayNameZh]
    : [record.display_name_en, record.displayNameEn, record.display_name, record.displayName];
  return String(fields.find((value) => String(value || "").trim()) || "").trim();
}

function resolveGeoLocaleEntry(appState, key) {
  const candidate = String(key || "").trim();
  if (!candidate) return null;
  const geo = appState?.locales?.geo;
  if (!geo || typeof geo !== "object") return null;
  if (geo[candidate] && typeof geo[candidate] === "object") return geo[candidate];
  const aliasTarget = appState?.geoAliasToStableKey?.[candidate];
  if (aliasTarget && geo[aliasTarget] && typeof geo[aliasTarget] === "object") {
    return geo[aliasTarget];
  }
  return null;
}

function getLocalizedLegendName(appState, candidates) {
  const language = appState?.currentLanguage === "zh" ? "zh" : "en";
  const fallbackLanguage = language === "zh" ? "en" : "zh";
  const seen = new Set();
  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const entry = resolveGeoLocaleEntry(appState, candidate);
    const localized = String(entry?.[language] || "").trim();
    if (localized) return localized;
    const fallback = String(entry?.[fallbackLanguage] || "").trim();
    if (fallback) return fallback;
  }
  return String(candidates.find((value) => String(value || "").trim()) || "").trim();
}

function getOwnerBaseColor(appState, ownerCode) {
  const normalized = normalizeCode(ownerCode);
  if (!normalized) return "";
  return normalizeColor(
    appState?.sovereignBaseColors?.[normalized]
    || appState?.countryBaseColors?.[normalized]
    || appState?.resolvedDefaultCountryPalette?.[normalized]
  );
}

function getFeatureDisplayedColor(appState, feature, ownerCode) {
  const id = getFeatureId(feature);
  return normalizeColor(
    appState?.colors?.[id]
    || appState?.visualOverrides?.[id]
    || appState?.featureOverrides?.[id]
    || getOwnerBaseColor(appState, ownerCode)
  );
}

function getRealmRootCode(appState, ownerCode) {
  const normalized = normalizeCode(ownerCode);
  const entry = appState?.scenarioCountriesByTag?.[normalized] || {};
  const parentTags = Array.isArray(entry.parent_owner_tags)
    ? entry.parent_owner_tags
    : Array.isArray(entry.parentOwnerTags)
      ? entry.parentOwnerTags
      : [];
  const parent = normalizeCode(
    entry.parent_owner_tag
    || entry.parentOwnerTag
    || parentTags[0]
  );
  return parent || normalized;
}

function addStat(stats, key, ownerCode, area, feature, continentId, displayColor) {
  if (!key) return;
  const prior = stats.get(key) || {
    code: key,
    ownerCodes: new Set(),
    area: 0,
    featureCount: 0,
    continentCounts: new Map(),
    colorWeights: new Map(),
  };
  prior.ownerCodes.add(ownerCode);
  prior.area += area;
  prior.featureCount += 1;
  if (continentId) {
    prior.continentCounts.set(continentId, (prior.continentCounts.get(continentId) || 0) + 1);
  }
  if (displayColor) {
    prior.colorWeights.set(displayColor, (prior.colorWeights.get(displayColor) || 0) + area);
  }
  prior.sampleFeature = prior.sampleFeature || feature;
  stats.set(key, prior);
}

function collectOwnerStats(appState, config) {
  const stats = new Map();
  const features = Array.isArray(appState?.landData?.features) ? appState.landData.features : [];
  features.forEach((feature) => {
    const ownerCode = getFeatureOwner(feature, appState);
    if (!ownerCode) return;
    const continentId = getFeatureContinentId(feature, appState, ownerCode);
    if (config.mode === "continent-area" && config.continent !== "all" && continentId !== config.continent) return;
    const area = getFeatureArea(feature);
    const statKey = config.mode === "realm-area"
      ? getRealmRootCode(appState, ownerCode)
      : ownerCode;
    const displayColor = config.mode === "realm-area"
      ? getOwnerBaseColor(appState, statKey) || getFeatureDisplayedColor(appState, feature, ownerCode)
      : getFeatureDisplayedColor(appState, feature, ownerCode);
    addStat(stats, statKey, ownerCode, area, feature, continentId, displayColor);
  });
  return Array.from(stats.values()).map((entry) => ({
    ...entry,
    ownerCodes: Array.from(entry.ownerCodes),
  }));
}

function sortByArea(entries, config) {
  const majorIndex = new Map(MODERN_MAJOR_POWER_ORDER.map((code, index) => [code, index]));
  return [...entries].sort((left, right) => {
    if (config.useModernMajorOrder) {
      const leftRank = majorIndex.has(left.code) ? majorIndex.get(left.code) : Number.POSITIVE_INFINITY;
      const rightRank = majorIndex.has(right.code) ? majorIndex.get(right.code) : Number.POSITIVE_INFINITY;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    return right.area - left.area || left.code.localeCompare(right.code);
  });
}

function pickWeightedEntries(entries, config, appState) {
  const random = seededRandom(`${appState?.activeScenarioId || "project"}:${entries.length}:${config.maxItems}`);
  const majorSet = new Set(MODERN_MAJOR_POWER_ORDER);
  const pool = entries.map((entry) => ({
    ...entry,
    weight: Math.max(1, Math.sqrt(Math.max(1, entry.area))) * (majorSet.has(entry.code) ? MAJOR_POWER_BOOST : 1),
  }));
  const picked = [];
  while (pool.length && picked.length < config.maxItems) {
    const totalWeight = pool.reduce((total, entry) => total + entry.weight, 0);
    let cursor = random() * totalWeight;
    const index = pool.findIndex((entry) => {
      cursor -= entry.weight;
      return cursor <= 0;
    });
    const pickedIndex = index >= 0 ? index : pool.length - 1;
    picked.push(pool.splice(pickedIndex, 1)[0]);
  }
  return picked;
}

function collectPaletteColors(appState, count) {
  const seen = new Set();
  const colors = [];
  const push = (value) => {
    const color = normalizeColor(value);
    if (!color || seen.has(color)) return;
    seen.add(color);
    colors.push(color);
  };
  Object.values(appState?.colors || {}).forEach(push);
  Object.values(appState?.sovereignBaseColors || {}).forEach(push);
  Object.values(appState?.countryBaseColors || {}).forEach(push);
  (appState?.paletteQuickSwatches || []).forEach((entry) => {
    push(entry?.color ?? entry);
  });
  Object.values(appState?.resolvedDefaultCountryPalette || {}).forEach(push);
  FALLBACK_LEGEND_COLORS.forEach(push);
  return colors.slice(0, Math.max(count, 1));
}

function getDominantEntryColor(entry) {
  if (!(entry?.colorWeights instanceof Map) || !entry.colorWeights.size) return "";
  let selectedColor = "";
  let selectedWeight = -1;
  entry.colorWeights.forEach((weight, color) => {
    if (weight > selectedWeight) {
      selectedColor = color;
      selectedWeight = weight;
    }
  });
  return selectedColor;
}

function buildGeneratedEntries(appState, entries, config) {
  const palette = collectPaletteColors(appState, entries.length);
  return entries.slice(0, config.maxItems).map((entry, index) => ({
    ...entry,
    label: getCountryDisplayName(appState, entry.code),
    color: String(getDominantEntryColor(entry) || palette[index % palette.length] || ""),
  }));
}

class LegendManager {
  static ensureLegendState(appState) {
    if (!appState) return null;
    ensureLegendState(appState);
    return appState;
  }

  static normalizeLabels(value) {
    return normalizeLabels(value);
  }

  static normalizeConfig(value) {
    return normalizeLegendConfig(value);
  }

  static normalizeControl(value) {
    return normalizeLegendControl(value);
  }

  static getDefaultConfig() {
    return { ...DEFAULT_LEGEND_CONFIG };
  }

  static getDefaultControl() {
    return { ...DEFAULT_LEGEND_CONTROL };
  }

  static getControlLimits() {
    return { ...LEGEND_CONTROL_LIMITS };
  }

  static getContinentOptions() {
    return CONTINENT_OPTIONS.map((entry) => ({ ...entry }));
  }

  static getConfig(appState) {
    ensureLegendState(appState);
    return { ...(appState?.legendConfig || DEFAULT_LEGEND_CONFIG) };
  }

  static updateConfig(appState, patch = {}) {
    const nextConfig = normalizeLegendConfig({
      ...LegendManager.getConfig(appState),
      ...(patch || {}),
    });
    if (appState) patchLegendState(appState, { legendConfig: nextConfig });
    return { ...nextConfig };
  }

  static getUniqueColors(appState) {
    ensureLegendState(appState);
    return getUniqueLegendColors(appState);
  }

  static setLabel(color, text, appState = null) {
    if (!appState) return;
    ensureLegendState(appState);
    const key = normalizeColor(color);
    if (!key) return;
    const value = String(text || "").trim();
    setLegendLabelState(appState, key, value);
  }

  static getLabel(color, appState = null) {
    ensureLegendState(appState);
    const key = normalizeColor(color);
    const labels = appState?.legendLabels || {};
    return key ? labels[key] || "" : "";
  }

  static getLabels(appState = null) {
    ensureLegendState(appState);
    return appState?.legendLabels || {};
  }

  static generate(appState, patch = {}) {
    const config = LegendManager.updateConfig(appState, patch);
    const stats = collectOwnerStats(appState, config);
    const ordered = config.mode === "weighted-random"
      ? pickWeightedEntries(stats, config, appState)
      : sortByArea(stats, config);
    return {
      config,
      entries: buildGeneratedEntries(appState, ordered, config),
    };
  }

  static applyGeneratedLegend(appState, generation) {
    if (!appState || !generation?.entries?.length) return [];
    ensureLegendState(appState);
    const touchedOwners = new Set();
    const colorOrder = [];
    generation.entries.forEach((entry) => {
      const color = normalizeColor(entry.color);
      const label = String(entry.label || "").trim();
      if (!color) return;
      if (!colorOrder.includes(color)) colorOrder.push(color);
      entry.ownerCodes.forEach((ownerCode) => {
        const normalizedOwner = normalizeCode(ownerCode);
        if (!normalizedOwner) return;
        touchedOwners.add(normalizedOwner);
      });
      if (label) LegendManager.setLabel(color, label, appState);
    });
    patchLegendState(appState, { legendColorOrder: colorOrder });
    return Array.from(touchedOwners);
  }

  static getControlState(appState) {
    ensureLegendState(appState);
    return { ...(appState?.legendControl || DEFAULT_LEGEND_CONTROL) };
  }

  static updateControlState(appState, patch = {}) {
    const nextControl = normalizeLegendControl({
      ...LegendManager.getControlState(appState),
      ...(patch || {}),
    });
    if (appState) patchLegendState(appState, { legendControl: nextControl });
    return { ...nextControl };
  }

  static showControl(appState, patch = {}) {
    return LegendManager.updateControlState(appState, {
      ...(patch || {}),
      visible: true,
      collapsed: false,
    });
  }

  static hideControl(appState) {
    return LegendManager.updateControlState(appState, { visible: false });
  }

  static toggleControlCollapsed(appState) {
    const current = LegendManager.getControlState(appState);
    return LegendManager.updateControlState(appState, { collapsed: !current.collapsed });
  }

  static getSpecialZoneLayers(appState) {
    return appState?.showSpecialZones === false
      ? []
      : getSpecialZoneLegendLayers(appState?.specialZoneLayers);
  }

  static getSpecialZoneSignature(appState) {
    return appState?.showSpecialZones === false
      ? ""
      : getSpecialZoneLegendSignature({ layers: LegendManager.getSpecialZoneLayers(appState) });
  }
}

// Renderer-only opt-in: its resolved-color transaction advances colorRevision before rendering.
// General LegendManager callers retain uncached reads for arbitrary mutable input objects.
function createRevisionedLegendColorReader() {
  let lastState = null;
  let lastSource = null;
  let lastKey = "";
  let lastColors = [];
  return (appState) => {
    ensureLegendState(appState);
    if (!appState || typeof appState.colorRevision !== "number" || !Number.isFinite(Number(appState.colorRevision))) {
      return getUniqueLegendColors(appState);
    }
    const key = getLegendColorRevisionKey(appState);
    if (lastState !== appState || lastSource !== appState.colors || lastKey !== key) {
      lastColors = getUniqueLegendColors(appState);
      lastState = appState;
      lastSource = appState.colors;
      lastKey = key;
    }
    return lastColors.slice();
  };
}

export { LegendManager, createRevisionedLegendColorReader };
