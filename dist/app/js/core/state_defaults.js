// Centralized app state (Phase 13 scaffold)

import {
  TRANSPORT_OVERVIEW_CAPABILITY_FAMILY_IDS,
  TRANSPORT_RUNTIME_CAPABILITY_FAMILY_IDS,
  getTransportCapabilityDefaultOverviewConfig,
  normalizeTransportOverviewVisualMode,
  resolveLinkedTransportOverviewScopeAndThreshold as resolveLinkedTransportOverviewScopeAndThresholdFromRegistry,
} from "./transport_capability_registry.js";
import {
  getDefaultMainMapPackIdForFamily,
  getDefaultTransportWorkbenchPackIdForFamily,
  getTargetMainMapPackMeta,
  getTransportWorkbenchPackMeta,
} from "./transport_pack_resolver.js";
import { normalizeHexColorWithFallback } from "./color_hex_utils.js";

import {
  PALETTE_THEMES,
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,
  detailOverlaySupportTiers,
} from "./country_feature_policies.js";

const PRESET_STORAGE_KEY = "custom_presets";
const MAP_SEMANTIC_MODES = new Set(["political", "blank"]);

const defaultZoom = globalThis.d3?.zoomIdentity || { k: 1, x: 0, y: 0 };
const TEXTURE_MODE_ALIASES = {
  none: "none",
  paper: "paper",
  canvas: "draft_grid",
  draft_grid: "draft_grid",
  grid: "graticule",
  graticule: "graticule",
};
const PHYSICAL_MODE_ALIASES = {
  atlas_soft: "atlas_and_contours",
  atlas_and_contours: "atlas_and_contours",
  contour_only: "contours_only",
  contours_only: "contours_only",
  tint_only: "atlas_only",
  atlas_only: "atlas_only",
};
const PHYSICAL_PRESET_ALIASES = {
  political: "political_clean",
  political_clean: "political_clean",
  clean: "political_clean",
  balanced: "balanced",
  default: "balanced",
  terrain: "terrain_rich",
  terrain_rich: "terrain_rich",
  rich: "terrain_rich",
};
const PHYSICAL_PRESET_KEYS = ["political_clean", "balanced", "terrain_rich"];
const PHYSICAL_ATLAS_CLASS_KEYS = [
  "mountain_high_relief",
  "mountain_hills",
  "upland_plateau",
  "badlands_canyon",
  "plains_lowlands",
  "basin_lowlands",
  "wetlands_delta",
  "forest_temperate",
  "rainforest_tropical",
  "grassland_steppe",
  "desert_bare",
  "tundra_ice",
];
const PHYSICAL_ATLAS_PALETTE = {
  mountain_high_relief: "#6f4430",
  mountain_hills: "#9e6b4e",
  upland_plateau: "#bf8d63",
  badlands_canyon: "#b35b3c",
  plains_lowlands: "#91ab68",
  basin_lowlands: "#b8b07c",
  wetlands_delta: "#4d9a8d",
  forest_temperate: "#4e7240",
  rainforest_tropical: "#236148",
  grassland_steppe: "#c2b66d",
  desert_bare: "#d8b169",
  tundra_ice: "#b8c7d8",
};
const VALID_PHYSICAL_BLEND_MODES = new Set([
  "source-over",
  "multiply",
  "soft-light",
  "overlay",
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTextureMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  return TEXTURE_MODE_ALIASES[raw] || "none";
}

function normalizePhysicalMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  return PHYSICAL_MODE_ALIASES[raw] || "atlas_only";
}

function normalizePhysicalPreset(value) {
  const raw = String(value || "").trim().toLowerCase();
  return PHYSICAL_PRESET_ALIASES[raw] || "balanced";
}

function createDefaultPhysicalAtlasVisibility() {
  return Object.fromEntries(PHYSICAL_ATLAS_CLASS_KEYS.map((key) => [key, true]));
}

function createPhysicalPresetConfig(preset = "balanced") {
  const normalizedPreset = normalizePhysicalPreset(preset);
  const atlasClassVisibility = createDefaultPhysicalAtlasVisibility();
  if (normalizedPreset === "political_clean") {
    atlasClassVisibility.forest_temperate = false;
    atlasClassVisibility.rainforest_tropical = false;
    atlasClassVisibility.grassland_steppe = false;
    atlasClassVisibility.desert_bare = false;
    atlasClassVisibility.tundra_ice = false;
  }
  if (normalizedPreset === "terrain_rich") {
    return {
      preset: normalizedPreset,
      mode: "atlas_and_contours",
      opacity: 0.72,
      atlasOpacity: 0.68,
      atlasIntensity: 1.12,
      atlasClassVisibility,
      rainforestEmphasis: 0.88,
      contourColor: "#5e4b3b",
      contourOpacity: 0.62,
      contourMajorWidth: 1.3,
      contourMinorWidth: 0.8,
      contourMajorIntervalM: 500,
      contourMinorIntervalM: 100,
      contourMinorVisible: true,
      contourMajorLowReliefCutoffM: 160,
      contourMinorLowReliefCutoffM: 220,
      blendMode: "overlay",
    };
  }
  if (normalizedPreset === "political_clean") {
    return {
      preset: normalizedPreset,
      mode: "atlas_only",
      opacity: 0.36,
      atlasOpacity: 0.24,
      atlasIntensity: 0.78,
      atlasClassVisibility,
      rainforestEmphasis: 0.52,
      contourColor: "#675645",
      contourOpacity: 0.48,
      contourMajorWidth: 1.05,
      contourMinorWidth: 0.45,
      contourMajorIntervalM: 1000,
      contourMinorIntervalM: 200,
      contourMinorVisible: false,
      contourMajorLowReliefCutoffM: 380,
      contourMinorLowReliefCutoffM: 520,
      blendMode: "source-over",
    };
  }
  return {
    preset: normalizedPreset,
    mode: "atlas_only",
    opacity: 0.56,
    atlasOpacity: 0.44,
    atlasIntensity: 0.96,
    atlasClassVisibility,
    rainforestEmphasis: 0.74,
    contourColor: "#665241",
    contourOpacity: 0.58,
    contourMajorWidth: 1.18,
    contourMinorWidth: 0.62,
    contourMajorIntervalM: 500,
    contourMinorIntervalM: 100,
    contourMinorVisible: true,
    contourMajorLowReliefCutoffM: 200,
    contourMinorLowReliefCutoffM: 280,
    blendMode: "source-over",
  };
}

function createDefaultPhysicalStyleConfig() {
  return createPhysicalPresetConfig("balanced");
}

export function getPhysicalContextLayerRequests(rawConfig) {
  return normalizePhysicalStyleConfig(rawConfig).mode === "atlas_only"
    ? ["physical-set"]
    : ["physical-set", "physical-contours-set"];
}

function createPhysicalStyleConfigForPreset(preset = "balanced") {
  return createPhysicalPresetConfig(preset);
}

function normalizePhysicalBlendMode(value, fallback = "source-over") {
  const normalizedFallback = String(fallback || "source-over").trim().toLowerCase();
  const safeFallback = VALID_PHYSICAL_BLEND_MODES.has(normalizedFallback) ? normalizedFallback : "source-over";
  const mode = String(value || "").trim().toLowerCase();
  return VALID_PHYSICAL_BLEND_MODES.has(mode) ? mode : safeFallback;
}

function normalizePhysicalStyleConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const normalizedPreset = normalizePhysicalPreset(raw.preset || "balanced");
  const defaults = createPhysicalPresetConfig(normalizedPreset);
  const legacyPreset = raw.preset;
  // physical style 正在从旧的单层 opacity/contourWidth 形态迁到 preset + atlas/contour 分层 schema。
  // 这里先判断调用方是否已经写入新字段，再决定旧字段该作为兼容输入还是彻底让位给新默认值。
  const hasNewPhysicalSchema = [
    "preset",
    "mode",
    "atlasOpacity",
    "atlasIntensity",
    "atlasClassVisibility",
    "rainforestEmphasis",
    "contourMajorWidth",
    "contourMinorWidth",
    "contourMajorIntervalM",
    "contourMinorIntervalM",
    "contourMinorVisible",
    "contourMajorLowReliefCutoffM",
    "contourMinorLowReliefCutoffM",
    "contourLowReliefCutoffM",
    "layerOpacity",
  ].some((key) => Object.prototype.hasOwnProperty.call(raw, key));
  const legacyOpacity = toFiniteNumber(raw.opacity, defaults.atlasOpacity);
  const atlasOpacityFallback = hasNewPhysicalSchema ? defaults.atlasOpacity : legacyOpacity;
  const legacyContourWidth = toFiniteNumber(raw.contourWidth, defaults.contourMajorWidth);
  const rawVisibility =
    raw.atlasClassVisibility && typeof raw.atlasClassVisibility === "object"
      ? raw.atlasClassVisibility
      : {};

  return {
    preset: normalizedPreset,
    mode: normalizePhysicalMode(raw.mode || defaults.mode),
    opacity: clamp(
      toFiniteNumber(hasNewPhysicalSchema ? (raw.opacity ?? raw.layerOpacity) : raw.layerOpacity, defaults.opacity),
      0,
      1
    ),
    atlasOpacity: clamp(toFiniteNumber(raw.atlasOpacity, atlasOpacityFallback), 0, 1),
    atlasIntensity: clamp(toFiniteNumber(raw.atlasIntensity, defaults.atlasIntensity), 0.2, 1.4),
    atlasClassVisibility: Object.fromEntries(
      PHYSICAL_ATLAS_CLASS_KEYS.map((key) => [
        key,
        rawVisibility[key] === undefined ? defaults.atlasClassVisibility?.[key] !== false : !!rawVisibility[key],
      ])
    ),
    rainforestEmphasis: clamp(toFiniteNumber(raw.rainforestEmphasis, defaults.rainforestEmphasis), 0, 1),
    contourColor: String(raw.contourColor || defaults.contourColor).trim() || defaults.contourColor,
    contourOpacity: clamp(toFiniteNumber(raw.contourOpacity, defaults.contourOpacity), 0, 1),
    contourMajorWidth: clamp(toFiniteNumber(raw.contourMajorWidth, legacyContourWidth), 0.2, 3),
    contourMinorWidth: clamp(
      toFiniteNumber(raw.contourMinorWidth, Math.max(0.2, legacyContourWidth * 0.65)),
      0.1,
      2
    ),
    contourMajorIntervalM: clamp(
      Math.round(toFiniteNumber(raw.contourMajorIntervalM, defaults.contourMajorIntervalM) / 500) * 500,
      500,
      2000
    ),
    contourMinorIntervalM: clamp(
      Math.round(toFiniteNumber(raw.contourMinorIntervalM, defaults.contourMinorIntervalM) / 100) * 100,
      100,
      1000
    ),
    contourMinorVisible: raw.contourMinorVisible === undefined ? defaults.contourMinorVisible : !!raw.contourMinorVisible,
    contourMajorLowReliefCutoffM: clamp(
      Math.round(
        toFiniteNumber(
          raw.contourMajorLowReliefCutoffM,
          toFiniteNumber(raw.contourLowReliefCutoffM, defaults.contourMajorLowReliefCutoffM)
        )
      ),
      0,
      2000
    ),
    contourMinorLowReliefCutoffM: clamp(
      Math.round(
        toFiniteNumber(
          raw.contourMinorLowReliefCutoffM,
          toFiniteNumber(raw.contourLowReliefCutoffM, defaults.contourMinorLowReliefCutoffM)
        )
      ),
      0,
      2000
    ),
    blendMode: normalizePhysicalBlendMode(raw.blendMode, defaults.blendMode),
  };
}

function createDefaultLakeStyleConfig() {
  return {
    linkedToOcean: true,
    fillColor: null,
  };
}

function normalizeLakeStyleConfig(rawConfig) {
  const defaults = createDefaultLakeStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const fillColor = typeof raw.fillColor === "string" ? raw.fillColor.trim() : "";
  return {
    linkedToOcean: raw.linkedToOcean === undefined ? defaults.linkedToOcean : !!raw.linkedToOcean,
    fillColor: fillColor || null,
  };
}

export const URBAN_MANUAL_DEFAULT_COLOR = "#4b5563";
export const URBAN_ADAPTIVE_TINT_DEFAULT_COLOR = "#f2dea1";
export const PARENT_BORDER_STYLE_DEFAULTS = Object.freeze({
  color: "#4b5563",
  opacity: 0.85,
  width: 1.1,
});

const LEGACY_URBAN_STYLE_DEFAULTS = Object.freeze({
  color: URBAN_MANUAL_DEFAULT_COLOR,
  opacity: 0.4,
  blendMode: "multiply",
  minAreaPx: 8,
});

function createDefaultUrbanStyleConfig() {
  return {
    mode: "adaptive",
    color: LEGACY_URBAN_STYLE_DEFAULTS.color,
    blendMode: LEGACY_URBAN_STYLE_DEFAULTS.blendMode,
    fillOpacity: 0.34,
    strokeOpacity: 0.25,
    adaptiveStrength: 0.3,
    toneBias: 0.12,
    adaptiveTintEnabled: false,
    adaptiveTintColor: URBAN_ADAPTIVE_TINT_DEFAULT_COLOR,
    adaptiveTintStrength: 0,
    minAreaPx: 1,
  };
}

function normalizeUrbanStyleMode(value, fallback = "adaptive") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "adaptive" || normalized === "manual") return normalized;
  return fallback === "manual" ? "manual" : "adaptive";
}

function hasLegacyUrbanManualSignal(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  if (Object.prototype.hasOwnProperty.call(raw, "mode")) {
    return false;
  }
  const hasLegacyKeys = ["color", "blendMode", "opacity", "minAreaPx"].some((key) =>
    Object.prototype.hasOwnProperty.call(raw, key)
  );
  if (!hasLegacyKeys) return false;

  const color = typeof raw.color === "string" ? raw.color.trim().toLowerCase() : LEGACY_URBAN_STYLE_DEFAULTS.color;
  const blendMode = String(raw.blendMode || LEGACY_URBAN_STYLE_DEFAULTS.blendMode).trim().toLowerCase();
  const opacity = clamp(toFiniteNumber(raw.opacity, LEGACY_URBAN_STYLE_DEFAULTS.opacity), 0, 1);
  const minAreaPx = clamp(toFiniteNumber(raw.minAreaPx, LEGACY_URBAN_STYLE_DEFAULTS.minAreaPx), 1, 80);

  return (
    color !== LEGACY_URBAN_STYLE_DEFAULTS.color ||
    blendMode !== LEGACY_URBAN_STYLE_DEFAULTS.blendMode ||
    Math.abs(opacity - LEGACY_URBAN_STYLE_DEFAULTS.opacity) > 0.0001 ||
    Math.abs(minAreaPx - LEGACY_URBAN_STYLE_DEFAULTS.minAreaPx) > 0.0001
  );
}

function normalizeUrbanStyleConfig(rawConfig) {
  const defaults = createDefaultUrbanStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  // 旧 urban 配置没有显式 mode；是否进入 manual 取决于 legacy 字段里有没有真正偏离默认值的“人工调参信号”。
  // 这样既能兼容老项目，又不会把一份仅靠默认值保存下来的旧配置误判成 manual。
  const inferredLegacyMode = hasLegacyUrbanManualSignal(raw) ? "manual" : defaults.mode;
  const mode = normalizeUrbanStyleMode(raw.mode, inferredLegacyMode);
  const fillOpacityFallback =
    mode === "manual"
      ? clamp(toFiniteNumber(raw.opacity, LEGACY_URBAN_STYLE_DEFAULTS.opacity), 0, 1)
      : defaults.fillOpacity;
  const color = typeof raw.color === "string" ? raw.color.trim() : "";
  const blendMode = String(raw.blendMode || defaults.blendMode).trim().toLowerCase() || defaults.blendMode;
  const legacyToneBias = raw.darkCountryBoost === undefined
    ? defaults.toneBias
    : (raw.darkCountryBoost ? defaults.toneBias : 0);

  return {
    mode,
    color: color || defaults.color,
    blendMode,
    fillOpacity: clamp(toFiniteNumber(raw.fillOpacity, fillOpacityFallback), 0, 1),
    strokeOpacity: clamp(toFiniteNumber(raw.strokeOpacity, defaults.strokeOpacity), 0, 1),
    adaptiveStrength: clamp(toFiniteNumber(raw.adaptiveStrength, defaults.adaptiveStrength), 0, 1),
    toneBias: clamp(toFiniteNumber(raw.toneBias, legacyToneBias), -0.3, 0.3),
    adaptiveTintEnabled: raw.adaptiveTintEnabled === undefined ? defaults.adaptiveTintEnabled : !!raw.adaptiveTintEnabled,
    adaptiveTintColor: normalizeTextureHexColor(raw.adaptiveTintColor, defaults.adaptiveTintColor),
    adaptiveTintStrength: clamp(toFiniteNumber(raw.adaptiveTintStrength, defaults.adaptiveTintStrength), 0, 0.5),
    minAreaPx: clamp(toFiniteNumber(raw.minAreaPx, defaults.minAreaPx), 1, 80),
  };
}

