// Color/palette state defaults.
// 这里收口渲染颜色、palette 选择、preset 编辑和 inspector 展开状态，
// 让 color 相关默认值只维护一份真源。

import {
  PALETTE_THEMES,
  defaultCountryPalette,
} from "../state_defaults.js";

export function createDefaultColorState() {
  return {
    // Resolved colors used by canvas render/legend.
    colors: {},
    // Country-level base colors (applies when no subdivision override exists).
    countryBaseColors: {},
    sovereignBaseColors: {},
    // Subdivision-level explicit color overrides keyed by feature ID.
    featureOverrides: {},
    visualOverrides: {},
    waterRegionOverrides: {},
    specialRegionOverrides: {},
    sovereigntyByFeatureId: {},
    sovereigntyInitialized: false,
    sovereigntyRevision: 0,
    mapSemanticMode: "political",
    dynamicBordersEnabled: true,
    dynamicBordersDirty: false,
    dynamicBordersDirtyReason: "",
    pendingDynamicBorderTimerId: null,
    ownerToFeatureIds: new Map(),
    runtimeFeatureIndexById: new Map(),
    runtimeFeatureIds: [],
    runtimeNeighborGraph: [],
    runtimeCanonicalCountryByFeatureId: {},
    runtimePoliticalMetaSeed: null,
    runtimePoliticalMetaReadyFromWorker: false,
    paintMode: "visual",
    activeSovereignCode: "",
    sovereignContrastWarnings: [],
    interactionGranularity: "subdivision",
    batchFillScope: "parent",
    paletteRegistry: null,
    activePaletteId: "hoi4_vanilla",
    activePaletteMeta: null,
    activePalettePack: null,
    activePaletteMap: null,
    activePaletteOceanMeta: null,
    palettePackCacheById: {},
    paletteMapCacheById: {},
    paletteLoadErrorById: {},
    fixedPaletteColorsByIso2: {},
    resolvedDefaultCountryPalette: { ...defaultCountryPalette },
    paletteLibraryOpen: false,
    paletteLibrarySearch: "",
    paletteLibraryEntries: [],
    paletteQuickSwatches: [],
    currentPaletteTheme: "HOI4 Vanilla",
    colorMode: "political",
    selectedColor: PALETTE_THEMES["HOI4 Vanilla"][0],
    selectedInspectorCountryCode: "",
    inspectorExpansionInitialized: false,
    inspectorHighlightCountryCode: "",
    currentTool: "fill",
    brushModeEnabled: false,
    brushPanModifierActive: false,
  };
}

export function createDefaultColorPresetState() {
  return {
    isEditingPreset: false,
    editingPresetRef: null,
    editingPresetIds: new Set(),
    customPresets: {},
    presetsState: {},
    legacyColorStateDirty: true,
    expandedInspectorContinents: new Set(),
    expandedInspectorReleaseParents: new Set(),
    expandedPresetCountries: new Set(),
  };
}

function ensurePaletteCacheRecord(target, key) {
  if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
    target[key] = {};
  }
  return target[key];
}

// Startup boot loads one initial palette pack/map pair; this helper keeps the
// palette root writes in the color-state owner without changing runtime flow.
export function hydrateStartupPaletteState(
  target,
  {
    paletteRegistry,
    activePaletteMeta,
    activePalettePack,
    activePaletteMap,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.paletteRegistry = paletteRegistry || null;
  target.activePaletteMeta = activePaletteMeta || null;
  target.activePalettePack = activePalettePack || null;
  target.activePaletteMap = activePaletteMap || null;
  target.activePaletteId = String(
    activePaletteMeta?.palette_id
    || paletteRegistry?.default_palette_id
    || target.activePaletteId
    || "hoi4_vanilla"
  ).trim();
  target.currentPaletteTheme = String(
    activePaletteMeta?.display_name
    || target.currentPaletteTheme
    || "HOI4 Vanilla"
  ).trim() || "HOI4 Vanilla";
  const palettePackCacheById = ensurePaletteCacheRecord(target, "palettePackCacheById");
  const paletteMapCacheById = ensurePaletteCacheRecord(target, "paletteMapCacheById");
  ensurePaletteCacheRecord(target, "paletteLoadErrorById");
  if (target.activePaletteId && activePalettePack) {
    palettePackCacheById[target.activePaletteId] = activePalettePack;
  }
  if (target.activePaletteId && activePaletteMap) {
    paletteMapCacheById[target.activePaletteId] = activePaletteMap;
  }
  return target.activePaletteId;
}

export function replaceResolvedColorsState(target, nextColors = {}) {
  if (!target || typeof target !== "object") {
    return {};
  }
  target.colors = nextColors && typeof nextColors === "object"
    ? nextColors
    : {};
  return target.colors;
}

export function setResolvedColorForFeature(target, featureId, color) {
  if (!target || typeof target !== "object") {
    return false;
  }
  const normalizedFeatureId = String(featureId || "").trim();
  if (!normalizedFeatureId) {
    return false;
  }
  if (!target.colors || typeof target.colors !== "object" || Array.isArray(target.colors)) {
    target.colors = {};
  }
  if (color) {
    target.colors[normalizedFeatureId] = color;
    return true;
  }
  delete target.colors[normalizedFeatureId];
  return false;
}

export function bumpColorRevision(target) {
  if (!target || typeof target !== "object") {
    return 0;
  }
  target.colorRevision = Number(target.colorRevision || 0) + 1;
  return target.colorRevision;
}

export function sanitizeRegionOverrideColors(
  target,
  { sanitizeColorMap = (value) => value } = {},
) {
  if (!target || typeof target !== "object") {
    return {
      waterRegionOverrides: {},
      specialRegionOverrides: {},
    };
  }
  target.waterRegionOverrides = sanitizeColorMap(target.waterRegionOverrides);
  target.specialRegionOverrides = sanitizeColorMap(target.specialRegionOverrides);
  return {
    waterRegionOverrides: target.waterRegionOverrides,
    specialRegionOverrides: target.specialRegionOverrides,
  };
}

function syncPlainObjectMirror(targetValue, sourceValue) {
  const source = sourceValue && typeof sourceValue === "object" ? sourceValue : {};
  const target = targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
    ? targetValue
    : {};
  const sourceKeys = new Set(Object.keys(source));
  Object.keys(target).forEach((key) => {
    if (!sourceKeys.has(key)) {
      delete target[key];
    }
  });
  sourceKeys.forEach((key) => {
    const nextValue = source[key];
    if (target[key] !== nextValue) {
      target[key] = nextValue;
    }
  });
  return target;
}

export function normalizeColorStateForRender(
  target,
  {
    sanitizeColorMap = (value) => value,
    sanitizeCountryColorMap = (value) => value,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.countryBaseColors = sanitizeCountryColorMap(target.countryBaseColors);
  target.featureOverrides = sanitizeColorMap(target.featureOverrides);
  target.sovereignBaseColors = sanitizeCountryColorMap(target.sovereignBaseColors);
  target.visualOverrides = sanitizeColorMap(target.visualOverrides);
  sanitizeRegionOverrideColors(target, { sanitizeColorMap });
  target.colors = sanitizeColorMap(target.colors);
  target.countryBaseColors = syncPlainObjectMirror(target.countryBaseColors, target.sovereignBaseColors);
  target.featureOverrides = syncPlainObjectMirror(target.featureOverrides, target.visualOverrides);
  return target;
}
