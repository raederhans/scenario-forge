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
const MAP_SEMANTIC_MODES = new Set(["political", "blank"]);

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
    {
      name: "Alsace-Lorraine + Luxembourg",
      ids: [
        "FR_ARR_57003", "FR_ARR_57005", "FR_ARR_57006", "FR_ARR_57007", "FR_ARR_57009",
        "FR_ARR_67002", "FR_ARR_67003", "FR_ARR_67004", "FR_ARR_67005", "FR_ARR_67008",
        "FR_ARR_68001", "FR_ARR_68002", "FR_ARR_68004", "FR_ARR_68006",
        "LU_ADM1_LUX-906", "LU_ADM1_LUX-907", "LU_ADM1_LUX-908",
      ],
    },
    {
      name: "North Schleswig + Bornholm",
      ids: [
        "DK_HIST_NORTH_SCHLESWIG",
        "DK014",
      ],
    },
    {
      name: "Slovenia",
      ids: [
        "SI031", "SI032", "SI033", "SI034", "SI035", "SI036",
        "SI037", "SI038", "SI041", "SI042", "SI043", "SI044",
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
    {
      name: "French Occupation Strip (1940, Approx.)",
      ids: [
        "FR_ARR_06002",
      ],
    },
    {
      name: "Nice + Savoy",
      ids: [
        "FR_ARR_06002",
        "FR_ARR_73001", "FR_ARR_73002", "FR_ARR_73003",
        "FR_ARR_74001", "FR_ARR_74002", "FR_ARR_74003", "FR_ARR_74004",
      ],
    },
    {
      name: "Corsica",
      ids: [
        "FR_ARR_2A001", "FR_ARR_2A004", "FR_ARR_2B002", "FR_ARR_2B003", "FR_ARR_2B005",
      ],
    },
    {
      name: "Southeast France Expansion",
      ids: [
        "MC_ADMIN0_PASSTHROUGH",
        "FR_ARR_06001",
        "FR_ARR_04001", "FR_ARR_04002", "FR_ARR_04003", "FR_ARR_04004",
        "FR_ARR_05001", "FR_ARR_05002",
      ],
    },
    {
      name: "Albania",
      ids: [
        "AL011", "AL012", "AL013", "AL014", "AL015", "AL021",
        "AL022", "AL031", "AL032", "AL033", "AL034", "AL035",
      ],
    },
    {
      name: "Malta",
      ids: [
        "MT001", "MT002",
      ],
    },
    {
      name: "Cyprus",
      ids: [
        "CY000",
      ],
    },
    {
      name: "Dalmatia + Kotor Bay",
      ids: [
        "HR033", "HR034", "HR035", "HR037",
        "ME_ADM1_MNE-1506", "ME_ADM1_MNE-1507", "ME_ADM1_MNE-1518",
      ],
    },
    {
      name: "Italian Greek Islands",
      ids: [
        "GR_ADM1_GRC-2883", "GR_ADM1_GRC-2990", "GR_ADM1_GRC-3013",
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
const PHYSICAL_ATLAS_CLASS_KEYS = [
  "mountain_high_relief",
  "upland_plateau",
  "plains_lowlands",
  "wetlands_delta",
  "forest",
  "rainforest",
  "desert_bare",
  "tundra_ice",
];
const PHYSICAL_ATLAS_PALETTE = {
  mountain_high_relief: "#7a4a2a",
  upland_plateau: "#c4956a",
  plains_lowlands: "#8aad62",
  wetlands_delta: "#3d9e96",
  forest: "#3e6e28",
  rainforest: "#1a5c3e",
  desert_bare: "#dbb56a",
  tundra_ice: "#b8c8dc",
};

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
  return PHYSICAL_MODE_ALIASES[raw] || "atlas_and_contours";
}

function createDefaultPhysicalAtlasVisibility() {
  return Object.fromEntries(PHYSICAL_ATLAS_CLASS_KEYS.map((key) => [key, true]));
}

function createDefaultPhysicalStyleConfig() {
  return {
    mode: "atlas_and_contours",
    opacity: 0.5,
    atlasOpacity: 0.52,
    atlasIntensity: 0.9,
    atlasClassVisibility: createDefaultPhysicalAtlasVisibility(),
    rainforestEmphasis: 0.72,
    contourColor: "#6b5947",
    contourOpacity: 0.28,
    contourMajorWidth: 0.8,
    contourMinorWidth: 0.45,
    contourMajorIntervalM: 500,
    contourMinorIntervalM: 100,
    contourMinorVisible: true,
    contourLowReliefCutoffM: 300,
    blendMode: "soft-light",
  };
}

function normalizePhysicalStyleConfig(rawConfig) {
  const defaults = createDefaultPhysicalStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const legacyPreset = raw.preset;
  const hasNewPhysicalSchema = [
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
    mode: normalizePhysicalMode(raw.mode || legacyPreset),
    opacity: clamp(
      toFiniteNumber(hasNewPhysicalSchema ? (raw.opacity ?? raw.layerOpacity) : raw.layerOpacity, defaults.opacity),
      0,
      1
    ),
    atlasOpacity: clamp(toFiniteNumber(raw.atlasOpacity, atlasOpacityFallback), 0, 1),
    atlasIntensity: clamp(toFiniteNumber(raw.atlasIntensity, defaults.atlasIntensity), 0.2, 1.4),
    atlasClassVisibility: Object.fromEntries(
      PHYSICAL_ATLAS_CLASS_KEYS.map((key) => [key, rawVisibility[key] === undefined ? true : !!rawVisibility[key]])
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
    contourLowReliefCutoffM: clamp(
      Math.round(toFiniteNumber(raw.contourLowReliefCutoffM, defaults.contourLowReliefCutoffM)),
      0,
      2000
    ),
    blendMode: String(raw.blendMode || defaults.blendMode).trim() || defaults.blendMode,
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

function createDefaultCityLayerStyleConfig() {
  return {
    theme: "classic_graphite",
    revealProfile: "hybrid_country_budget",
    labelDensity: "balanced",
    color: "#2f343a",
    capitalColor: "#9f9072",
    opacity: 0.94,
    radius: 3.2,
    markerScale: 1,
    showLabels: true,
    labelSize: 11,
    labelMinZoom: 2.45,
    showCapitalOverlay: true,
    capitalScale: 1.6,
  };
}

const VALID_CITY_LAYER_THEMES = ["classic_graphite"];
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

  return {
    theme: VALID_CITY_LAYER_THEMES.includes(theme) ? theme : defaults.theme,
    revealProfile: VALID_CITY_LAYER_REVEAL_PROFILES.includes(revealProfile) ? revealProfile : defaults.revealProfile,
    labelDensity: VALID_CITY_LAYER_LABEL_DENSITIES.includes(labelDensity) ? labelDensity : defaults.labelDensity,
    color: color || defaults.color,
    capitalColor: capitalColor || defaults.capitalColor,
    opacity: clamp(toFiniteNumber(raw.opacity, defaults.opacity), 0, 1),
    radius: clamp(toFiniteNumber(raw.radius, defaults.radius), 1, 8),
    markerScale: clamp(toFiniteNumber(raw.markerScale, defaults.markerScale), 0.75, 1.4),
    showLabels: raw.showLabels === undefined ? defaults.showLabels : !!raw.showLabels,
    labelSize: clamp(Math.round(toFiniteNumber(raw.labelSize, defaults.labelSize)), 8, 24),
    labelMinZoom: clamp(toFiniteNumber(raw.labelMinZoom, defaults.labelMinZoom), 0.5, 8),
    showCapitalOverlay: raw.showCapitalOverlay === undefined
      ? defaults.showCapitalOverlay
      : !!raw.showCapitalOverlay,
    capitalScale: clamp(toFiniteNumber(raw.capitalScale, defaults.capitalScale), 1, 3.5),
  };
}

function createDefaultTextureStyleConfig() {
  return {
    mode: "none",
    opacity: 0.88,
    sphereClip: true,
    paper: {
      assetId: "paper_vintage_01",
      scale: 1,
      warmth: 0.62,
      grain: 0.34,
      wear: 0.26,
      vignette: 0.18,
      blendMode: "multiply",
    },
    graticule: {
      majorStep: 30,
      minorStep: 15,
      labelStep: 60,
      majorWidth: 1.0,
      minorWidth: 0.55,
      majorOpacity: 0.24,
      minorOpacity: 0.10,
      color: "#64748b",
      labelColor: "#475569",
      labelSize: 11,
    },
    draftGrid: {
      majorStep: 24,
      minorStep: 12,
      lonOffset: 0,
      latOffset: 12,
      roll: -18,
      width: 0.85,
      majorOpacity: 0.18,
      minorOpacity: 0.08,
      color: "#5c677d",
      dash: "dashed",
    },
  };
}

function normalizeTextureStyleConfig(rawConfig) {
  const defaults = createDefaultTextureStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawPaper = raw.paper && typeof raw.paper === "object" ? raw.paper : {};
  const rawGraticule = raw.graticule && typeof raw.graticule === "object" ? raw.graticule : {};
  const rawDraftGrid = raw.draftGrid && typeof raw.draftGrid === "object" ? raw.draftGrid : {};

  const majorStep = clamp(Math.round(toFiniteNumber(rawGraticule.majorStep, defaults.graticule.majorStep)), 10, 90);
  const minorStep = clamp(Math.round(toFiniteNumber(rawGraticule.minorStep, defaults.graticule.minorStep)), 5, majorStep);
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
      color: String(rawGraticule.color || defaults.graticule.color).trim() || defaults.graticule.color,
      labelColor: String(rawGraticule.labelColor || defaults.graticule.labelColor).trim() || defaults.graticule.labelColor,
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
      color: String(rawDraftGrid.color || defaults.draftGrid.color).trim() || defaults.draftGrid.color,
      dash: dash === "solid" || dash === "dotted" ? dash : defaults.draftGrid.dash,
    },
  };
}

function createDefaultDayNightStyleConfig() {
  return {
    enabled: false,
    mode: "manual",
    manualUtcMinutes: 12 * 60,
    shadowOpacity: 0.28,
    twilightWidthDeg: 10,
    cityLightsEnabled: true,
    cityLightsStyle: "modern",
    cityLightsIntensity: 0.72,
    cityLightsTextureOpacity: 0.54,
    cityLightsCorridorStrength: 0.58,
    cityLightsCoreSharpness: 0.62,
  };
}

function normalizeDayNightStyleConfig(rawConfig) {
  const defaults = createDefaultDayNightStyleConfig();
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const mode = String(raw.mode || defaults.mode).trim().toLowerCase();
  const cityLightsStyle = String(raw.cityLightsStyle || defaults.cityLightsStyle).trim().toLowerCase();

  return {
    enabled: raw.enabled === undefined ? defaults.enabled : !!raw.enabled,
    mode: mode === "utc" ? "utc" : "manual",
    manualUtcMinutes: clamp(
      Math.round(toFiniteNumber(raw.manualUtcMinutes, defaults.manualUtcMinutes)),
      0,
      24 * 60 - 1
    ),
    shadowOpacity: clamp(toFiniteNumber(raw.shadowOpacity, defaults.shadowOpacity), 0, 0.85),
    twilightWidthDeg: clamp(Math.round(toFiniteNumber(raw.twilightWidthDeg, defaults.twilightWidthDeg)), 2, 28),
    cityLightsEnabled: raw.cityLightsEnabled === undefined ? defaults.cityLightsEnabled : !!raw.cityLightsEnabled,
    cityLightsStyle: cityLightsStyle === "historical_1930s" ? "historical_1930s" : "modern",
    cityLightsIntensity: clamp(toFiniteNumber(raw.cityLightsIntensity, defaults.cityLightsIntensity), 0, 1.2),
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
  };
}

function createDefaultAnnotationView() {
  return {
    frontlineEnabled: false,
    frontlineStyle: "clean",
    showFrontlineLabels: false,
    labelPlacementMode: "midpoint",
    unitRendererDefault: "game",
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
    showUnitLabels: raw.showUnitLabels === undefined ? defaults.showUnitLabels : !!raw.showUnitLabels,
  };
}

export {
  PALETTE_THEMES,
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  MAP_SEMANTIC_MODES,
  countryNames,
  countryPresets,
  PHYSICAL_ATLAS_CLASS_KEYS,
  PHYSICAL_ATLAS_PALETTE,
  createDefaultPhysicalStyleConfig,
  createDefaultPhysicalAtlasVisibility,
  normalizePhysicalMode,
  normalizePhysicalStyleConfig,
  createDefaultLakeStyleConfig,
  normalizeLakeStyleConfig,
  createDefaultCityLayerStyleConfig,
  normalizeCityLayerStyleConfig,
  PRESET_STORAGE_KEY,
  createDefaultTextureStyleConfig,
  normalizeTextureMode,
  normalizeTextureStyleConfig,
  createDefaultDayNightStyleConfig,
  normalizeDayNightStyleConfig,
  createDefaultAnnotationView,
  normalizeAnnotationView,
};

export function normalizeMapSemanticMode(value, fallback = "political") {
  const normalized = String(value || "").trim().toLowerCase();
  if (MAP_SEMANTIC_MODES.has(normalized)) {
    return normalized;
  }
  return MAP_SEMANTIC_MODES.has(fallback) ? fallback : "political";
}

export const state = {
  bootPhase: "shell",
  bootMessage: "Starting workspace…",
  bootProgress: 0,
  bootBlocking: true,
  bootError: "",
  bootCanContinueWithoutScenario: false,
  bootMetrics: {},
  locales: { ui: {}, geo: {} },
  baseLocalizationLevel: "full",
  baseLocalizationDataState: "idle",
  baseLocalizationDataError: "",
  baseLocalizationDataPromise: null,
  baseGeoLocales: {},
  geoAliasToStableKey: {},
  baseGeoAliasToStableKey: {},
  currentLanguage: globalThis.currentLanguage || "en",
  topology: null,
  topologyPrimary: null,
  topologyDetail: null,
  runtimePoliticalTopology: null,
  defaultRuntimePoliticalTopology: null,
  ruCityOverrides: null,
  topologyBundleMode: "single",
  renderProfile: "auto",
  detailDeferred: false,
  detailSourceRequested: "na_v2",
  detailPromotionInFlight: false,
  detailPromotionCompleted: false,
  scenarioApplyInFlight: false,
  scenarioRegistry: null,
  scenarioBundleCacheById: {},
  activeScenarioId: "",
  scenarioBorderMode: "canonical",
  scenarioViewMode: "ownership",
  activeScenarioManifest: null,
  scenarioCountriesByTag: {},
  scenarioFixedOwnerColors: {},
  defaultReleasableCatalog: null,
  releasableCatalog: null,
  scenarioReleasableIndex: {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  },
  defaultReleasablePresetOverlays: {},
  scenarioReleasablePresetOverlays: {},
  releasableBoundaryVariantByTag: {},
  scenarioAudit: null,
  scenarioAuditUi: {
    loading: false,
    loadedForScenarioId: "",
    errorMessage: "",
  },
  scenarioBaselineHash: "",
  scenarioBaselineOwnersByFeatureId: {},
  scenarioControllersByFeatureId: {},
  scenarioAutoShellOwnerByFeatureId: {},
  scenarioAutoShellControllerByFeatureId: {},
  scenarioShellOverlayRevision: 0,
  scenarioBaselineControllersByFeatureId: {},
  scenarioBaselineCoresByFeatureId: {},
  scenarioControllerRevision: 0,
  scenarioReliefOverlayRevision: 0,
  scenarioOwnerControllerDiffCount: 0,
  scenarioDataHealth: {
    expectedFeatureCount: 0,
    runtimeFeatureCount: 0,
    ratio: 1,
    minRatio: 0.7,
    warning: "",
    severity: "",
  },
  scenarioParentBorderEnabledBeforeActivate: null,
  scenarioPaintModeBeforeActivate: null,
  scenarioOceanFillBeforeActivate: null,
  scenarioDisplaySettingsBeforeActivate: null,
  activeScenarioPerformanceHints: null,
  landData: null,
  landDataFull: null,
  specialZonesData: null,
  specialZonesExternalData: null,
  contextLayerExternalDataByName: {},
  contextLayerRevision: 0,
  contextLayerLoadStateByName: {
    rivers: "idle",
    urban: "idle",
    physical: "idle",
    physical_semantics: "idle",
    physical_contours_major: "idle",
    physical_contours_minor: "idle",
  },
  contextLayerLoadErrorByName: {},
  contextLayerLoadPromiseByName: {},
  specialZones: {},
  waterRegionsData: null,
  scenarioWaterRegionsData: null,
  scenarioSpecialRegionsData: null,
  scenarioRuntimeTopologyData: null,
  scenarioLandMaskData: null,
  scenarioContextLandMaskData: null,
  scenarioReliefOverlaysData: null,
  scenarioBathymetryTopologyData: null,
  scenarioBathymetryBandsData: null,
  scenarioBathymetryContoursData: null,
  scenarioBathymetryTopologyUrl: "",
  scenarioDistrictGroupsData: null,
  scenarioDistrictGroupByFeatureId: new Map(),
  scenarioDistrictSharedTemplatesData: null,
  scenarioGeoLocalePatchData: null,
  scenarioCityOverridesData: null,
  riversData: null,
  oceanData: null,
  globalBathymetryTopologyData: null,
  globalBathymetryBandsData: null,
  globalBathymetryContoursData: null,
  globalBathymetryTopologyUrl: "",
  activeBathymetryBandsData: null,
  activeBathymetryContoursData: null,
  activeBathymetrySource: "none",
  activeBathymetryTopologyUrl: "",
  oceanMaskMode: "topology_ocean",
  oceanMaskQuality: 1,
  landBgData: null,
  urbanData: null,
  worldCitiesData: null,
  baseCityAliasesData: null,
  baseCityDataState: "idle",
  baseCityDataError: "",
  baseCityDataPromise: null,
  physicalData: null,
  physicalSemanticsData: null,
  physicalContourMajorData: null,
  physicalContourMinorData: null,
  hierarchyData: null,
  hierarchyGroupsByCode: new Map(),
  countryGroupsData: null,
  countryGroupMetaByCode: new Map(),
  countryInteractionPoliciesByCode: new Map(),
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
  paintMode: "visual",
  activeSovereignCode: "",
  sovereignContrastWarnings: [],
  // Click/paint granularity: subdivision | country.
  interactionGranularity: "subdivision",
  // Double-click quick-fill scope: parent | country.
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
  activeDockPopover: "",
  isDirty: false,
  dirtyRevision: 0,
  onboardingDismissed: false,
  hoveredId: null,
  hoveredWaterRegionId: null,
  hoveredSpecialRegionId: null,
  devHoverHit: null,
  devSelectedHit: null,
  devSelectionFeatureIds: new Set(),
  devSelectionOrder: [],
  devSelectionModeEnabled: false,
  devSelectionLimit: 200,
  devSelectionOverlayDirty: true,
  devSelectionSortMode: "selection",
  devClipboardPreviewFormat: "names_with_ids",
  devClipboardFallbackText: "",
  devRuntimeMeta: null,
  devRuntimeMetaError: "",
  devScenarioEditor: {
    targetOwnerCode: "",
    isSaving: false,
    lastSavedAt: "",
    lastSavedPath: "",
    lastSaveMessage: "",
    lastSaveTone: "",
  },
  devScenarioTagCreator: {
    tag: "",
    nameEn: "",
    nameZh: "",
    colorHex: "#5D7CBA",
    parentOwnerTag: "",
    selectedInspectorGroupId: "",
    inspectorGroupId: "",
    inspectorGroupLabel: "",
    inspectorGroupAnchorId: "",
    duplicateTag: false,
    tagLengthHint: "",
    isColorPopoverOpen: false,
    recentColors: [],
    recentColorsLoaded: false,
    isSaving: false,
    lastSavedAt: "",
    lastSavedPath: "",
    lastSaveMessage: "",
    lastSaveTone: "",
  },
  devScenarioCountryEditor: {
    tag: "",
    nameEn: "",
    nameZh: "",
    isSaving: false,
    lastSavedAt: "",
    lastSavedPath: "",
    lastSaveMessage: "",
    lastSaveTone: "",
  },
  devScenarioTagInspector: {
    threshold: 3,
    selectedTag: "",
  },
  devScenarioCapitalEditor: {
    tag: "",
    searchQuery: "",
    isSaving: false,
    lastSavedAt: "",
    lastSavedPath: "",
    lastSaveMessage: "",
    lastSaveTone: "",
  },
  devLocaleEditor: {
    featureId: "",
    en: "",
    zh: "",
    isSaving: false,
    lastSavedAt: "",
    lastSavedPath: "",
  },
  devScenarioDistrictEditor: {
    tag: "",
    tagMode: "auto",
    manualTag: "",
    inferredTag: "",
    templateTag: "",
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
    loadedScenarioId: "",
    loadedTag: "",
    draftTag: null,
    isSaving: false,
    isTemplateSaving: false,
    isTemplateApplying: false,
    lastSavedAt: "",
    lastSavedPath: "",
    lastSaveMessage: "",
    lastSaveTone: "",
  },
  hoverOverlayDirty: true,
  inspectorOverlayDirty: true,
  specialZonesOverlayDirty: true,
  frontlineOverlayDirty: true,
  operationalLinesDirty: true,
  operationGraphicsDirty: true,
  unitCountersDirty: true,
  tooltipRafHandle: null,
  tooltipPendingState: null,
  selectedWaterRegionId: "",
  selectedSpecialRegionId: "",
  zoomTransform: defaultZoom,
  showWaterRegions: true,
  showOpenOceanRegions: false,
  showScenarioSpecialRegions: true,
  showScenarioReliefOverlays: true,
  showCityPoints: true,
  showUrban: true,
  showPhysical: true,
  showRivers: true,
  showSpecialZones: false,
  cityLayerRevision: 0,
  manualSpecialZones: {
    type: "FeatureCollection",
    features: [],
  },
  annotationView: createDefaultAnnotationView(),
  operationalLines: [],
  operationGraphics: [],
  unitCounters: [],
  specialZoneEditor: {
    active: false,
    vertices: [],
    zoneType: "custom",
    label: "",
    selectedId: null,
    counter: 1,
  },
  operationGraphicsEditor: {
    active: false,
    mode: "idle",
    collection: "operationGraphics",
    points: [],
    kind: "attack",
    label: "",
    stylePreset: "attack",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  },
  unitCounterEditor: {
    active: false,
    renderer: "game",
    label: "",
    sidc: "",
    symbolCode: "",
    nationTag: "",
    nationSource: "controller",
    presetId: "",
    unitType: "",
    echelon: "",
    subLabel: "",
    strengthText: "",
    baseFillColor: "",
    organizationPct: 78,
    equipmentPct: 74,
    statsPresetId: "regular",
    statsSource: "preset",
    size: "medium",
    selectedId: null,
    counter: 1,
  },
  operationalLineEditor: {
    active: false,
    mode: "idle",
    points: [],
    kind: "frontline",
    label: "",
    stylePreset: "frontline",
    stroke: "",
    width: 0,
    opacity: 1,
    selectedId: null,
    selectedVertexIndex: -1,
    counter: 1,
  },
  strategicOverlayUi: {
    activeMode: "idle",
    modalOpen: false,
    modalSection: "counter",
    modalEntityId: "",
    modalEntityType: "",
  },
  cachedBorders: null,
  cachedCountryBorders: null,
  cachedDynamicOwnerBorders: null,
  cachedScenarioOpeningOwnerBorders: null,
  cachedFrontlineMesh: null,
  cachedFrontlineMeshHash: "",
  cachedFrontlineLabelAnchors: [],
  cachedProvinceBorders: null,
  cachedLocalBorders: null,
  cachedDetailAdmBorders: null,
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
      experimentalAdvancedStyles: false,
      coastalAccentEnabled: true,
      shallowBandFadeEndZoom: 2.8,
      midBandFadeEndZoom: 3.4,
      deepBandFadeEndZoom: 4.2,
      scenarioSyntheticContourFadeEndZoom: 3.0,
      scenarioShallowContourFadeEndZoom: 3.4,
    },
    lakes: createDefaultLakeStyleConfig(),
    cityPoints: {
      ...createDefaultCityLayerStyleConfig(),
    },
    urban: {
      color: "#4b5563",
      opacity: 0.4,
      blendMode: "multiply",
      minAreaPx: 8,
    },
    physical: {
      ...createDefaultPhysicalStyleConfig(),
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
    texture: createDefaultTextureStyleConfig(),
    dayNight: createDefaultDayNightStyleConfig(),
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
  updateScenarioUIFn: null,
  renderPaletteFn: null,
  updateToolUIFn: null,
  updateToolbarInputsFn: null,
  updatePaintModeUIFn: null,
  updateActiveSovereignUIFn: null,
  updateDynamicBorderStatusUIFn: null,
  updateZoomUIFn: null,
  updateTextureUIFn: null,
  updateWaterInteractionUIFn: null,
  updateScenarioSpecialRegionUIFn: null,
  updateScenarioReliefOverlayUIFn: null,
  updateParentBorderCountryListFn: null,
  updateSpecialZoneEditorUIFn: null,
  updateStrategicOverlayUIFn: null,
  updateScenarioContextBarFn: null,
  triggerScenarioGuideFn: null,
  persistViewSettingsFn: null,
  ensureBaseCityDataFn: null,
  ensureContextLayerDataFn: null,
  renderCountryListFn: null,
  refreshCountryListRowsFn: null,
  refreshCountryInspectorDetailFn: null,
  renderWaterRegionListFn: null,
  renderSpecialRegionListFn: null,
  renderPresetTreeFn: null,
  renderScenarioAuditPanelFn: null,
  updateDevWorkspaceUIFn: null,
  refreshColorStateFn: null,
  recomputeDynamicBordersNowFn: null,
  ensureDetailTopologyFn: null,
  renderNowFn: null,
  showToastFn: null,
  isEditingPreset: false,
  editingPresetRef: null,
  editingPresetIds: new Set(),
  customPresets: {},
  presetsState: {},
  expandedInspectorContinents: new Set(),
  expandedInspectorReleaseParents: new Set(),
  expandedPresetCountries: new Set(),
  ui: {
    dockCollapsed: false,
    scenarioBarCollapsed: false,
    scenarioGuideDismissed: false,
    politicalEditingExpanded: false,
    scenarioVisualAdjustmentsOpen: false,
    devWorkspaceExpanded: false,
    rightSidebarTab: "inspector",
  },

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
  waterRegionsById: new Map(),
  specialRegionsById: new Map(),
  waterSpatialIndex: null,
  waterSpatialItems: [],
  waterSpatialGrid: new Map(),
  waterSpatialGridMeta: null,
  waterSpatialItemsById: new Map(),
  specialSpatialIndex: null,
  specialSpatialItems: [],
  specialSpatialGrid: new Map(),
  specialSpatialGridMeta: null,
  specialSpatialItemsById: new Map(),

  TINY_AREA: 6,
  MOUSE_THROTTLE_MS: 16,
  lastMouseMoveTime: 0,
  hitCanvasDirty: true,
  deferHitCanvasBuild: false,
  hitCanvasBuildScheduled: null,
  stagedMapDataToken: 0,
  stagedContextBaseHandle: null,
  stagedHitCanvasHandle: null,
  deferContextBasePass: false,
  deferExactAfterSettle: false,
  exactAfterSettleHandle: null,
  zoomRenderScheduled: false,
  isInteracting: false,
  renderPhase: "idle",
  phaseEnteredAt: 0,
  renderPhaseTimerId: null,
  pendingDayNightRefresh: false,
  colorRevision: 0,
  topologyRevision: 0,
  renderPassCache: {
    referenceTransform: null,
    referenceTransforms: {},
    canvases: {},
    layouts: {},
    signatures: {},
    borderSnapshot: {
      canvas: null,
      layout: null,
      referenceTransform: null,
      valid: false,
      reason: "init",
    },
    partialPoliticalDirtyIds: new Set(),
    politicalPathCache: new Map(),
    politicalPathCacheSignature: "",
    politicalPathCacheTransform: null,
    politicalPathWarmupQueue: [],
    politicalPathWarmupHandle: null,
    politicalPathWarmupSignature: "",
    dirty: {
      background: true,
      political: true,
      effects: true,
      contextBase: true,
      contextScenario: true,
      dayNight: true,
      borders: true,
    },
    reasons: {
      background: "init",
      political: "init",
      effects: "init",
      contextBase: "init",
      contextScenario: "init",
      dayNight: "init",
      borders: "init",
    },
    counters: {
      frames: 0,
      composites: 0,
      transformedFrames: 0,
      drawCanvas: 0,
      backgroundPassRenders: 0,
      politicalPassRenders: 0,
      effectsPassRenders: 0,
      contextPassRenders: 0,
      contextBasePassRenders: 0,
      contextScenarioPassRenders: 0,
      dayNightPassRenders: 0,
      borderPassRenders: 0,
      borderSnapshotRenders: 0,
      borderSnapshotReuses: 0,
      labelPassRenders: 0,
      hitCanvasRenders: 0,
      dynamicBorderRebuilds: 0,
      politicalPartialRepaints: 0,
      politicalPartialFallbacks: 0,
      politicalPartialCandidateCount: 0,
      politicalPartialPathCacheMisses: 0,
      politicalPartialPathBuild: 0,
      politicalPathCacheBuild: 0,
      politicalPathWarmupBuild: 0,
      politicalPathWarmupSlices: 0,
      politicalPathWarmupCancels: 0,
    },
    lastFrame: null,
    lastAction: "",
    lastActionDurationMs: 0,
    lastActionAt: 0,
    perfOverlayEnabled: false,
    overlayElement: null,
  },
  sidebarPerf: {
    counters: {
      fullListRenders: 0,
      rowRefreshes: 0,
      inspectorRenders: 0,
      presetTreeRenders: 0,
      legendRenders: 0,
    },
  },
  projectedBoundsById: new Map(),
  sphericalFeatureDiagnosticsById: new Map(),
};