function createDefaultCityLayerStyleConfig() {
  return {
    theme: "classic_graphite",
    revealProfile: "hybrid_country_budget",
    markerDensity: 0.95,
    labelDensity: "balanced",
    color: "#20262e",
    capitalColor: "#f0b84f",
    opacity: 0.96,
    markerScale: 1,
    showLabels: true,
    labelSize: 11,
    labelMinZoom: 1.9,
    showCapitalOverlay: true,
    capitalScale: 1.6,
  };
}

const VALID_CITY_LAYER_THEMES = [
  "classic_graphite",
  "atlas_ink",
  "parchment_sepia",
  "slate_blue",
  "ivory_outline",
];
const VALID_CITY_LAYER_REVEAL_PROFILES = ["hybrid_country_budget"];
const VALID_CITY_LAYER_LABEL_DENSITIES = ["sparse", "balanced", "dense"];

function normalizeCityLayerStyleConfig(rawConfig) {
  const defaults = createDefaultCityLayerStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const color = typeof raw.color === "string" ? raw.color.trim() : "";
  const capitalColor = typeof raw.capitalColor === "string" ? raw.capitalColor.trim() : "";
  const theme = String(raw.theme || defaults.theme).trim().toLowerCase();
  const revealProfile = String(raw.revealProfile || defaults.revealProfile).trim().toLowerCase();
  const labelDensity = String(raw.labelDensity || defaults.labelDensity).trim().toLowerCase();
  const explicitMarkerScale = toFiniteNumber(raw.markerScale, Number.NaN);
  const legacyRadius = toFiniteNumber(raw.radius, Number.NaN);
  // city layer 从旧 radius 迁到 markerScale 后，旧项目仍可能只保存 radius。
  // 这里把 radius 折算成近似 scale，保证历史项目恢复出来的视觉密度接近用户原来的意图。
  const legacyRadiusScale = Number.isFinite(legacyRadius)
    ? clamp(legacyRadius / 3.2, 0.75, 1.3)
    : 1;
  const migratedMarkerScale = clamp(
    Number.isFinite(explicitMarkerScale)
      ? explicitMarkerScale
      : (defaults.markerScale * legacyRadiusScale),
    0.75,
    2.5,
  );

  return {
    theme: VALID_CITY_LAYER_THEMES.includes(theme) ? theme : defaults.theme,
    revealProfile: VALID_CITY_LAYER_REVEAL_PROFILES.includes(revealProfile) ? revealProfile : defaults.revealProfile,
    markerDensity: clamp(toFiniteNumber(raw.markerDensity, defaults.markerDensity), 0.5, 2),
    labelDensity: VALID_CITY_LAYER_LABEL_DENSITIES.includes(labelDensity) ? labelDensity : defaults.labelDensity,
    color: color || defaults.color,
    capitalColor: capitalColor || defaults.capitalColor,
    opacity: clamp(toFiniteNumber(raw.opacity, defaults.opacity), 0, 1),
    markerScale: migratedMarkerScale,
    showLabels: raw.showLabels === undefined ? defaults.showLabels : !!raw.showLabels,
    labelSize: clamp(Math.round(toFiniteNumber(raw.labelSize, defaults.labelSize)), 8, 24),
    labelMinZoom: clamp(toFiniteNumber(raw.labelMinZoom, defaults.labelMinZoom), 0.5, 8),
    showCapitalOverlay: raw.showCapitalOverlay === undefined
      ? defaults.showCapitalOverlay
      : !!raw.showCapitalOverlay,
    capitalScale: clamp(toFiniteNumber(raw.capitalScale, defaults.capitalScale), 1, 3.5),
  };
}

const TRANSPORT_OVERVIEW_FAMILY_IDS = TRANSPORT_OVERVIEW_CAPABILITY_FAMILY_IDS;
const TRANSPORT_OVERVIEW_LABEL_DENSITIES = Object.freeze(["sparse", "balanced", "dense"]);
const TRANSPORT_OVERVIEW_SCOPE_LINK_MODES = Object.freeze(["linked", "manual"]);

function clampUnitInterval(value, fallback = 0.5) {
  return clamp(toFiniteNumber(value, fallback), 0, 1);
}

function mapLegacyTransportPresetToVisualStrength(value, fallback = 0.56) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quiet") return 0.32;
  if (normalized === "bold") return 0.82;
  if (normalized === "balanced") return 0.56;
  return fallback;
}

function mapLegacyTransportScopeToCoverageReach(familyId, value, fallback = 0.5) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (familyId === "airport") {
    if (normalized === "international") return 0.12;
    if (normalized === "major_civil") return 0.5;
    if (normalized === "all_civil") return 0.88;
  }
  if (familyId === "port") {
    if (normalized === "core") return 0.12;
    if (normalized === "regional") return 0.5;
    if (normalized === "expanded") return 0.88;
  }
  if (familyId === "rail") {
    if (normalized === "mainline_only") return 0.2;
    if (normalized === "mainline_plus_regional") return 0.78;
  }
  if (familyId === "road") {
    if (normalized === "motorway_only") return 0.2;
    if (normalized === "motorway_trunk") return 0.78;
  }
  return fallback;
}

function resolveLinkedTransportOverviewScopeAndThreshold(familyId, coverageReach = 0.5) {
  return resolveLinkedTransportOverviewScopeAndThresholdFromRegistry(familyId, coverageReach);
}

function normalizeTransportOverviewScopeLinkMode(value, fallback = "linked") {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRANSPORT_OVERVIEW_SCOPE_LINK_MODES.includes(normalized)) return normalized;
  return TRANSPORT_OVERVIEW_SCOPE_LINK_MODES.includes(fallback) ? fallback : "linked";
}

function createDefaultTransportOverviewFamilyConfig(familyId) {
  const defaults = getTransportCapabilityDefaultOverviewConfig(familyId);
  if (defaults) {
    return {
      ...defaults,
    };
  }
  return {
    opacity: 0.65,
    visualStrength: 0.5,
    labelsEnabled: false,
    labelDensity: "balanced",
    labelMode: "name",
    labelSize: 10,
    labelHalo: 0.88,
    coverageReach: 0.5,
    scopeLinkMode: "linked",
    scope: "default",
    importanceThreshold: "secondary",
  };
}

function normalizeTransportOverviewLabelDensity(value, fallback = "balanced") {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRANSPORT_OVERVIEW_LABEL_DENSITIES.includes(normalized)) return normalized;
  return TRANSPORT_OVERVIEW_LABEL_DENSITIES.includes(fallback) ? fallback : "balanced";
}

function normalizeTransportOverviewPrimaryColor(value, fallback = "#1d4ed8") {
  return normalizeHexColorWithFallback(value, fallback, "#1d4ed8");
}

function normalizeTransportOverviewImportanceThreshold(value, fallback = "primary") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "national_core") return "primary";
  if (normalized === "regional_core") return "secondary";
  if (normalized === "local_connector") return "all";
  if (["primary", "secondary", "all"].includes(normalized)) return normalized;
  if (["primary", "secondary", "all"].includes(fallback)) return fallback;
  if (fallback === "national_core") return "primary";
  if (fallback === "regional_core") return "secondary";
  if (fallback === "local_connector") return "all";
  return "primary";
}

