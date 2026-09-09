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
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("[scenario_palette_actions] snapshot must be an object");
  }
  const values = snapshot.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("[scenario_palette_actions] snapshot.values must be an object");
  }
  for (const key of SCENARIO_PALETTE_STATE_KEYS) {
    if (!hasOwn(values, key)) {
      throw new Error(
        `[scenario_palette_actions] restoreScenarioPaletteState missing snapshot key: ${key}`,
      );
    }
  }
  if (
    !Array.isArray(snapshot.presentKeys)
    && !(snapshot.presentKeys instanceof Set)
  ) {
    throw new TypeError(
      "[scenario_palette_actions] snapshot.presentKeys must be an array or Set",
    );
  }
  const presentKeys = Array.from(snapshot.presentKeys);
  const allowedKeys = new Set(SCENARIO_PALETTE_STATE_KEYS);
  for (const key of presentKeys) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `[scenario_palette_actions] restoreScenarioPaletteState contains unknown present key: ${key}`,
      );
    }
  }
  return { values, presentKeys: new Set(presentKeys) };
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
  if (presentKeys.has("activePaletteId")) {
    target.activePaletteId = values.activePaletteId;
  } else {
    delete target.activePaletteId;
  }
  if (presentKeys.has("activePaletteMeta")) {
    target.activePaletteMeta = values.activePaletteMeta;
  } else {
    delete target.activePaletteMeta;
  }
  if (presentKeys.has("activePalettePack")) {
    target.activePalettePack = values.activePalettePack;
  } else {
    delete target.activePalettePack;
  }
  if (presentKeys.has("activePaletteMap")) {
    target.activePaletteMap = values.activePaletteMap;
  } else {
    delete target.activePaletteMap;
  }
  if (presentKeys.has("currentPaletteTheme")) {
    target.currentPaletteTheme = values.currentPaletteTheme;
  } else {
    delete target.currentPaletteTheme;
  }
  if (presentKeys.has("activePaletteOceanMeta")) {
    target.activePaletteOceanMeta = values.activePaletteOceanMeta;
  } else {
    delete target.activePaletteOceanMeta;
  }
  if (presentKeys.has("fixedPaletteColorsByIso2")) {
    target.fixedPaletteColorsByIso2 = values.fixedPaletteColorsByIso2;
  } else {
    delete target.fixedPaletteColorsByIso2;
  }
  if (presentKeys.has("resolvedDefaultCountryPalette")) {
    target.resolvedDefaultCountryPalette =
      values.resolvedDefaultCountryPalette;
  } else {
    delete target.resolvedDefaultCountryPalette;
  }
  if (presentKeys.has("paletteLibraryEntries")) {
    target.paletteLibraryEntries = values.paletteLibraryEntries;
  } else {
    delete target.paletteLibraryEntries;
  }
  if (presentKeys.has("paletteQuickSwatches")) {
    target.paletteQuickSwatches = values.paletteQuickSwatches;
  } else {
    delete target.paletteQuickSwatches;
  }
  if (presentKeys.has("paletteLoadErrorById")) {
    target.paletteLoadErrorById = values.paletteLoadErrorById;
  } else {
    delete target.paletteLoadErrorById;
  }
  if (presentKeys.has("legendLabels")) {
    target.legendLabels = values.legendLabels;
  } else {
    delete target.legendLabels;
  }
  if (presentKeys.has("legendConfig")) {
    target.legendConfig = values.legendConfig;
  } else {
    delete target.legendConfig;
  }
  return true;
}
