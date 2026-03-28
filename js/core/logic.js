// Shared map logic helpers (Phase 13)
import { state, countryPalette, defaultCountryPalette } from "./state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { refreshColorState, refreshResolvedColorsForOwners } from "./map_renderer.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import { markLegacyColorStateDirty } from "./sovereignty_manager.js";

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
  if (!state.landData) return;
  const target = normalizeCountryCode(code);
  if (!target) return;
  const before = captureHistoryState({
    ownerCodes: [target],
  });
  state.countryPalette[target] = color;
  state.sovereignBaseColors[target] = color;
  state.countryBaseColors[target] = color;
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
    ...Object.keys(state.sovereignBaseColors || {}),
    ...Object.keys(defaultCountryPalette || {}),
    ...Object.keys(state.scenarioFixedOwnerColors || {}),
    ...Object.keys(state.countryPalette || {}),
  ]));
  const featureIds = Object.keys(state.visualOverrides || {});
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
  state.sovereignBaseColors = {
    ...resolvedDefaults,
    ...(state.activeScenarioId ? state.scenarioFixedOwnerColors || {} : {}),
  };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.colors = {};
  state.visualOverrides = {};
  state.featureOverrides = {};
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
  if (!state.landData) return;
  const touchedOwners = new Set();
  for (const feature of state.landData.features) {
    const code = getCountryCode(feature);
    const color = countryPalette[code];
    if (color) {
      state.sovereignBaseColors[code] = color;
      state.countryBaseColors[code] = color;
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
        countryBaseColors: state.sovereignBaseColors || state.countryBaseColors || {},
        featureOverrides: state.visualOverrides || state.featureOverrides || {},
      })
    );
  } catch (error) {
    console.warn("Unable to save map state:", error);
  }
}

export { applyCountryColor, resetCountryColors, applyPaletteToMap, saveMapState };