function normalizeTransportOverviewFamilyConfig(rawConfig, familyId) {
  const defaults = createDefaultTransportOverviewFamilyConfig(familyId);
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const scopeLinkMode = normalizeTransportOverviewScopeLinkMode(raw.scopeLinkMode, defaults.scopeLinkMode);
  // linked 模式下，coverageReach 才是用户真正想表达的连续滑杆语义；
  // scope / importanceThreshold 会由 registry 里的族别规则反推出来，避免 UI、main-map bridge、workbench preview 各算一套。
  const coverageReach = Object.prototype.hasOwnProperty.call(raw, "coverageReach")
    ? clampUnitInterval(raw.coverageReach, defaults.coverageReach)
    : mapLegacyTransportScopeToCoverageReach(
      familyId,
      raw.scope,
      defaults.coverageReach,
    );
  const linked = resolveLinkedTransportOverviewScopeAndThreshold(familyId, coverageReach);
  return {
    opacity: clamp(toFiniteNumber(raw.opacity, defaults.opacity), 0, 1),
    visualStrength: Object.prototype.hasOwnProperty.call(raw, "visualStrength")
      ? clampUnitInterval(raw.visualStrength, defaults.visualStrength)
      : mapLegacyTransportPresetToVisualStrength(raw.preset, defaults.visualStrength),
    primaryColor: normalizeTransportOverviewPrimaryColor(raw.primaryColor, defaults.primaryColor),
    labelsEnabled: raw.labelsEnabled === undefined ? defaults.labelsEnabled : !!raw.labelsEnabled,
    labelDensity: normalizeTransportOverviewLabelDensity(raw.labelDensity, defaults.labelDensity),
    labelMode: String(raw.labelMode || defaults.labelMode).trim().toLowerCase() || defaults.labelMode,
    labelSize: clamp(Math.round(toFiniteNumber(raw.labelSize, defaults.labelSize ?? 10)), 7, 16),
    labelHalo: clampUnitInterval(raw.labelHalo, defaults.labelHalo ?? 0.5),
    coverageReach,
    scopeLinkMode,
    scope: scopeLinkMode === "linked"
      ? linked.scope
      : (String(raw.scope || defaults.scope).trim().toLowerCase() || defaults.scope),
    importanceThreshold: scopeLinkMode === "linked"
      ? linked.importanceThreshold
      : normalizeTransportOverviewImportanceThreshold(raw.importanceThreshold, defaults.importanceThreshold),
  };
}

function createDefaultTransportOverviewStyleConfig() {
  return {
    visualMode: "distribution",
    allowFacilityUnderlyingMapSelection: false,
    activePackIdByFamily: {},
    ...Object.fromEntries(
      TRANSPORT_OVERVIEW_FAMILY_IDS.map((familyId) => [
        familyId,
        createDefaultTransportOverviewFamilyConfig(familyId),
      ]),
    ),
  };
}

function normalizeTransportOverviewActivePackIdByFamily(rawValue) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([familyId, packId]) => {
        const normalizedFamilyId = String(familyId || "").trim().toLowerCase();
        const meta = getTargetMainMapPackMeta(packId);
        return meta && meta.family === normalizedFamilyId ? [normalizedFamilyId, meta.packId] : null;
      })
      .filter(Boolean)
  );
}

function normalizeTransportOverviewStyleConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    visualMode: normalizeTransportOverviewVisualMode(source.visualMode, "distribution"),
    allowFacilityUnderlyingMapSelection: source.allowFacilityUnderlyingMapSelection === undefined
      ? !!source.allowFacilityUnderlyingSelection
      : !!source.allowFacilityUnderlyingMapSelection,
    activePackIdByFamily: normalizeTransportOverviewActivePackIdByFamily(source.activePackIdByFamily),
    ...Object.fromEntries(
      TRANSPORT_OVERVIEW_FAMILY_IDS.map((familyId) => [
        familyId,
        normalizeTransportOverviewFamilyConfig(source[familyId], familyId),
      ]),
    ),
  };
}

function createDefaultTextureStyleConfig() {
  return {
    mode: "none",
    opacity: 0.58,
    sphereClip: true,
    paper: {
      assetId: "paper_vintage_01",
      scale: 1,
      warmth: 0.52,
      grain: 0.22,
      wear: 0.18,
      vignette: 0.10,
      blendMode: "multiply",
    },
    graticule: {
      majorStep: 30,
      minorStep: 15,
      labelStep: 90,
      majorWidth: 1.2,
      minorWidth: 0.7,
      majorOpacity: 0.34,
      minorOpacity: 0.14,
      color: "#475569",
      labelColor: "#334155",
      labelSize: 12,
    },
    draftGrid: {
      majorStep: 24,
      minorStep: 12,
      lonOffset: 0,
      latOffset: 12,
      roll: -18,
      width: 1.1,
      majorOpacity: 0.28,
      minorOpacity: 0.14,
      color: "#475569",
      dash: "dashed",
    },
  };
}

function normalizeTextureHexColor(value, fallback) {
  return normalizeHexColorWithFallback(value, fallback, "#475569");
}

function normalizeTextureStyleConfig(rawConfig) {
  const defaults = createDefaultTextureStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawPaper = raw.paper && typeof raw.paper === "object" ? raw.paper : {};
  const rawGraticule = raw.graticule && typeof raw.graticule === "object" ? raw.graticule : {};
  const rawDraftGrid = raw.draftGrid && typeof raw.draftGrid === "object" ? raw.draftGrid : {};

  const majorStep = clamp(Math.round(toFiniteNumber(rawGraticule.majorStep, defaults.graticule.majorStep)), 10, 90);
  const minorStep = clamp(Math.round(toFiniteNumber(rawGraticule.minorStep, defaults.graticule.minorStep)), 1, majorStep);
  const draftMajorStep = clamp(
    Math.round(toFiniteNumber(rawDraftGrid.majorStep, defaults.draftGrid.majorStep)),
    12,
    90
  );
  const draftMinorStep = clamp(
    Math.round(toFiniteNumber(rawDraftGrid.minorStep, defaults.draftGrid.minorStep)),
    4,
    draftMajorStep
  );
  const dash = String(rawDraftGrid.dash || defaults.draftGrid.dash).trim().toLowerCase();

  return {
    mode: normalizeTextureMode(raw.mode),
    opacity: clamp(toFiniteNumber(raw.opacity, defaults.opacity), 0, 1),
    sphereClip: raw.sphereClip === undefined ? defaults.sphereClip : !!raw.sphereClip,
    paper: {
      assetId: String(rawPaper.assetId || defaults.paper.assetId).trim() || defaults.paper.assetId,
      scale: clamp(toFiniteNumber(rawPaper.scale, defaults.paper.scale), 0.55, 2.4),
      warmth: clamp(toFiniteNumber(rawPaper.warmth, defaults.paper.warmth), 0, 1),
      grain: clamp(toFiniteNumber(rawPaper.grain, defaults.paper.grain), 0, 1),
      wear: clamp(toFiniteNumber(rawPaper.wear, defaults.paper.wear), 0, 1),
      vignette: clamp(toFiniteNumber(rawPaper.vignette, defaults.paper.vignette), 0, 1),
      blendMode: String(rawPaper.blendMode || defaults.paper.blendMode).trim() || defaults.paper.blendMode,
    },
    graticule: {
      majorStep,
      minorStep,
      labelStep: clamp(
        Math.round(toFiniteNumber(rawGraticule.labelStep, defaults.graticule.labelStep)),
        majorStep,
        180
      ),
      majorWidth: clamp(toFiniteNumber(rawGraticule.majorWidth, defaults.graticule.majorWidth), 0.2, 4),
      minorWidth: clamp(toFiniteNumber(rawGraticule.minorWidth, defaults.graticule.minorWidth), 0.1, 3),
      majorOpacity: clamp(toFiniteNumber(rawGraticule.majorOpacity, defaults.graticule.majorOpacity), 0, 1),
      minorOpacity: clamp(toFiniteNumber(rawGraticule.minorOpacity, defaults.graticule.minorOpacity), 0, 1),
      color: normalizeTextureHexColor(rawGraticule.color, defaults.graticule.color),
      labelColor: normalizeTextureHexColor(rawGraticule.labelColor, defaults.graticule.labelColor),
      labelSize: clamp(Math.round(toFiniteNumber(rawGraticule.labelSize, defaults.graticule.labelSize)), 9, 24),
    },
    draftGrid: {
      majorStep: draftMajorStep,
      minorStep: draftMinorStep,
      lonOffset: clamp(toFiniteNumber(rawDraftGrid.lonOffset, defaults.draftGrid.lonOffset), -180, 180),
      latOffset: clamp(toFiniteNumber(rawDraftGrid.latOffset, defaults.draftGrid.latOffset), -80, 80),
      roll: clamp(toFiniteNumber(rawDraftGrid.roll, defaults.draftGrid.roll), -180, 180),
      width: clamp(toFiniteNumber(rawDraftGrid.width, defaults.draftGrid.width), 0.2, 4),
      majorOpacity: clamp(toFiniteNumber(rawDraftGrid.majorOpacity, defaults.draftGrid.majorOpacity), 0, 1),
      minorOpacity: clamp(toFiniteNumber(rawDraftGrid.minorOpacity, defaults.draftGrid.minorOpacity), 0, 1),
      color: normalizeTextureHexColor(rawDraftGrid.color, defaults.draftGrid.color),
      dash: dash === "solid" || dash === "dotted" ? dash : defaults.draftGrid.dash,
    },
  };
}

