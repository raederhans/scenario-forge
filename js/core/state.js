// Centralized app state (Phase 13 scaffold)

const PALETTE_THEMES = {
  "HOI4 Vanilla": [
    "#871818", "#d62828", "#f77f00", "#fcbf49",
    "#3e5c76", "#1d3557", "#457b9d", "#a8dadc",
    "#333333", "#5c5c5c", "#8a8a8a", "#4f772d",
    "#8c2f39", "#9e2a2b", "#b23a48", "#6d597a",
  ],
  "TNO (The New Order)": [
    "#420420", "#5e0d0d", "#2a2a2a", "#0f0f0f",
    "#00f7ff", "#00d9ff", "#00ff9d", "#ccff00",
    "#ff0055", "#ffcc00", "#8a2be2", "#2e8b57",
    "#adb5bd", "#6c757d", "#495057", "#343a40",
  ],
  "Kaiserreich": [
    "#7b1113", "#a31621", "#bf1a2f", "#e01e37",
    "#2d6a4f", "#40916c", "#52b788", "#74c69d",
    "#14213d", "#fca311", "#e5e5e5", "#ffffff",
    "#ffb703", "#fb8500", "#8e9aaf", "#cbc0d3",
  ],
  "Red Flood (Avant-Garde)": [
    "#ff0000", "#ffaa00", "#ffff00", "#00ff00",
    "#00ffff", "#0000ff", "#ff00ff", "#9d4edd",
    "#240046", "#3c096c", "#5a189a", "#7b2cbf",
    "#10002b", "#000000", "#ffffff", "#ff5400",
  ],
};

const countryPalette = {
  DE: "#5d7cba",
  FR: "#4a90e2",
  IT: "#50e3c2",
  PL: "#f5a623",
  NL: "#7ed321",
  BE: "#bd10e0",
  LU: "#8b572a",
  AT: "#417505",
  CH: "#d0021b",
  UA: "#6b8fd6",
  BY: "#9b5de5",
  MD: "#f28482",
  RU: "#4a4e69",
  GE: "#a23e48",
  AM: "#2a9d8f",
  AZ: "#f4a261",
  MN: "#577590",
  CN: "#c1121f",
  IN: "#d62828",
  PK: "#2d6a4f",
  BD: "#1d4ed8",
  NP: "#f97316",
  BT: "#7c3aed",
  MM: "#f59e0b",
  LK: "#0f766e",
  JP: "#38b000",
  KR: "#2563eb",
  KP: "#7f1d1d",
  TW: "#f59e0b",
  ES: "#e74c3c",
  PT: "#9b59b6",
  CZ: "#3498db",
  SK: "#1abc9c",
  HU: "#e67e22",
  RO: "#2ecc71",
  BG: "#f39c12",
  HR: "#16a085",
  SI: "#27ae60",
  EE: "#2980b9",
  LV: "#8e44ad",
  LT: "#c0392b",
  FI: "#d35400",
  SE: "#7f8c8d",
  NO: "#34495e",
  DK: "#95a5a6",
  IE: "#1e8449",
  UK: "#5d6d7e",
  GB: "#5d6d7e",
  GR: "#148f77",
  CY: "#d68910",
  MT: "#a93226",
  TR: "#b03a2e",
  RS: "#6c3483",
  BA: "#1a5276",
  ME: "#117a65",
  AL: "#b9770e",
  MK: "#7d3c98",
  XK: "#2e4053",
  IS: "#5499c7",
  LI: "#45b39d",
};

const legacyDefaultCountryPalette = { ...countryPalette };
const defaultCountryPalette = { ...countryPalette };

const countryNames = {
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  PL: "Poland",
  NL: "Netherlands",
  BE: "Belgium",
  LU: "Luxembourg",
  AT: "Austria",
  CH: "Switzerland",
  UA: "Ukraine",
  BY: "Belarus",
  MD: "Moldova",
  RU: "Russia",
  GE: "Georgia",
  AM: "Armenia",
  AZ: "Azerbaijan",
  MN: "Mongolia",
  CN: "China",
  IN: "India",
  PK: "Pakistan",
  BD: "Bangladesh",
  NP: "Nepal",
  BT: "Bhutan",
  MM: "Myanmar",
  LK: "Sri Lanka",
  JP: "Japan",
  KR: "South Korea",
  KP: "North Korea",
  TW: "Taiwan",
  ES: "Spain",
  PT: "Portugal",
  CZ: "Czechia",
  SK: "Slovakia",
  HU: "Hungary",
  RO: "Romania",
  BG: "Bulgaria",
  HR: "Croatia",
  SI: "Slovenia",
  EE: "Estonia",
  LV: "Latvia",
  LT: "Lithuania",
  FI: "Finland",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  IE: "Ireland",
  UK: "United Kingdom",
  GB: "United Kingdom",
  GR: "Greece",
  CY: "Cyprus",
  MT: "Malta",
  TR: "Turkey",
  RS: "Serbia",
  BA: "Bosnia and Herzegovina",
  ME: "Montenegro",
  AL: "Albania",
  MK: "North Macedonia",
  XK: "Kosovo",
  IS: "Iceland",
  LI: "Liechtenstein",
};

