// Shared map logic helpers (Phase 13)
import { state as runtimeState, countryPalette, defaultCountryPalette } from "./state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { refreshColorState, refreshResolvedColorsForOwners } from "./map_renderer.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { markLegacyColorStateDirty } from "./sovereignty_manager.js";
const state = runtimeState;

function normalizeCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function getCountryCode(feature) {
  const code =
    feature.properties?.cntr_code ||
    feature.properties?.CNTR_CODE ||
    feature.properties?.CNTR ||
    "";
  return normalizeCountryCode(code);
}

function applyCountryColor(code, color) {
  if (!runtimeState.landData) return;
  const target = normalizeCountryCode(code);
  if (!target) return;
  const before = captureHistoryState({
    ownerCodes: [target],
  });
  runtimeState.countryPalette[target] = color;
  runtimeState.sovereignBaseColors[target] = color;
  runtimeState.countryBaseColors[target] = color;
  markLegacyColorStateDirty();
  refreshResolvedColorsForOwners([target], { renderNow: true });
  pushHistoryEntry({
    kind: "inspector-country-color",
    before,
    after: captureHistoryState({
      ownerCodes: [target],
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
}

function resetCountryColors() {
  const ownerCodes = Array.from(new Set([
    ...Object.keys(runtimeState.sovereignBaseColors || {}),
    ...Object.keys(defaultCountryPalette || {}),
    ...Object.keys(runtimeState.scenarioFixedOwnerColors || {}),
    ...Object.keys(runtimeState.countryPalette || {}),
  ]));
  const featureIds = Object.keys(runtimeState.visualOverrides || {});
  const before = captureHistoryState({
    featureIds,
    ownerCodes,
  });
  const resolvedDefaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: true });
  Object.keys(countryPalette).forEach((code) => {
    delete countryPalette[code];
  });
  Object.keys(defaultCountryPalette).forEach((code) => {
    countryPalette[code] = defaultCountryPalette[code];
  });
  runtimeState.sovereignBaseColors = {
    ...resolvedDefaults,
    ...(runtimeState.activeScenarioId ? runtimeState.scenarioFixedOwnerColors || {} : {}),
  };
  runtimeState.countryBaseColors = { ...runtimeState.sovereignBaseColors };
  runtimeState.colors = {};
  runtimeState.visualOverrides = {};
  runtimeState.featureOverrides = {};
  markLegacyColorStateDirty();
  refreshColorState({ renderNow: true });
  pushHistoryEntry({
    kind: "reset-country-colors",
    before,
    after: captureHistoryState({
      featureIds,
      ownerCodes,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
}

function applyPaletteToMap() {
  if (!runtimeState.landData) return;
  const touchedOwners = new Set();
  for (const feature of runtimeState.landData.features) {
    const code = getCountryCode(feature);
    const color = countryPalette[code];
    if (color) {
      runtimeState.sovereignBaseColors[code] = color;
      runtimeState.countryBaseColors[code] = color;
      touchedOwners.add(code);
    }
  }
  if (touchedOwners.size > 0) {
    markLegacyColorStateDirty();
  }
  refreshResolvedColorsForOwners([...touchedOwners], { renderNow: true });
}

function saveMapState() {
  try {
    localStorage.setItem(
      "map_colors",
      JSON.stringify({
        schemaVersion: 2,
        countryBaseColors: runtimeState.sovereignBaseColors || runtimeState.countryBaseColors || {},
        featureOverrides: runtimeState.visualOverrides || runtimeState.featureOverrides || {},
      })
    );
  } catch (error) {
    console.warn("Unable to save map state:", error);
  }
}

export { applyCountryColor, resetCountryColors, applyPaletteToMap, saveMapState };