function createDefaultDayNightStyleConfig() {
  return {
    enabled: false,
    mode: "manual",
    manualUtcMinutes: 12 * 60,
    cycleSecondsPerDay: 120,
    shadowOpacity: 0.38,
    twilightWidthDeg: 10,
    cityLightsEnabled: true,
    cityLightsStyle: "modern",
    cityLightsIntensity: 1.15,
    cityLightsTextureOpacity: 0.74,
    cityLightsCorridorStrength: 0.42,
    cityLightsCoreSharpness: 0.62,
    cityLightsPopulationBoostEnabled: true,
    cityLightsPopulationBoostStrength: 0.7,
    historicalCityLightsDensity: 1.12,
    historicalCityLightsSecondaryRetention: 0.46,
  };
}

function normalizeDayNightStyleConfig(rawConfig) {
  const defaults = createDefaultDayNightStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawMode = String(raw.mode || defaults.mode).trim().toLowerCase();
  const mode = rawMode === "utc" || rawMode === "cycle" ? rawMode : "manual";
  const cityLightsStyle = String(raw.cityLightsStyle || defaults.cityLightsStyle).trim().toLowerCase();

  return {
    enabled: raw.enabled === undefined ? defaults.enabled : !!raw.enabled,
    mode,
    manualUtcMinutes: clamp(
      Math.round(toFiniteNumber(raw.manualUtcMinutes, defaults.manualUtcMinutes)),
      0,
      24 * 60 - 1
    ),
    cycleSecondsPerDay: clamp(
      Math.round(toFiniteNumber(raw.cycleSecondsPerDay, defaults.cycleSecondsPerDay)),
      10,
      600
    ),
    shadowOpacity: clamp(toFiniteNumber(raw.shadowOpacity, defaults.shadowOpacity), 0, 0.85),
    twilightWidthDeg: clamp(Math.round(toFiniteNumber(raw.twilightWidthDeg, defaults.twilightWidthDeg)), 2, 28),
    cityLightsEnabled: raw.cityLightsEnabled === undefined ? defaults.cityLightsEnabled : !!raw.cityLightsEnabled,
    cityLightsStyle: cityLightsStyle === "historical_1930s" ? "historical_1930s" : "modern",
    cityLightsIntensity: clamp(toFiniteNumber(raw.cityLightsIntensity, defaults.cityLightsIntensity), 0, 1.8),
    cityLightsTextureOpacity: clamp(
      toFiniteNumber(raw.cityLightsTextureOpacity, defaults.cityLightsTextureOpacity),
      0,
      1
    ),
    cityLightsCorridorStrength: clamp(
      toFiniteNumber(raw.cityLightsCorridorStrength, defaults.cityLightsCorridorStrength),
      0,
      1
    ),
    cityLightsCoreSharpness: clamp(
      toFiniteNumber(raw.cityLightsCoreSharpness, defaults.cityLightsCoreSharpness),
      0,
      1
    ),
    cityLightsPopulationBoostEnabled: raw.cityLightsPopulationBoostEnabled === undefined
      ? defaults.cityLightsPopulationBoostEnabled
      : !!raw.cityLightsPopulationBoostEnabled,
    cityLightsPopulationBoostStrength: clamp(
      toFiniteNumber(raw.cityLightsPopulationBoostStrength, defaults.cityLightsPopulationBoostStrength),
      0,
      1.5
    ),
    historicalCityLightsDensity: clamp(
      toFiniteNumber(raw.historicalCityLightsDensity, defaults.historicalCityLightsDensity),
      0.75,
      2
    ),
    historicalCityLightsSecondaryRetention: clamp(
      toFiniteNumber(
        raw.historicalCityLightsSecondaryRetention,
        defaults.historicalCityLightsSecondaryRetention
      ),
      0,
      1
    ),
  };
}

function createDefaultAnnotationView() {
  return {
    frontlineEnabled: false,
    frontlineStyle: "clean",
    showFrontlineLabels: false,
    labelPlacementMode: "midpoint",
    unitRendererDefault: "game",
    unitCounterFixedScaleMultiplier: 1.5,
    showUnitLabels: true,
  };
}

function normalizeAnnotationView(rawConfig) {
  const defaults = createDefaultAnnotationView();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const frontlineStyle = String(raw.frontlineStyle || defaults.frontlineStyle).trim().toLowerCase();
  const labelPlacementMode = String(raw.labelPlacementMode || defaults.labelPlacementMode).trim().toLowerCase();
  const unitRendererDefault = String(raw.unitRendererDefault || defaults.unitRendererDefault).trim().toLowerCase();

  return {
    frontlineEnabled: raw.frontlineEnabled === undefined ? defaults.frontlineEnabled : !!raw.frontlineEnabled,
    frontlineStyle: ["clean", "dual-rail", "teeth"].includes(frontlineStyle)
      ? frontlineStyle
      : defaults.frontlineStyle,
    showFrontlineLabels: raw.showFrontlineLabels === undefined
      ? defaults.showFrontlineLabels
      : !!raw.showFrontlineLabels,
    labelPlacementMode: ["midpoint", "centroid"].includes(labelPlacementMode)
      ? labelPlacementMode
      : defaults.labelPlacementMode,
    unitRendererDefault: ["milstd", "game"].includes(unitRendererDefault)
      ? unitRendererDefault
      : defaults.unitRendererDefault,
    unitCounterFixedScaleMultiplier: clamp(
      toFiniteNumber(raw.unitCounterFixedScaleMultiplier, defaults.unitCounterFixedScaleMultiplier),
      0.5,
      2.0,
    ),
    showUnitLabels: raw.showUnitLabels === undefined ? defaults.showUnitLabels : !!raw.showUnitLabels,
  };
}

const TRANSPORT_WORKBENCH_FAMILY_IDS = TRANSPORT_RUNTIME_CAPABILITY_FAMILY_IDS;

const TRANSPORT_WORKBENCH_MODE_IDS = new Set(["inspect", "aggregate", "density"]);
const TRANSPORT_WORKBENCH_PRESET_IDS = new Set([
  "review_first",
  "balanced",
  "pattern_first",
  "extreme_density",
]);
const TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_IDS = new Set([
  "raw",
  "cluster",
  "hex",
  "square",
  "density_surface",
]);
const TRANSPORT_WORKBENCH_LABEL_MIXED_CATEGORY_MODE_IDS = new Set([
  "summary",
  "dominant_only",
  "top_two",
]);
const TRANSPORT_WORKBENCH_COVERAGE_IDS = new Set([
  "default",
  "core",
  "expanded",
  "full_official",
]);

function getDefaultTransportWorkbenchAggregationAlgorithm(familyId) {
  switch (String(familyId || "").trim()) {
    case "mineral_resources":
      return "hex";
    case "industrial_zones":
      return "square";
    case "logistics_hubs":
      return "cluster";
    case "port":
      return "raw";
    case "energy_facilities":
      return "raw";
    default:
      return "raw";
  }
}

function createDefaultTransportWorkbenchDisplayConfig(familyId) {
  const normalizedFamilyId = TRANSPORT_WORKBENCH_FAMILY_IDS.includes(familyId)
    ? familyId
    : "road";
  const coverage =
    normalizedFamilyId === "port"
      ? "core"
      : normalizedFamilyId === "mineral_resources"
        || normalizedFamilyId === "energy_facilities"
        || normalizedFamilyId === "industrial_zones"
        || normalizedFamilyId === "logistics_hubs"
        ? "default"
        : null;
  const mode =
    normalizedFamilyId === "mineral_resources"
      || normalizedFamilyId === "industrial_zones"
      || normalizedFamilyId === "logistics_hubs"
      ? "aggregate"
      : "inspect";
  return {
    mode,
    preset: "balanced",
    aggregation: {
      algorithm: getDefaultTransportWorkbenchAggregationAlgorithm(normalizedFamilyId),
      autoSwitch: true,
      thresholds: {
        zoomInToInspect: null,
        zoomOutToDensity: null,
        viewportDensity: 0.55,
        localExtremeDensity: 0.78,
        categoryConcentration: 0.6,
        labelCollision: 0.35,
        clusterRadiusPx: 48,
        cellSizePx: normalizedFamilyId === "industrial_zones" ? 56 : 44,
      },
    },
    labels: {
      maxLevel: 2,
      budget: 8,
      separationStrength: 1,
      allowAggregation: true,
      dominantCategoryThreshold: 0.62,
      mixedCategoryMode: "summary",
    },
    coverage,
    filters: {},
  };
}

