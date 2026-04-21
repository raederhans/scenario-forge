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