const countryPresets = {
  // GERMANY - Historical & HOI4
  DE: [
    {
      name: "Bavaria",
      ids: [
        "DE211", "DE212", "DE213", "DE214", "DE215", "DE216", "DE217", "DE218", "DE219",
        "DE21A", "DE21B", "DE21C", "DE21D", "DE21E", "DE21F", "DE21G", "DE21H", "DE21I",
        "DE21J", "DE21K", "DE21L", "DE21M", "DE21N", "DE221", "DE222", "DE223", "DE224",
        "DE225", "DE226", "DE227", "DE228", "DE229", "DE22A", "DE22B", "DE22C", "DE231",
        "DE232", "DE233", "DE234", "DE235", "DE236", "DE237", "DE238", "DE239", "DE23A",
        "DE241", "DE242", "DE243", "DE244", "DE245", "DE246", "DE247", "DE248", "DE249",
        "DE24A", "DE24B", "DE24C", "DE24D", "DE251", "DE252", "DE253", "DE254", "DE255",
        "DE256", "DE257", "DE258", "DE259", "DE25A", "DE25B", "DE25C", "DE261", "DE262",
        "DE263", "DE264", "DE265", "DE266", "DE267", "DE268", "DE269", "DE26A", "DE26B",
        "DE26C", "DE271", "DE272", "DE273", "DE274", "DE275", "DE276", "DE277", "DE278",
        "DE279", "DE27A", "DE27B", "DE27C", "DE27D", "DE27E",
      ],
    },
    {
      name: "Saxony",
      ids: [
        "DED21", "DED2C", "DED2D", "DED2E", "DED2F", "DED41", "DED42", "DED43", "DED44",
        "DED45", "DED51", "DED52", "DED53",
      ],
    },
    {
      name: "Prussia (Eastern Core)",
      ids: [
        // Berlin
        "DE300",
        // Brandenburg
        "DE401", "DE402", "DE403", "DE404", "DE405", "DE406", "DE407", "DE408", "DE409",
        "DE40A", "DE40B", "DE40C", "DE40D", "DE40E", "DE40F", "DE40G", "DE40H", "DE40I",
        // Mecklenburg-Vorpommern
        "DE803", "DE804", "DE80J", "DE80K", "DE80L", "DE80M", "DE80N", "DE80O",
        // Saxony-Anhalt
        "DEE01", "DEE02", "DEE03", "DEE04", "DEE05", "DEE06", "DEE07", "DEE08", "DEE09",
        "DEE0A", "DEE0B", "DEE0C", "DEE0D", "DEE0E",
      ],
    },
    {
      name: "Schleswig-Holstein",
      ids: [
        "DEF01", "DEF02", "DEF03", "DEF04", "DEF05", "DEF06", "DEF07", "DEF08", "DEF09",
        "DEF0A", "DEF0B", "DEF0C", "DEF0D", "DEF0E", "DEF0F",
      ],
    },
  ],

  // FRANCE - Historical & HOI4
  FR: [
    {
      name: "Alsace-Lorraine (1871)",
      ids: [
        // Moselle (57)
        "FR_ARR_57003", "FR_ARR_57005", "FR_ARR_57006", "FR_ARR_57007", "FR_ARR_57009",
        // Bas-Rhin (67)
        "FR_ARR_67002", "FR_ARR_67003", "FR_ARR_67004", "FR_ARR_67005", "FR_ARR_67008",
        // Haut-Rhin (68)
        "FR_ARR_68001", "FR_ARR_68002", "FR_ARR_68004", "FR_ARR_68006",
      ],
    },
    {
      name: "Brittany",
      ids: [
        // Côtes-d'Armor (22)
        "FR_ARR_22001", "FR_ARR_22002", "FR_ARR_22003", "FR_ARR_22004",
        // Finistère (29)
        "FR_ARR_29001", "FR_ARR_29002", "FR_ARR_29003", "FR_ARR_29004",
        // Ille-et-Vilaine (35)
        "FR_ARR_35001", "FR_ARR_35002", "FR_ARR_35003", "FR_ARR_35004",
        // Morbihan (56)
        "FR_ARR_56001", "FR_ARR_56002", "FR_ARR_56003",
      ],
    },
    {
      name: "Savoy & Nice (pre-1860)",
      ids: [
        // Alpes-Maritimes (06)
        "FR_ARR_06001", "FR_ARR_06002",
        // Savoie (73)
        "FR_ARR_73001", "FR_ARR_73002", "FR_ARR_73003",
        // Haute-Savoie (74)
        "FR_ARR_74001", "FR_ARR_74002", "FR_ARR_74003", "FR_ARR_74004",
      ],
    },
    {
      name: "TNO Burgundy (SS State)",
      ids: [
        // Alsace-Lorraine regions
        "FR_ARR_57003", "FR_ARR_57005", "FR_ARR_57006", "FR_ARR_57007", "FR_ARR_57009",
        "FR_ARR_67002", "FR_ARR_67003", "FR_ARR_67004", "FR_ARR_67005", "FR_ARR_67008",
        "FR_ARR_68001", "FR_ARR_68002", "FR_ARR_68004", "FR_ARR_68006",
        // Franche-Comté (25, 39, 70, 90)
        "FR_ARR_25001", "FR_ARR_25002", "FR_ARR_25003",
        "FR_ARR_39001", "FR_ARR_39002", "FR_ARR_39003",
        "FR_ARR_70001", "FR_ARR_70002",
        "FR_ARR_90001",
        // Bourgogne (21, 58, 71, 89)
        "FR_ARR_21001", "FR_ARR_21002", "FR_ARR_21003",
        "FR_ARR_58001", "FR_ARR_58002", "FR_ARR_58003", "FR_ARR_58004",
        "FR_ARR_71001", "FR_ARR_71002", "FR_ARR_71003", "FR_ARR_71004", "FR_ARR_71005",
        "FR_ARR_89001", "FR_ARR_89002", "FR_ARR_89003",
      ],
    },
  ],

  // ITALY - Historical
  IT: [
    {
      name: "Kingdom of Two Sicilies",
      ids: [
        // Abruzzo
        "ITF11", "ITF12", "ITF13", "ITF14",
        // Molise
        "ITF21", "ITF22",
        // Campania
        "ITF31", "ITF32", "ITF33", "ITF34", "ITF35",
        // Puglia
        "ITF43", "ITF44", "ITF45", "ITF46", "ITF47", "ITF48",
        // Basilicata
        "ITF51", "ITF52",
        // Calabria
        "ITF61", "ITF62", "ITF63", "ITF64", "ITF65",
        // Sicily
        "ITG11", "ITG12", "ITG13", "ITG14", "ITG15", "ITG16", "ITG17", "ITG18", "ITG19",
      ],
    },
    {
      name: "Papal States (Lazio)",
      ids: ["ITI41", "ITI42", "ITI43", "ITI44", "ITI45"],
    },
    {
      name: "Sardinia-Piedmont",
      ids: [
        // Piemonte
        "ITC11", "ITC12", "ITC13", "ITC14", "ITC15", "ITC16", "ITC17", "ITC18",
        // Valle d'Aosta
        "ITC20",
        // Liguria
        "ITC31", "ITC32", "ITC33", "ITC34",
        // Sardinia
        "ITG2D", "ITG2E", "ITG2F", "ITG2G", "ITG2H",
      ],
    },
    {
      name: "Lombardy-Venetia",
      ids: [
        // Lombardia
        "ITC41", "ITC42", "ITC43", "ITC44", "ITC46", "ITC47", "ITC48", "ITC49",
        "ITC4A", "ITC4B", "ITC4C", "ITC4D",
        // Veneto
        "ITH31", "ITH32", "ITH33", "ITH34", "ITH35", "ITH36", "ITH37",
        // Friuli-Venezia Giulia
        "ITH41", "ITH42", "ITH43", "ITH44",
      ],
    },
    {
      name: "Grand Duchy of Tuscany",
      ids: [
        "ITI11", "ITI12", "ITI13", "ITI14", "ITI15", "ITI16", "ITI17", "ITI18", "ITI19", "ITI1A",
      ],
    },
  ],

  // UNITED KINGDOM - Historical
  UK: [
    {
      name: "Scotland",
      ids: [
        "UKM50", "UKM61", "UKM62", "UKM63", "UKM64", "UKM65", "UKM66", "UKM71", "UKM72",
        "UKM73", "UKM75", "UKM76", "UKM77", "UKM78", "UKM81", "UKM82", "UKM83", "UKM84",
        "UKM91", "UKM92", "UKM93", "UKM94", "UKM95",
      ],
    },
    {
      name: "Wales",
      ids: [
        "UKL11", "UKL12", "UKL13", "UKL14", "UKL15", "UKL16", "UKL17", "UKL18",
        "UKL21", "UKL22", "UKL23", "UKL24",
      ],
    },
    {
      name: "Northern Ireland",
      ids: [
        "UKN06", "UKN07", "UKN08", "UKN09", "UKN0A", "UKN0B", "UKN0C", "UKN0D", "UKN0E",
        "UKN0F", "UKN0G",
      ],
    },
  ],

  // RUSSIA - Historical & HOI4 (Approximate due to Oblast-level granularity)
  RU: [
    {
      name: "Moscow Region",
      ids: ["RUS-2364", "RUS-2365"],
    },
    {
      name: "St. Petersburg Region",
      ids: ["RUS-2336", "RUS-2337"],
    },
    {
      name: "TNO WRRF (Approximate)",
      ids: [
        "RUS-2333", "RUS-2334", "RUS-2335", "RUS-2336", "RUS-2337", "RUS-2342", "RUS-2343",
        "RUS-2353", "RUS-2354", "RUS-2355", "RUS-2356", "RUS-2358", "RUS-2359", "RUS-2360",
      ],
    },
    {
      name: "TNO Komi (Approximate)",
      ids: ["RUS-2383"],
    },
    {
      name: "Caucasus",
      ids: [
        "RUS-2279", "RUS-2280", "RUS-2303", "RUS-2304", "RUS-2305", "RUS-2306",
        "RUS-2371", "RUS-2416", "RUS-2417",
      ],
    },
  ],
};

