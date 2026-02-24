// Shared map logic helpers (Phase 13)
import { state, countryPalette, defaultCountryPalette } from "./state.js";
import { refreshColorState } from "./map_renderer.js";

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
  state.countryBaseColors[target] = color;
  refreshColorState({ renderNow: true });
}

function resetCountryColors() {
  Object.keys(defaultCountryPalette).forEach((code) => {
    countryPalette[code] = defaultCountryPalette[code];
  });
  state.countryBaseColors = {};
  refreshColorState({ renderNow: true });
}

function applyPaletteToMap() {
  if (!state.landData) return;
  for (const feature of state.landData.features) {
    const code = getCountryCode(feature);
    const color = countryPalette[code];
    if (color) {
      state.countryBaseColors[code] = color;
    }
  }
  refreshColorState({ renderNow: true });
}

function saveMapState() {
  try {
    localStorage.setItem(
      "map_colors",
      JSON.stringify({
        schemaVersion: 2,
        countryBaseColors: state.countryBaseColors || {},
        featureOverrides: state.featureOverrides || {},
      })
    );
  } catch (error) {
    console.warn("Unable to save map state:", error);
  }
}

export { applyCountryColor, resetCountryColors, applyPaletteToMap, saveMapState };