function normalizeTransportWorkbenchDisplayMode(value, fallback = "inspect") {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRANSPORT_WORKBENCH_MODE_IDS.has(normalized)) return normalized;
  return TRANSPORT_WORKBENCH_MODE_IDS.has(fallback) ? fallback : "inspect";
}

function normalizeTransportWorkbenchPreset(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_PRESET_IDS.has(normalized) ? normalized : "balanced";
}

function normalizeTransportWorkbenchAggregationAlgorithm(value, familyId) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_IDS.has(normalized)
    ? normalized
    : getDefaultTransportWorkbenchAggregationAlgorithm(familyId);
}

function normalizeTransportWorkbenchCoverage(value, familyId) {
  if (familyId !== "port") {
    if (value == null || value === "") return familyId === "road" || familyId === "rail" || familyId === "airport"
      ? null
      : "default";
    return TRANSPORT_WORKBENCH_COVERAGE_IDS.has(String(value || "").trim().toLowerCase())
      ? String(value || "").trim().toLowerCase()
      : "default";
  }
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_COVERAGE_IDS.has(normalized) ? normalized : "core";
}

function normalizeTransportWorkbenchDisplayConfig(rawConfig, familyId) {
  const defaults = createDefaultTransportWorkbenchDisplayConfig(familyId);
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawAggregation = raw.aggregation && typeof raw.aggregation === "object" ? raw.aggregation : {};
  const rawThresholds = rawAggregation.thresholds && typeof rawAggregation.thresholds === "object"
    ? rawAggregation.thresholds
    : {};
  const rawLabels = raw.labels && typeof raw.labels === "object" ? raw.labels : {};
  const mixedCategoryMode = String(rawLabels.mixedCategoryMode || defaults.labels.mixedCategoryMode).trim().toLowerCase();
  const filters = raw.filters && typeof raw.filters === "object" ? { ...raw.filters } : {};
  return {
    mode: normalizeTransportWorkbenchDisplayMode(raw.mode, defaults.mode),
    preset: normalizeTransportWorkbenchPreset(raw.preset),
    aggregation: {
      algorithm: normalizeTransportWorkbenchAggregationAlgorithm(rawAggregation.algorithm, familyId),
      autoSwitch: rawAggregation.autoSwitch === undefined ? defaults.aggregation.autoSwitch : !!rawAggregation.autoSwitch,
      thresholds: {
        zoomInToInspect: Number.isFinite(Number(rawThresholds.zoomInToInspect))
          ? clamp(Number(rawThresholds.zoomInToInspect), 0, 24)
          : defaults.aggregation.thresholds.zoomInToInspect,
        zoomOutToDensity: Number.isFinite(Number(rawThresholds.zoomOutToDensity))
          ? clamp(Number(rawThresholds.zoomOutToDensity), 0, 24)
          : defaults.aggregation.thresholds.zoomOutToDensity,
        viewportDensity: clamp(
          toFiniteNumber(rawThresholds.viewportDensity, defaults.aggregation.thresholds.viewportDensity),
          0,
          1
        ),
        localExtremeDensity: clamp(
          toFiniteNumber(rawThresholds.localExtremeDensity, defaults.aggregation.thresholds.localExtremeDensity),
          0,
          1
        ),
        categoryConcentration: clamp(
          toFiniteNumber(rawThresholds.categoryConcentration, defaults.aggregation.thresholds.categoryConcentration),
          0,
          1
        ),
        labelCollision: clamp(
          toFiniteNumber(rawThresholds.labelCollision, defaults.aggregation.thresholds.labelCollision),
          0,
          1
        ),
        clusterRadiusPx: clamp(
          toFiniteNumber(rawThresholds.clusterRadiusPx, defaults.aggregation.thresholds.clusterRadiusPx),
          8,
          256
        ),
        cellSizePx: clamp(
          toFiniteNumber(rawThresholds.cellSizePx, defaults.aggregation.thresholds.cellSizePx),
          8,
          256
        ),
      },
    },
    labels: {
      maxLevel: clamp(Math.round(toFiniteNumber(rawLabels.maxLevel, defaults.labels.maxLevel)), 1, 3),
      budget: clamp(Math.round(toFiniteNumber(rawLabels.budget, defaults.labels.budget)), 0, 64),
      separationStrength: clamp(
        toFiniteNumber(rawLabels.separationStrength, defaults.labels.separationStrength),
        0.7,
        1.8
      ),
      allowAggregation: rawLabels.allowAggregation === undefined
        ? defaults.labels.allowAggregation
        : !!rawLabels.allowAggregation,
      dominantCategoryThreshold: clamp(
        toFiniteNumber(rawLabels.dominantCategoryThreshold, defaults.labels.dominantCategoryThreshold),
        0,
        1
      ),
      mixedCategoryMode: TRANSPORT_WORKBENCH_LABEL_MIXED_CATEGORY_MODE_IDS.has(mixedCategoryMode)
        ? mixedCategoryMode
        : defaults.labels.mixedCategoryMode,
    },
    coverage: normalizeTransportWorkbenchCoverage(raw.coverage, familyId),
    filters,
  };
}

function createDefaultTransportWorkbenchDisplayConfigs() {
  return Object.fromEntries(
    TRANSPORT_WORKBENCH_FAMILY_IDS.map((familyId) => [
      familyId,
      createDefaultTransportWorkbenchDisplayConfig(familyId),
    ])
  );
}

function normalizeTransportWorkbenchDisplayConfigs(rawConfigs) {
  const source = rawConfigs && typeof rawConfigs === "object" ? rawConfigs : {};
  return Object.fromEntries(
    TRANSPORT_WORKBENCH_FAMILY_IDS.map((familyId) => [
      familyId,
      normalizeTransportWorkbenchDisplayConfig(source[familyId], familyId),
    ])
  );
}
function normalizeTransportWorkbenchActivePackId(value, familyId = "road") {
  const normalizedFamilyId = String(familyId || "road").trim().toLowerCase() || "road";
  const candidate = String(value || "").trim().toLowerCase();
  const meta = getTransportWorkbenchPackMeta(candidate) || getTargetMainMapPackMeta(candidate);
  if (meta && meta.family === normalizedFamilyId) return meta.packId;
  return getDefaultTransportWorkbenchPackIdForFamily(normalizedFamilyId) || getDefaultMainMapPackIdForFamily(normalizedFamilyId) || "";
}

function normalizeTransportWorkbenchActivePackIdByFamily(rawValue, activeFamily = "road", activePackId = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const entries = Object.fromEntries(
    TRANSPORT_WORKBENCH_FAMILY_IDS
      .filter((familyId) => familyId !== "layers")
      .map((familyId) => [familyId, normalizeTransportWorkbenchActivePackId(source[familyId], familyId)])
  );
  if (activeFamily && activeFamily !== "layers") {
    entries[activeFamily] = normalizeTransportWorkbenchActivePackId(activePackId || source[activeFamily], activeFamily);
  }
  return entries;
}

const TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS = [
  "airport",
  "port",
  "energy_facilities",
  "mineral_resources",
  "logistics_hubs",
  "industrial_zones",
];

function createDefaultTransportWorkbenchPointDeltas() {
  return {
    schemaVersion: 1,
    byFamily: Object.fromEntries(TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS.map((familyId) => [
      familyId,
      { created: [], updated: [], deleted: [], revision: 0, sourcePackId: "", updatedAt: "" },
    ])),
  };
}

