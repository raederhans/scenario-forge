import { normalizeHexColor } from "../color_hex_utils.js";
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
    paletteLibraryOpen: true,
    paletteLibrarySearch: "",
    // 色板库分组是可保存 UI 状态；default 保留历史平铺顺序，
    // region 消费 import 阶段写入的地区 metadata。
    paletteLibraryGroupingMode: "default",
    paletteLibraryEntries: [],
    paletteQuickSwatches: [],
    currentPaletteTheme: "HOI4 Vanilla",
    colorMode: "political",
    selectedColor: PALETTE_THEMES["HOI4 Vanilla"][0],
    legendLabels: {},
    legendConfig: {
      mode: "weighted-random",
      continent: "all",
      useModernMajorOrder: false,
      maxItems: 15,
    },
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

function replaceObjectContents(target, nextValues) {
  Object.keys(target || {}).forEach((key) => {
    delete target[key];
  });
  Object.entries(nextValues || {}).forEach(([key, value]) => {
    target[key] = value;
  });
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

export function applyResolvedDefaultCountryPaletteState(
  target,
  nextPalette = {},
  {
    overwriteCountryPalette = false,
    defaultPaletteTarget = null,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return {};
  }
  target.resolvedDefaultCountryPalette = nextPalette && typeof nextPalette === "object"
    ? nextPalette
    : {};
  if (defaultPaletteTarget && typeof defaultPaletteTarget === "object") {
    replaceObjectContents(defaultPaletteTarget, target.resolvedDefaultCountryPalette);
  }
  if (overwriteCountryPalette) {
    replaceObjectContents(target.countryPalette, target.resolvedDefaultCountryPalette);
  }
  return target.resolvedDefaultCountryPalette;
}

export function setPaletteLibraryEntriesState(target, entries = []) {
  if (!target || typeof target !== "object") {
    return [];
  }
  target.paletteLibraryEntries = Array.isArray(entries) ? entries : [];
  return target.paletteLibraryEntries;
}

export function setPaletteQuickSwatchesState(target, swatches = [], maxCount = 24) {
  if (!target || typeof target !== "object") {
    return [];
  }
  target.paletteQuickSwatches = Array.isArray(swatches)
    ? swatches.slice(0, maxCount)
    : [];
  return target.paletteQuickSwatches;
}

export function applyActivePaletteRuntimeState(
  target,
  {
    fixedPaletteColorsByIso2 = {},
    activePaletteOceanMeta = null,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  target.fixedPaletteColorsByIso2 =
    fixedPaletteColorsByIso2 && typeof fixedPaletteColorsByIso2 === "object"
      ? fixedPaletteColorsByIso2
      : {};
  target.activePaletteOceanMeta = activePaletteOceanMeta || null;
  return target.fixedPaletteColorsByIso2;
}

export function commitActivePaletteSourceState(
  target,
  {
    activePaletteId,
    activePaletteMeta = null,
    activePalettePack = null,
    activePaletteMap = null,
    currentPaletteTheme,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.activePaletteId = String(activePaletteId || "").trim();
  target.activePaletteMeta = activePaletteMeta || null;
  target.activePalettePack = activePalettePack || null;
  target.activePaletteMap = activePaletteMap || null;
  target.currentPaletteTheme = String(
    currentPaletteTheme || target.currentPaletteTheme || target.activePaletteId || "HOI4 Vanilla"
  );
  return target.activePaletteId;
}

export function restoreActivePaletteSourceState(target, snapshot = {}) {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.activePaletteId = snapshot.activePaletteId;
  target.activePaletteMeta = snapshot.activePaletteMeta;
  target.activePalettePack = snapshot.activePalettePack;
  target.activePaletteMap = snapshot.activePaletteMap;
  target.currentPaletteTheme = snapshot.currentPaletteTheme;
  target.activePaletteOceanMeta = snapshot.activePaletteOceanMeta;
  return target.activePaletteId;
}

export function setPaletteLoadErrorState(target, paletteId, errorMessage = "") {
  if (!target || typeof target !== "object") {
    return "";
  }
  const targetId = String(paletteId || "").trim();
  if (!targetId) {
    return "";
  }
  const loadErrorById = ensurePaletteCacheRecord(target, "paletteLoadErrorById");
  loadErrorById[targetId] = String(errorMessage || "");
  return loadErrorById[targetId];
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
  target.specialRegionOverrides = {};
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

function collectMirrorIssues(sourceValue, mirrorValue, sourceName, mirrorName) {
  const source = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
    ? sourceValue
    : {};
  const mirror = mirrorValue && typeof mirrorValue === "object" && !Array.isArray(mirrorValue)
    ? mirrorValue
    : {};
  const issueKeys = new Set([
    ...Object.keys(source),
    ...Object.keys(mirror),
  ]);
  return Array.from(issueKeys)
    .sort((left, right) => String(left).localeCompare(String(right)))
    .flatMap((key) => {
      const sourceHas = Object.prototype.hasOwnProperty.call(source, key);
      const mirrorHas = Object.prototype.hasOwnProperty.call(mirror, key);
      if (!sourceHas && !mirrorHas) return [];
      if (!sourceHas || !mirrorHas) {
        return [{
          mirror: `${sourceName}<->${mirrorName}`,
          key,
          kind: "missing-key",
          sourceName,
          mirrorName,
          sourceValue: sourceHas ? source[key] : undefined,
          mirrorValue: mirrorHas ? mirror[key] : undefined,
        }];
      }
      if (source[key] === mirror[key]) return [];
      return [{
        mirror: `${sourceName}<->${mirrorName}`,
        key,
        kind: "value-mismatch",
        sourceName,
        mirrorName,
        sourceValue: source[key],
        mirrorValue: mirror[key],
      }];
    });
}

export function collectColorStateConsistencyIssues(target) {
  if (!target || typeof target !== "object") {
    return [];
  }
  return [
    ...collectMirrorIssues(
      target.sovereignBaseColors,
      target.countryBaseColors,
      "sovereignBaseColors",
      "countryBaseColors",
    ),
    ...collectMirrorIssues(
      target.visualOverrides,
      target.featureOverrides,
      "visualOverrides",
      "featureOverrides",
    ),
  ];
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

/** Apply one visual edit batch. Effects/history belong to the caller. */
export function applyFeaturePaintState(target, featureIds, value, { remove = false } = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("Paint state requires a state object");
  }
  if (!Array.isArray(featureIds)) throw new TypeError("Paint targets must be an array");
  const ids = Array.from(new Set(featureIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.some((id) => ["__proto__", "constructor", "prototype"].includes(id))) {
    throw new TypeError("Invalid paint feature ID");
  }
  if (!ids.length) return [];
  const color = remove ? null : normalizeHexColor(value);
  if (!remove && !color) throw new TypeError("Paint color must be a hexadecimal RGB color");
  // Validate the entire request before the first mutation. Existing storage
  // names are transition adapters, not two independently editable states.
  target.visualOverrides = target.visualOverrides && typeof target.visualOverrides === "object" && !Array.isArray(target.visualOverrides)
    ? target.visualOverrides : {};
  target.featureOverrides = target.featureOverrides && typeof target.featureOverrides === "object" && !Array.isArray(target.featureOverrides)
    ? target.featureOverrides : {};
  for (const id of ids) {
    if (remove) {
      delete target.visualOverrides[id];
      delete target.featureOverrides[id];
    } else {
      target.visualOverrides[id] = color;
      target.featureOverrides[id] = color;
    }
  }
  return ids;
}
