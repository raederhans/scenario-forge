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
  return PHYSICAL_MODE_ALIASES[raw] || "atlas_and_contours";
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
      mode: "atlas_and_contours",
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
    mode: "atlas_and_contours",
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

const LEGACY_URBAN_STYLE_DEFAULTS = Object.freeze({
  color: "#4b5563",
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
    adaptiveTintColor: "#f2dea1",
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
    markerDensity: 1,
    labelDensity: "balanced",
    color: "#2f343a",
    capitalColor: "#9f9072",
    opacity: 0.94,
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

const TRANSPORT_OVERVIEW_FAMILY_IDS = Object.freeze(["airport", "port", "rail", "road"]);
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
  const reach = clampUnitInterval(coverageReach, 0.5);
  switch (String(familyId || "").trim().toLowerCase()) {
    case "airport":
      if (reach >= 0.74) return { scope: "all_civil", importanceThreshold: "all" };
      if (reach >= 0.36) return { scope: "major_civil", importanceThreshold: "secondary" };
      return { scope: "international", importanceThreshold: "primary" };
    case "port":
      if (reach >= 0.74) return { scope: "expanded", importanceThreshold: "all" };
      if (reach >= 0.36) return { scope: "regional", importanceThreshold: "secondary" };
      return { scope: "core", importanceThreshold: "primary" };
    case "rail":
      if (reach >= 0.58) return { scope: "mainline_plus_regional", importanceThreshold: "secondary" };
      return { scope: "mainline_only", importanceThreshold: "primary" };
    case "road":
      if (reach >= 0.58) return { scope: "motorway_trunk", importanceThreshold: "secondary" };
      return { scope: "motorway_only", importanceThreshold: "primary" };
    default:
      return { scope: "default", importanceThreshold: "secondary" };
  }
}

function normalizeTransportOverviewScopeLinkMode(value, fallback = "linked") {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRANSPORT_OVERVIEW_SCOPE_LINK_MODES.includes(normalized)) return normalized;
  return TRANSPORT_OVERVIEW_SCOPE_LINK_MODES.includes(fallback) ? fallback : "linked";
}

function createDefaultTransportOverviewFamilyConfig(familyId) {
  const linked = resolveLinkedTransportOverviewScopeAndThreshold(familyId, familyId === "airport" || familyId === "port" ? 0.5 : 0.2);
  switch (String(familyId || "").trim().toLowerCase()) {
    case "airport":
      return {
        opacity: 0.82,
        visualStrength: 0.56,
        primaryColor: "#1d4ed8",
        labelsEnabled: true,
        labelDensity: "balanced",
        labelMode: "both",
        coverageReach: 0.5,
        scopeLinkMode: "linked",
        scope: linked.scope,
        importanceThreshold: linked.importanceThreshold,
      };
    case "port":
      return {
        opacity: 0.78,
        visualStrength: 0.54,
        primaryColor: "#b45309",
        labelsEnabled: true,
        labelDensity: "balanced",
        labelMode: "mixed",
        coverageReach: 0.5,
        scopeLinkMode: "linked",
        scope: linked.scope,
        importanceThreshold: linked.importanceThreshold,
      };
    case "rail":
      return {
        opacity: 0.72,
        visualStrength: 0.5,
        primaryColor: "#0f172a",
        labelsEnabled: false,
        labelDensity: "sparse",
        labelMode: "name",
        coverageReach: 0.2,
        scopeLinkMode: "linked",
        scope: linked.scope,
        importanceThreshold: linked.importanceThreshold,
      };
    case "road":
      return {
        opacity: 0.72,
        visualStrength: 0.5,
        primaryColor: "#374151",
        labelsEnabled: false,
        labelDensity: "sparse",
        labelMode: "ref",
        coverageReach: 0.2,
        scopeLinkMode: "linked",
        scope: linked.scope,
        importanceThreshold: linked.importanceThreshold,
      };
    default:
      return {
        opacity: 0.65,
        visualStrength: 0.5,
        labelsEnabled: false,
        labelDensity: "balanced",
        labelMode: "name",
        coverageReach: 0.5,
        scopeLinkMode: "linked",
        scope: "default",
        importanceThreshold: "secondary",
      };
  }
}