function normalizeTransportWorkbenchPointDeltaFeature(rawFeature, familyId, index = 0) {
  const raw = rawFeature && typeof rawFeature === "object" ? rawFeature : {};
  const lon = toFiniteNumber(raw.lon, NaN);
  const lat = toFiniteNumber(raw.lat, NaN);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const normalizedFamilyId = TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS.includes(familyId) ? familyId : "airport";
  const rawProperties = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
  const properties = {
    ...rawProperties,
    source: "user_overlay",
    source_label: "User overlay",
    edit_overlay: true,
  };
  if (normalizedFamilyId === "airport") {
    properties.airport_type = String(properties.airport_type || "other").trim() || "other";
    properties.status_category = String(properties.status_category || "active").trim() || "active";
  } else if (normalizedFamilyId === "port") {
    properties.legal_designation = String(properties.legal_designation || "local").trim() || "local";
    properties.manager_type_code = String(properties.manager_type_code || "5").trim() || "5";
  }
  return {
    id: String(raw.id || `${normalizedFamilyId}_edit_${index + 1}`).trim(),
    family: normalizedFamilyId,
    packId: normalizeTransportWorkbenchActivePackId(raw.packId, normalizedFamilyId),
    name: String(raw.name || rawProperties.name || "").trim(),
    lon: Math.max(-180, Math.min(180, lon)),
    lat: Math.max(-90, Math.min(90, lat)),
    properties,
  };
}

function normalizeTransportWorkbenchPointDeltaPatch(rawFeature, familyId, index = 0) {
  const raw = rawFeature && typeof rawFeature === "object" ? rawFeature : {};
  const lon = toFiniteNumber(raw.lon, NaN);
  const lat = toFiniteNumber(raw.lat, NaN);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const normalizedFamilyId = TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS.includes(familyId) ? familyId : "airport";
  const rawProperties = raw.properties && typeof raw.properties === "object" ? raw.properties : {};
  const {
    source: _source,
    source_label: _sourceLabel,
    edit_overlay: _editOverlay,
    edit_overlay_mode: _editOverlayMode,
    ...properties
  } = rawProperties;
  return {
    id: String(raw.id || `${normalizedFamilyId}_update_${index + 1}`).trim(),
    family: normalizedFamilyId,
    packId: normalizeTransportWorkbenchActivePackId(raw.packId, normalizedFamilyId),
    name: String(raw.name || rawProperties.name || "").trim(),
    lon: Math.max(-180, Math.min(180, lon)),
    lat: Math.max(-90, Math.min(90, lat)),
    properties,
  };
}

function normalizeTransportWorkbenchPointDeltaFamily(rawFamily, familyId) {
  const raw = rawFamily && typeof rawFamily === "object" ? rawFamily : {};
  const rawCreated = Array.isArray(raw.created)
    ? raw.created
    : (Array.isArray(raw.features) ? raw.features : []);
  const created = rawCreated
    .map((feature, index) => normalizeTransportWorkbenchPointDeltaFeature(feature, familyId, index))
    .filter(Boolean);
  const updated = Array.isArray(raw.updated)
    ? raw.updated
      .map((feature, index) => normalizeTransportWorkbenchPointDeltaPatch(feature, familyId, index))
      .filter(Boolean)
    : [];
  const deleted = Array.isArray(raw.deleted)
    ? Array.from(new Set(raw.deleted.map((value) => String(value || "").trim()).filter(Boolean)))
    : [];
  return {
    created,
    updated,
    deleted,
    revision: Math.max(0, Math.floor(toFiniteNumber(raw.revision, created.length + updated.length + deleted.length))),
    sourcePackId: normalizeTransportWorkbenchActivePackId(raw.sourcePackId, familyId),
    updatedAt: String(raw.updatedAt || "").trim(),
  };
}

function normalizeTransportWorkbenchPointDeltas(rawDeltas) {
  const defaults = createDefaultTransportWorkbenchPointDeltas();
  const raw = rawDeltas && typeof rawDeltas === "object" ? rawDeltas : {};
  const sourceFamilies = raw.byFamily && typeof raw.byFamily === "object" ? raw.byFamily : raw;
  return {
    schemaVersion: 1,
    byFamily: Object.fromEntries(TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS.map((familyId) => [
      familyId,
      {
        ...defaults.byFamily[familyId],
        ...normalizeTransportWorkbenchPointDeltaFamily(sourceFamilies[familyId], familyId),
      },
    ])),
  };
}

function normalizeTransportWorkbenchUiState(rawUi) {
  const raw = rawUi && typeof rawUi === "object" ? rawUi : {};
  const rawPreviewCamera = raw.previewCamera && typeof raw.previewCamera === "object" ? raw.previewCamera : {};
  const familyConfigs = raw.familyConfigs && typeof raw.familyConfigs === "object" ? { ...raw.familyConfigs } : {};
  const sectionOpen = raw.sectionOpen && typeof raw.sectionOpen === "object" ? { ...raw.sectionOpen } : {};
  const previewCarrierId = String(raw.previewCarrierId || "japan").trim().toLowerCase() || "japan";
  const defaultPreviewAssetId = `${previewCarrierId}_carrier_v3`;
  const sampleCountry = String(raw.sampleCountry || (previewCarrierId === "japan" ? "Japan" : "")).trim()
    || (previewCarrierId === "japan" ? "Japan" : previewCarrierId);
  const activeFamily = raw.activeFamily === "layers" || TRANSPORT_WORKBENCH_FAMILY_IDS.includes(raw.activeFamily)
    ? raw.activeFamily
    : "road";
  const activePackIdByFamily = normalizeTransportWorkbenchActivePackIdByFamily(raw.activePackIdByFamily, activeFamily, raw.activePackId);
  const activePackId = activeFamily === "layers" ? "" : activePackIdByFamily[activeFamily];
  return {
    open: !!raw.open,
    activeFamily,
    activePackId,
    activePackIdByFamily,
    activeInspectorTab: ["inspect", "display", "aggregation", "labels", "coverage", "data"].includes(String(raw.activeInspectorTab || "").trim().toLowerCase())
      ? String(raw.activeInspectorTab || "").trim().toLowerCase()
      : "inspect",
    sampleCountry,
    previewCarrierId,
    previewMode: "bounded_zoom_pan",
    previewAssetId: String(raw.previewAssetId || defaultPreviewAssetId).trim() || defaultPreviewAssetId,
    previewInteractionMode: "bounded_zoom_pan",
    previewCamera: {
      scale: toFiniteNumber(rawPreviewCamera.scale, 1) || 1,
      translateX: toFiniteNumber(rawPreviewCamera.translateX, 0),
      translateY: toFiniteNumber(rawPreviewCamera.translateY, 0),
    },
    layerOrder: TRANSPORT_WORKBENCH_FAMILY_IDS.filter((familyId) => {
      const savedOrder = Array.isArray(raw.layerOrder) ? raw.layerOrder : [];
      return savedOrder.includes(familyId);
    }).concat(
      TRANSPORT_WORKBENCH_FAMILY_IDS.filter((familyId) => !(Array.isArray(raw.layerOrder) ? raw.layerOrder : []).includes(familyId))
    ),
    familyConfigs,
    displayConfigs: normalizeTransportWorkbenchDisplayConfigs(raw.displayConfigs),
    sectionOpen,
    shellPhase: "road-live-preview",
    restoreLeftDrawer: !!raw.restoreLeftDrawer,
    restoreRightDrawer: !!raw.restoreRightDrawer,
  };
}

const EXPORT_WORKBENCH_TARGETS = new Set(["composite", "per-layer", "bake-pack"]);
const EXPORT_WORKBENCH_LAYER_IDS = Object.freeze([
  "background",
  "political",
  "context",
  "effects",
  "labels",
]);
const EXPORT_WORKBENCH_TEXT_LAYER_IDS = Object.freeze([
  "render-labels",
  "special-zones",
  "svg-annotations",
]);
const EXPORT_WORKBENCH_BAKE_LAYER_IDS = new Set(["color", "line", "text", "composite"]);
const EXPORT_WORKBENCH_LEGACY_LAYER_ID_ALIASES = Object.freeze({
  base: "background",
  paint: "political",
  borders: "effects",
  labels: "labels",
  overlay: "context",
});
const EXPORT_WORKBENCH_TEXT_LAYER_ID_ALIASES = Object.freeze({
  labels: "render-labels",
  text: "render-labels",
  specialzones: "special-zones",
  "special-zones": "special-zones",
  svg: "svg-annotations",
  annotations: "svg-annotations",
});

