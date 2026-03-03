// Shared map logic helpers (Phase 13)
import { state, countryPalette, defaultCountryPalette } from "./state.js";
import { syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { refreshColorState, refreshResolvedColorsForOwners } from "./map_renderer.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
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
  state.sovereignBaseColors[target] = color;
  state.countryBaseColors[target] = color;
  refreshResolvedColorsForOwners([target], { renderNow: true });
}

function resetCountryColors() {
  const resolvedDefaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: true });
  Object.keys(countryPalette).forEach((code) => {
    delete countryPalette[code];
  });
  Object.keys(defaultCountryPalette).forEach((code) => {
    countryPalette[code] = defaultCountryPalette[code];
  });
  state.sovereignBaseColors = { ...resolvedDefaults };
  state.countryBaseColors = { ...resolvedDefaults };
  state.colors = {};
  state.visualOverrides = {};
  state.featureOverrides = {};
  refreshColorState({ renderNow: true });
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
