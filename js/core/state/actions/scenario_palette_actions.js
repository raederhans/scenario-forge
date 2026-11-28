import { restoreScenarioFields, validateScenarioSnapshot } from "./scenario_snapshot.js";

// Canonical scenario palette state authority.
// Palette loading, UI synchronization, and scenario transaction ordering stay
// in scenario composition roots.

// Legend labels/config retain their existing palette authority when edited
// outside scenario activation. Absence preserves the current field.
export function patchLegendPaletteState(target, patch = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[scenario_palette_actions] target must be an object");
  }
  if (Object.hasOwn(patch, "legendLabels")) target.legendLabels = { ...patch.legendLabels };
  if (Object.hasOwn(patch, "legendConfig")) target.legendConfig = { ...patch.legendConfig };
}

export const SCENARIO_PALETTE_STATE_KEYS = Object.freeze([
  "activePaletteId",
  "activePaletteMeta",
  "activePalettePack",
  "activePaletteMap",
  "currentPaletteTheme",
  "activePaletteOceanMeta",
  "fixedPaletteColorsByIso2",
  "resolvedDefaultCountryPalette",
  "paletteLibraryEntries",
  "paletteQuickSwatches",
  "paletteLoadErrorById",
  "legendLabels",
  "legendConfig",
]);

const hasOwn = (target, key) =>
  Object.hasOwn(target, key);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[scenario_palette_actions] target must be an object");
  }
}

function validateCompletePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[scenario_palette_actions] patch must be an object");
  }
  for (const key of SCENARIO_PALETTE_STATE_KEYS) {
    if (!hasOwn(patch, key)) {
      throw new Error(
        `[scenario_palette_actions] commitScenarioPaletteState missing required key: ${key}`,
      );
    }
  }
}

function validateSnapshot(snapshot) {
  return validateScenarioSnapshot(snapshot, SCENARIO_PALETTE_STATE_KEYS,
    "scenario_palette_actions", "restoreScenarioPaletteState");
}

export function captureScenarioPaletteState(
  target,
  { clonePaletteLoadErrorById = (value) => value } = {},
) {
  assertStateTarget(target);
  if (typeof clonePaletteLoadErrorById !== "function") {
    throw new TypeError(
      "[scenario_palette_actions] clonePaletteLoadErrorById must be a function",
    );
  }
  const presentKeys = SCENARIO_PALETTE_STATE_KEYS.filter((key) =>
    hasOwn(target, key)
  );
  const values = {
    activePaletteId: target.activePaletteId,
    activePaletteMeta: target.activePaletteMeta,
    activePalettePack: target.activePalettePack,
    activePaletteMap: target.activePaletteMap,
    currentPaletteTheme: target.currentPaletteTheme,
    activePaletteOceanMeta: target.activePaletteOceanMeta,
    fixedPaletteColorsByIso2: target.fixedPaletteColorsByIso2,
    resolvedDefaultCountryPalette: target.resolvedDefaultCountryPalette,
    paletteLibraryEntries: target.paletteLibraryEntries,
    paletteQuickSwatches: target.paletteQuickSwatches,
    paletteLoadErrorById: clonePaletteLoadErrorById(
      target.paletteLoadErrorById,
    ),
    legendLabels: target.legendLabels,
    legendConfig: target.legendConfig,
  };
  return Object.freeze({
    values: Object.freeze(values),
    presentKeys: Object.freeze(presentKeys),
  });
}

export function commitScenarioPaletteState(target, patch) {
  assertStateTarget(target);
  validateCompletePatch(patch);
  target.activePaletteId = patch.activePaletteId;
  target.activePaletteMeta = patch.activePaletteMeta;
  target.activePalettePack = patch.activePalettePack;
  target.activePaletteMap = patch.activePaletteMap;
  target.currentPaletteTheme = patch.currentPaletteTheme;
  target.activePaletteOceanMeta = patch.activePaletteOceanMeta;
  target.fixedPaletteColorsByIso2 = patch.fixedPaletteColorsByIso2;
  target.resolvedDefaultCountryPalette =
    patch.resolvedDefaultCountryPalette;
  target.paletteLibraryEntries = patch.paletteLibraryEntries;
  target.paletteQuickSwatches = patch.paletteQuickSwatches;
  target.paletteLoadErrorById = patch.paletteLoadErrorById;
  target.legendLabels = patch.legendLabels;
  target.legendConfig = patch.legendConfig;
  return true;
}

export function restoreScenarioPaletteState(target, snapshot) {
  assertStateTarget(target);
  const { values, presentKeys } = validateSnapshot(snapshot);
  restoreScenarioFields(target, values, presentKeys, SCENARIO_PALETTE_STATE_KEYS);
  return true;
}