function normalizeTransportOverviewLabelDensity(value, fallback = "balanced") {
  const normalized = String(value || "").trim().toLowerCase();
  if (TRANSPORT_OVERVIEW_LABEL_DENSITIES.includes(normalized)) return normalized;
  return TRANSPORT_OVERVIEW_LABEL_DENSITIES.includes(fallback) ? fallback : "balanced";
}

function normalizeTransportOverviewPrimaryColor(value, fallback = "#1d4ed8") {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  const normalizedFallback = String(fallback || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(normalizedFallback)) return normalizedFallback.toLowerCase();
  return "#1d4ed8";
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
  return Object.fromEntries(
    TRANSPORT_OVERVIEW_FAMILY_IDS.map((familyId) => [
      familyId,
      createDefaultTransportOverviewFamilyConfig(familyId),
    ]),
  );
}

function normalizeTransportOverviewStyleConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return Object.fromEntries(
    TRANSPORT_OVERVIEW_FAMILY_IDS.map((familyId) => [
      familyId,
      normalizeTransportOverviewFamilyConfig(source[familyId], familyId),
    ]),
  );
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
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return String(fallback || "#475569").trim().toLowerCase();
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
    shadowOpacity: 0.28,
    twilightWidthDeg: 10,
    cityLightsEnabled: true,
    cityLightsStyle: "modern",
    cityLightsIntensity: 0.78,
    cityLightsTextureOpacity: 0.54,
    cityLightsCorridorStrength: 0.62,
    cityLightsCoreSharpness: 0.54,
    cityLightsPopulationBoostEnabled: true,
    cityLightsPopulationBoostStrength: 0.56,
    historicalCityLightsDensity: 1.25,
    historicalCityLightsSecondaryRetention: 0.55,
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