const PRESET_STORAGE_KEY = "custom_presets";

const defaultZoom = globalThis.d3?.zoomIdentity || { k: 1, x: 0, y: 0 };

export {
  PALETTE_THEMES,
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,
  PRESET_STORAGE_KEY,
};

export const state = {
  locales: { ui: {}, geo: {} },
  geoAliasToStableKey: {},
  currentLanguage: globalThis.currentLanguage || "en",
  topology: null,
  topologyPrimary: null,
  topologyDetail: null,
  runtimePoliticalTopology: null,
  ruCityOverrides: null,
  topologyBundleMode: "single",
  renderProfile: "auto",
  detailDeferred: false,
  detailSourceRequested: "na_v2",
  detailPromotionInFlight: false,
  detailPromotionCompleted: false,
  landData: null,
  specialZonesData: null,
  specialZonesExternalData: null,
  specialZones: {},
  riversData: null,
  oceanData: null,
  oceanMaskMode: "topology_ocean",
  oceanMaskQuality: 1,
  landBgData: null,
  urbanData: null,
  physicalData: null,
  hierarchyData: null,
  hierarchyGroupsByCode: new Map(),
  countryGroupsData: null,
  countryGroupMetaByCode: new Map(),
  layerDataDiagnostics: {},
  contextLayerSourceByName: {},

  width: 0,
  height: 0,
  dpr: globalThis.devicePixelRatio || 1,

  // Resolved colors used by canvas render/legend.
  colors: {},
  // Country-level base colors (applies when no subdivision override exists).
  countryBaseColors: {},
  sovereignBaseColors: {},
  // Subdivision-level explicit color overrides keyed by feature ID.
  featureOverrides: {},
  visualOverrides: {},
  sovereigntyByFeatureId: {},
  sovereigntyInitialized: false,
  sovereigntyRevision: 0,
  dynamicBordersDirty: false,
  dynamicBordersDirtyReason: "",
  pendingDynamicBorderTimerId: null,
  ownerToFeatureIds: new Map(),
  runtimeFeatureIndexById: new Map(),
  runtimeFeatureIds: [],
  runtimeNeighborGraph: [],
  runtimeCanonicalCountryByFeatureId: {},
  paintMode: "visual",
  activeSovereignCode: "",
  sovereignContrastWarnings: [],
  // Click/paint granularity: subdivision | country.
  interactionGranularity: "subdivision",
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
  currentTool: "fill",
  hoveredId: null,
  zoomTransform: defaultZoom,
  showUrban: false,
  showPhysical: false,
  showRivers: true,
  showSpecialZones: false,
  manualSpecialZones: {
    type: "FeatureCollection",
    features: [],
  },
  specialZoneEditor: {
    active: false,
    vertices: [],
    zoneType: "custom",
    label: "",
    selectedId: null,
    counter: 1,
  },
  cachedBorders: null,
  cachedCountryBorders: null,
  cachedDynamicOwnerBorders: null,
  cachedProvinceBorders: null,
  cachedLocalBorders: null,
  cachedColorsHash: null,
  cachedDynamicBordersHash: null,
  cachedCoastlines: null,
  cachedCoastlinesHigh: null,
  cachedCoastlinesMid: null,
  cachedCoastlinesLow: null,
  cachedParentBordersByCountry: new Map(),
  cachedGridLines: null,
  parentBorderSupportedCountries: [],
  parentBorderEnabledByCountry: {},
  parentBorderMetaByCountry: {},
  parentGroupByFeatureId: new Map(),
  referenceImageUrl: null,
  referenceImageState: {
    opacity: 0.6,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  },
  styleConfig: {
    internalBorders: {
      color: "#cccccc",
      opacity: 1,
      width: 0.5,
    },
    empireBorders: {
      color: "#666666",
      width: 1.0,
    },
    coastlines: {
      color: "#333333",
      width: 1.2,
    },
    parentBorders: {
      color: "#4b5563",
      opacity: 0.85,
      width: 1.1,
    },
    ocean: {
      preset: "flat",
      fillColor: "#aadaff",
      opacity: 0.72,
      scale: 1,
      contourStrength: 0.75,
    },
    urban: {
      color: "#4b5563",
      opacity: 0.22,
      blendMode: "multiply",
      minAreaPx: 8,
    },
    physical: {
      preset: "atlas_soft",
      tintColor: "#8f6b4e",
      opacity: 0.24,
      contourColor: "#6f4e37",
      contourOpacity: 0.30,
      contourWidth: 0.7,
      contourSpacing: 18,
      blendMode: "multiply",
    },
    rivers: {
      color: "#3b82f6",
      opacity: 0.88,
      width: 0.5,
      outlineColor: "#e2efff",
      outlineWidth: 0.25,
      dashStyle: "solid",
    },
    specialZones: {
      disputedFill: "#f97316",
      disputedStroke: "#ea580c",
      wastelandFill: "#dc2626",
      wastelandStroke: "#b91c1c",
      customFill: "#8b5cf6",
      customStroke: "#6d28d9",
      opacity: 0.32,
      strokeWidth: 1.3,
      dashStyle: "dashed",
    },
  },
  recentColors: [],
  historyPast: [],
  historyFuture: [],
  historyMax: 80,
  updateRecentUI: null,
  updateHistoryUIFn: null,
  updateLegendUI: null,
  updateSwatchUIFn: null,
  updatePaletteSourceUIFn: null,
  updatePaletteLibraryUIFn: null,
  renderPaletteFn: null,
  updateToolUIFn: null,
  updateToolbarInputsFn: null,
  updatePaintModeUIFn: null,
  updateActiveSovereignUIFn: null,
  updateDynamicBorderStatusUIFn: null,
  updateZoomUIFn: null,
  updateParentBorderCountryListFn: null,
  updateSpecialZoneEditorUIFn: null,
  renderCountryListFn: null,
  renderPresetTreeFn: null,
  refreshColorStateFn: null,
  recomputeDynamicBordersNowFn: null,
  renderNowFn: null,
  showToastFn: null,
  isEditingPreset: false,
  editingPresetRef: null,
  editingPresetIds: new Set(),
  customPresets: {},
  presetsState: {},
  expandedPresetCountries: new Set(),

  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,

  landIndex: new Map(),
  countryToFeatureIds: new Map(),
  idToKey: new Map(),
  keyToId: new Map(),
  spatialIndex: null,
  spatialItems: [],
  spatialGrid: new Map(),
  spatialGridMeta: null,
  spatialItemsById: new Map(),

  TINY_AREA: 6,
  MOUSE_THROTTLE_MS: 16,
  lastMouseMoveTime: 0,
  hitCanvasDirty: true,
  zoomRenderScheduled: false,
  isInteracting: false,
  renderPhase: "idle",
  phaseEnteredAt: 0,
  renderPhaseTimerId: null,
  projectedBoundsById: new Map(),
  sphericalFeatureDiagnosticsById: new Map(),
};