function normalizeExportWorkbenchLayerOrder(rawOrder) {
  const savedOrder = Array.isArray(rawOrder)
    ? rawOrder
      .map((value) => String(value || "").trim().toLowerCase())
      .map((value) => EXPORT_WORKBENCH_LEGACY_LAYER_ID_ALIASES[value] || value)
      .filter(Boolean)
    : [];
  const deduped = Array.from(new Set(savedOrder.filter((layerId) => EXPORT_WORKBENCH_LAYER_IDS.includes(layerId))));
  EXPORT_WORKBENCH_LAYER_IDS.forEach((layerId) => {
    if (!deduped.includes(layerId)) {
      deduped.push(layerId);
    }
  });
  return deduped;
}

function normalizeExportWorkbenchVisibility(rawVisibility) {
  const source = rawVisibility && typeof rawVisibility === "object" ? rawVisibility : {};
  const normalizedSource = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      EXPORT_WORKBENCH_LEGACY_LAYER_ID_ALIASES[String(key || "").trim().toLowerCase()] || String(key || "").trim().toLowerCase(),
      value,
    ])
  );
  return Object.fromEntries(
    EXPORT_WORKBENCH_LAYER_IDS.map((layerId) => [
      layerId,
      normalizedSource[layerId] === undefined ? true : !!normalizedSource[layerId],
    ])
  );
}

function normalizeExportWorkbenchBakeArtifacts(rawArtifacts) {
  if (!Array.isArray(rawArtifacts)) return [];
  return rawArtifacts
    .map((entry) => {
      const artifact = entry && typeof entry === "object" ? entry : {};
      const layerId = String(artifact.layerId || "").trim().toLowerCase();
      if (!EXPORT_WORKBENCH_BAKE_LAYER_IDS.has(layerId)) return null;
      const dependencies = Array.isArray(artifact.dependencies)
        ? artifact.dependencies.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const uniqueDependencies = Array.from(new Set(dependencies));
      const canvasSize = artifact.canvasSize && typeof artifact.canvasSize === "object"
        ? artifact.canvasSize
        : {};
      const width = Math.max(0, Math.round(toFiniteNumber(canvasSize.width, 0)));
      const height = Math.max(0, Math.round(toFiniteNumber(canvasSize.height, 0)));
      return {
        layerId,
        updatedAt: Math.max(0, Math.round(toFiniteNumber(artifact.updatedAt, 0))),
        dependencies: uniqueDependencies,
        canvasSize: { width, height },
        dirtyFlag: artifact.dirtyFlag === undefined ? true : !!artifact.dirtyFlag,
      };
    })
    .filter(Boolean);
}

function normalizeExportWorkbenchAdjustment(value, fallback = 100) {
  const candidate = value === null
    || value === undefined
    || (typeof value === "string" && value.trim() === "")
    ? fallback
    : value;
  return Math.max(0, Math.min(200, Math.round(toFiniteNumber(candidate, fallback))));
}

function normalizeExportWorkbenchTextVisibility(rawVisibility, includeTextLayer = true) {
  const source = rawVisibility && typeof rawVisibility === "object" ? rawVisibility : {};
  const normalizedSource = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      EXPORT_WORKBENCH_TEXT_LAYER_ID_ALIASES[String(key || "").trim().toLowerCase()] || String(key || "").trim().toLowerCase(),
      value,
    ])
  );
  return Object.fromEntries(
    EXPORT_WORKBENCH_TEXT_LAYER_IDS.map((layerId) => [
      layerId,
      normalizedSource[layerId] === undefined ? !!includeTextLayer : !!normalizedSource[layerId],
    ])
  );
}

function normalizeExportWorkbenchUiState(rawUi) {
  const raw = rawUi && typeof rawUi === "object" ? rawUi : {};
  const rawTarget = String(raw.target || "").trim().toLowerCase();
  const normalizedTarget = rawTarget === "per-layer-png"
    ? "per-layer"
    : rawTarget;
  const visibilitySource = raw.visibility && typeof raw.visibility === "object"
    ? raw.visibility
    : raw.layerVisibility;
  const includeTextLayer = raw.includeTextLayer === undefined ? true : !!raw.includeTextLayer;
  const textVisibility = normalizeExportWorkbenchTextVisibility(raw.textVisibility, includeTextLayer);
  const rawPreviewLayerId = String(raw.previewLayerId || raw.previewSource || "background").trim().toLowerCase();
  const previewLayerId = EXPORT_WORKBENCH_LEGACY_LAYER_ID_ALIASES[rawPreviewLayerId]
    || EXPORT_WORKBENCH_TEXT_LAYER_ID_ALIASES[rawPreviewLayerId]
    || rawPreviewLayerId;
  return {
    target: EXPORT_WORKBENCH_TARGETS.has(normalizedTarget) ? normalizedTarget : "composite",
    format: String(raw.format || "").trim().toLowerCase() === "jpg" ? "jpg" : "png",
    includeTextLayer: Object.values(textVisibility).some(Boolean),
    layerOrder: normalizeExportWorkbenchLayerOrder(raw.layerOrder),
    visibility: normalizeExportWorkbenchVisibility(visibilitySource),
    textVisibility,
    previewMode: String(raw.previewMode || "").trim().toLowerCase() === "layer" ? "layer" : "main",
    previewLayerId: [
      ...EXPORT_WORKBENCH_LAYER_IDS,
      ...EXPORT_WORKBENCH_TEXT_LAYER_IDS,
    ].includes(previewLayerId) ? previewLayerId : "background",
    scale: ["1", "1.5", "2", "4"].includes(String(raw.scale || "").trim()) ? String(raw.scale).trim() : "2",
    adjustments: {
      brightness: normalizeExportWorkbenchAdjustment(raw.adjustments?.brightness ?? raw.brightness, 100),
      contrast: normalizeExportWorkbenchAdjustment(raw.adjustments?.contrast ?? raw.contrast, 100),
      saturation: normalizeExportWorkbenchAdjustment(raw.adjustments?.saturation ?? raw.saturation, 100),
      clarity: normalizeExportWorkbenchAdjustment(raw.adjustments?.clarity ?? raw.clarity, 100),
    },
    bakeArtifacts: normalizeExportWorkbenchBakeArtifacts(raw.bakeArtifacts),
  };
}

export {
  PALETTE_THEMES,
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  defaultZoom,
  MAP_SEMANTIC_MODES,
  countryNames,
  countryPresets,
  detailOverlaySupportTiers,
  PHYSICAL_PRESET_KEYS,
  PHYSICAL_ATLAS_CLASS_KEYS,
  PHYSICAL_ATLAS_PALETTE,
  createPhysicalPresetConfig,
  createPhysicalStyleConfigForPreset,
  createDefaultPhysicalStyleConfig,
  createDefaultPhysicalAtlasVisibility,
  normalizePhysicalPreset,
  normalizePhysicalMode,
  normalizePhysicalBlendMode,
  normalizePhysicalStyleConfig,
  createDefaultLakeStyleConfig,
  normalizeLakeStyleConfig,
  createDefaultTransportWorkbenchPointDeltas,
  createDefaultUrbanStyleConfig,
  normalizeUrbanStyleConfig,
  createDefaultCityLayerStyleConfig,
  normalizeCityLayerStyleConfig,
  TRANSPORT_OVERVIEW_FAMILY_IDS,
  createDefaultTransportOverviewFamilyConfig,
  createDefaultTransportOverviewStyleConfig,
  normalizeTransportOverviewScopeLinkMode,
  resolveLinkedTransportOverviewScopeAndThreshold,
  normalizeTransportOverviewFamilyConfig,
  normalizeTransportOverviewStyleConfig,
  PRESET_STORAGE_KEY,
  createDefaultTextureStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
  createDefaultDayNightStyleConfig,
  normalizeDayNightStyleConfig,
  createDefaultAnnotationView,
  normalizeAnnotationView,
  TRANSPORT_WORKBENCH_FAMILY_IDS,
  TRANSPORT_WORKBENCH_EDIT_OVERLAY_FAMILY_IDS,
  createDefaultTransportWorkbenchDisplayConfig,
  createDefaultTransportWorkbenchDisplayConfigs,
  normalizeTransportWorkbenchDisplayConfig,
  normalizeTransportWorkbenchDisplayConfigs,
  normalizeTransportWorkbenchPointDeltas,
  normalizeTransportWorkbenchUiState,
  normalizeExportWorkbenchUiState,
};

export function normalizeMapSemanticMode(value, fallback = "political") {
  const normalized = String(value || "").trim().toLowerCase();
  if (MAP_SEMANTIC_MODES.has(normalized)) {
    return normalized;
  }
  return MAP_SEMANTIC_MODES.has(fallback) ? fallback : "political";
}