const TRANSPORT_WORKBENCH_FAMILY_IDS = Object.freeze([
  "road",
  "rail",
  "airport",
  "port",
  "mineral_resources",
  "energy_facilities",
  "industrial_zones",
  "logistics_hubs",
]);

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
      separationStrength: 0.65,
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
        0,
        1
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
function normalizeTransportWorkbenchUiState(rawUi) {
  const raw = rawUi && typeof rawUi === "object" ? rawUi : {};
  const rawPreviewCamera = raw.previewCamera && typeof raw.previewCamera === "object" ? raw.previewCamera : {};
  const familyConfigs = raw.familyConfigs && typeof raw.familyConfigs === "object" ? { ...raw.familyConfigs } : {};
  const sectionOpen = raw.sectionOpen && typeof raw.sectionOpen === "object" ? { ...raw.sectionOpen } : {};
  return {
    open: !!raw.open,
    activeFamily: raw.activeFamily === "layers" || TRANSPORT_WORKBENCH_FAMILY_IDS.includes(raw.activeFamily)
      ? raw.activeFamily
      : "road",
    activeInspectorTab: ["inspect", "display", "aggregation", "labels", "coverage", "data"].includes(String(raw.activeInspectorTab || "").trim().toLowerCase())
      ? String(raw.activeInspectorTab || "").trim().toLowerCase()
      : "inspect",
    sampleCountry: "Japan",
    previewMode: "bounded_zoom_pan",
    previewAssetId: "japan_carrier_v3",
    previewInteractionMode: "bounded_zoom_pan",
    previewCamera: {
      scale: toFiniteNumber(rawPreviewCamera.scale, 1) || 1,
      translateX: toFiniteNumber(rawPreviewCamera.translateX, 0),
      translateY: toFiniteNumber(rawPreviewCamera.translateY, 0),
    },
    compareHeld: !!raw.compareHeld,
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
  return Math.max(0, Math.min(200, Math.round(toFiniteNumber(value, fallback))));
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
  const previewLayerId = String(raw.previewLayerId || raw.previewSource || "background").trim().toLowerCase();
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
  MAP_SEMANTIC_MODES,
  countryNames,
  countryPresets,
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
  createDefaultTransportWorkbenchDisplayConfig,
  createDefaultTransportWorkbenchDisplayConfigs,
  normalizeTransportWorkbenchDisplayConfig,
  normalizeTransportWorkbenchDisplayConfigs,
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

export const state = {
  bootPhase: "shell",
  bootMessage: "Starting workspace…",
  bootProgress: 0,
  bootBlocking: true,
  bootPreviewVisible: false,
  bootError: "",
  bootCanContinueWithoutScenario: false,
  startupInteractionMode: "readonly",
  startupReadonly: false,
  startupReadonlyReason: "",
  setStartupReadonlyStateFn: null,
  startupReadonlyUnlockInFlight: false,
  startupReadonlySince: 0,
  interactionInfrastructureReady: true,
  interactionInfrastructureBuildInFlight: false,
  interactionInfrastructureStage: "idle",
  bootMetrics: {},
  startupBootCacheState: {
    enabled: false,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  },
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
  activeScenarioChunks: {
    scenarioId: "",
    loadedChunkIds: [],
    payloadByChunkId: {},
    mergedLayerPayloads: {},
    lruChunkIds: [],
  },
  runtimeChunkLoadState: {
    shellStatus: "idle",
    registryStatus: "idle",
    refreshScheduled: false,
    refreshTimerId: null,
    pendingReason: "",
    pendingDelayMs: null,
    pendingPromotion: null,
    inFlightByChunkId: {},
    errorByChunkId: {},
    lastSelection: null,
  },
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
  parentBordersVisible: true,
  scenarioParentBorderEnabledBeforeActivate: null,
  scenarioPaintModeBeforeActivate: null,
  scenarioOceanFillBeforeActivate: null,
  scenarioDisplaySettingsBeforeActivate: null,
  activeScenarioPerformanceHints: null,
  landData: null,
  landDataFull: null,
  activeScenarioMeshPack: null,
  specialZonesData: null,
  specialZonesExternalData: null,
  contextLayerExternalDataByName: {},
  contextLayerRevision: 0,
  contextLayerLoadStateByName: {
    rivers: "idle",
    urban: "idle",
    airports: "idle",
    ports: "idle",
    roads: "idle",
    road_labels: "idle",
    railways: "idle",
    rail_stations_major: "idle",
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
  scenarioWaterOverlayVersionTag: "",
  scenarioSpecialRegionsData: null,
  scenarioRuntimeTopologyData: null,
  scenarioRuntimeTopologyVersionTag: "",
  scenarioPoliticalChunkData: null,
  scenarioLandMaskData: null,
  scenarioContextLandMaskData: null,
  scenarioLandMaskVersionTag: "",
  scenarioContextLandMaskVersionTag: "",
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
  scenarioHydrationHealthGate: {
    status: "idle",
    reason: "",
    checkedAt: 0,
    attemptedRetry: false,
    ownerFeatureOverlapRatio: 1,
    ownerFeatureOverlapCount: 0,
    ownerFeatureRenderedCount: 0,
    degradedWaterOverlay: false,
  },
  riversData: null,
  airportsData: null,
  portsData: null,
  roadsData: null,
  roadLabelsData: null,
  railwaysData: null,
  railStationsMajorData: null,
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
  urbanLayerCapability: null,
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
  runtimePoliticalMetaSeed: null,
  runtimePoliticalMetaReadyFromWorker: false,
  getViewportGeoBoundsFn: null,
  scheduleScenarioChunkRefreshFn: null,
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
  allowOpenOceanSelect: false,
  allowOpenOceanPaint: false,
  showScenarioSpecialRegions: true,
  showScenarioReliefOverlays: true,
  showCityPoints: true,
  showUrban: true,
  showPhysical: true,
  showRivers: true,
  showTransport: true,
  showAirports: false,
  showPorts: false,
  showRail: false,
  showRoad: false,
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
    nationSource: "display",
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
    modalSection: "line",
    modalEntityId: "",
    modalEntityType: "",
    counterEditorModalOpen: false,
    counterCatalogSource: "internal",
    counterCatalogCategory: "all",
    counterCatalogQuery: "",
    hoi4CounterCategory: "all",
    hoi4CounterQuery: "",
    hoi4CounterVariant: "small",
  },
  transportWorkbenchUi: {
    open: false,
    activeFamily: "road",
    activeInspectorTab: "inspect",
    sampleCountry: "Japan",
    previewMode: "bounded_zoom_pan",
    previewAssetId: "japan_carrier_v3",
    previewInteractionMode: "bounded_zoom_pan",
    previewCamera: {
      scale: 1,
      translateX: 0,
      translateY: 0,
    },
    compareHeld: false,
    layerOrder: [
      "road",
      "rail",
      "airport",
      "port",
      "mineral_resources",
      "energy_facilities",
      "industrial_zones",
      "logistics_hubs",
    ],
    familyConfigs: {
      road: {},
      rail: {},
      airport: {},
      port: {},
      mineral_resources: {},
      energy_facilities: {},
      industrial_zones: {},
      logistics_hubs: {},
    },
    displayConfigs: createDefaultTransportWorkbenchDisplayConfigs(),
    sectionOpen: {
      road: {},
      rail: {},
      airport: {},
      port: {},
      mineral_resources: {},
      energy_facilities: {},
      industrial_zones: {},
      logistics_hubs: {},
    },
    shellPhase: "road-live-preview",
    restoreLeftDrawer: false,
    restoreRightDrawer: false,
  },
  exportWorkbenchUi: normalizeExportWorkbenchUiState(null),
  cachedBorders: null,
  cachedCountryBorders: null,
  cachedDynamicOwnerBorders: null,
  cachedScenarioOpeningOwnerBorders: null,
  cachedFrontlineMesh: null,
  cachedFrontlineMeshHash: "",
  cachedFrontlineLabelAnchors: [],
  cachedFrontlineLabelAnchorsHash: "",
  cachedProvinceBorders: null,
  cachedProvinceBordersByCountry: new Map(),
  cachedLocalBorders: null,
  cachedLocalBordersByCountry: new Map(),
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
      colorMode: "auto",
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
    urban: createDefaultUrbanStyleConfig(),
    physical: {
      ...createDefaultPhysicalStyleConfig(),
    },
    transportOverview: createDefaultTransportOverviewStyleConfig(),
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
  updateTransportAppearanceUIFn: null,
  updateFacilityInfoCardUiFn: null,
  syncFacilityInfoCardVisibilityFn: null,
  updateScenarioSpecialRegionUIFn: null,
  updateScenarioReliefOverlayUIFn: null,
  updateParentBorderCountryListFn: null,
  updateSpecialZoneEditorUIFn: null,
  updateStrategicOverlayUIFn: null,
  updateScenarioContextBarFn: null,
  triggerScenarioGuideFn: null,
  toggleLeftPanelFn: null,
  toggleRightPanelFn: null,
  openTransportWorkbenchFn: null,
  closeTransportWorkbenchFn: null,
  refreshTransportWorkbenchUiFn: null,
  toggleDockFn: null,
  toggleDeveloperModeFn: null,
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
  legacyColorStateDirty: true,
  expandedInspectorContinents: new Set(),
  expandedInspectorReleaseParents: new Set(),
  expandedPresetCountries: new Set(),
  ui: {
    dockCollapsed: false,
    scenarioBarCollapsed: false,
    scenarioGuideDismissed: false,
    tutorialEntryVisible: true,
    tutorialDismissed: false,
    politicalEditingExpanded: false,
    scenarioVisualAdjustmentsOpen: false,
    developerMode: false,
    devWorkspaceExpanded: false,
    devWorkspaceCategory: "selection",
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
  hitCanvasTopologyRevision: 0,
  deferHitCanvasBuild: false,
  hitCanvasBuildScheduled: null,
  stagedMapDataToken: 0,
  stagedContextBaseHandle: null,
  stagedHitCanvasHandle: null,
  deferContextBasePass: false,
  deferContextBaseEnhancements: false,
  deferExactAfterSettle: false,
  exactAfterSettleHandle: null,
  zoomRenderScheduled: false,
  pendingZoomTransform: null,
  zoomGestureStartTransform: null,
  zoomGestureScaleDelta: 0,
  zoomGestureEndedAt: 0,
  adaptiveSettleProfile: null,
  pendingExactPoliticalFastFrame: false,
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
