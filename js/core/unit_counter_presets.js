const DEFAULT_UNIT_COUNTER_PRESET_ID = "inf";

const UNIT_COUNTER_PRESETS = Object.freeze([
  {
    id: "inf",
    label: "Infantry",
    shortCode: "INF",
    iconId: "infantry",
    defaultRenderer: "milstd",
    baseSidc: "130310001412110000000000000000",
    shellVariant: "line",
    defaultEchelon: "div",
    unitType: "INF",
  },
  {
    id: "mot",
    label: "Motorized",
    shortCode: "MOT",
    iconId: "motorized",
    defaultRenderer: "game",
    baseSidc: "130310001512110000000000000000",
    shellVariant: "line",
    defaultEchelon: "div",
    unitType: "MOT",
  },
  {
    id: "mech",
    label: "Mechanized",
    shortCode: "MECH",
    iconId: "mechanized",
    defaultRenderer: "milstd",
    baseSidc: "130310001612110000000000000000",
    shellVariant: "line",
    defaultEchelon: "div",
    unitType: "MECH",
  },
  {
    id: "arm",
    label: "Armored",
    shortCode: "ARM",
    iconId: "armor",
    defaultRenderer: "milstd",
    baseSidc: "130310001712110000000000000000",
    shellVariant: "assault",
    defaultEchelon: "div",
    unitType: "ARM",
  },
  {
    id: "art",
    label: "Artillery",
    shortCode: "ART",
    iconId: "artillery",
    defaultRenderer: "milstd",
    baseSidc: "130320000000000000000000000000",
    shellVariant: "support",
    defaultEchelon: "reg",
    unitType: "ART",
  },
  {
    id: "hq",
    label: "Headquarters",
    shortCode: "HQ",
    iconId: "hq",
    defaultRenderer: "game",
    baseSidc: "100310001712110000000000000000",
    shellVariant: "command",
    defaultEchelon: "army",
    unitType: "HQ",
  },
  {
    id: "gar",
    label: "Garrison",
    shortCode: "GAR",
    iconId: "garrison",
    defaultRenderer: "game",
    baseSidc: "130310001412110000000000000000",
    shellVariant: "support",
    defaultEchelon: "bde",
    unitType: "GAR",
  },
  {
    id: "air",
    label: "Air Wing",
    shortCode: "AIR",
    iconId: "air",
    defaultRenderer: "game",
    baseSidc: "130300000000000000000000000000",
    shellVariant: "air",
    defaultEchelon: "wing",
    unitType: "AIR",
  },
  {
    id: "naval",
    label: "Naval Group",
    shortCode: "NAV",
    iconId: "naval",
    defaultRenderer: "game",
    baseSidc: "120100000000000000000000000000",
    shellVariant: "naval",
    defaultEchelon: "taskforce",
    unitType: "NAVAL",
  },
]);

const UNIT_COUNTER_ECHELONS = Object.freeze([
  ["", "Auto"],
  ["bn", "Battalion"],
  ["reg", "Regiment"],
  ["bde", "Brigade"],
  ["div", "Division"],
  ["corps", "Corps"],
  ["army", "Army"],
  ["wing", "Wing"],
  ["taskforce", "Task Force"],
]);

const UNIT_COUNTER_SCREEN_SIZE = Object.freeze({
  small: Object.freeze({ width: 24, height: 15, symbolBox: 9, scale: 1 }),
  medium: Object.freeze({ width: 28, height: 18, symbolBox: 10, scale: 1 }),
  large: Object.freeze({ width: 34, height: 22, symbolBox: 12, scale: 1 }),
});

function normalizeUnitCounterSizeToken(value) {
  const token = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UNIT_COUNTER_SCREEN_SIZE, token) ? token : "medium";
}

function getUnitCounterPresetById(presetId) {
  const normalizedId = String(presetId || "").trim().toLowerCase();
  return UNIT_COUNTER_PRESETS.find((preset) => preset.id === normalizedId) || UNIT_COUNTER_PRESETS[0];
}

function getUnitCounterEchelonLabel(echelon) {
  const normalized = String(echelon || "").trim().toLowerCase();
  const match = UNIT_COUNTER_ECHELONS.find(([value]) => value === normalized);
  return match ? match[1] : "";
}

export {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  UNIT_COUNTER_PRESETS,
  UNIT_COUNTER_ECHELONS,
  UNIT_COUNTER_SCREEN_SIZE,
  normalizeUnitCounterSizeToken,
  getUnitCounterPresetById,
  getUnitCounterEchelonLabel,
};
