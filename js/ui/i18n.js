// Translation helpers (Phase 13)
import { state } from "../core/state.js";

function resolveGeoLocaleEntry(key) {
  const geoLocales = state.locales?.geo || {};
  if (geoLocales[key]) return geoLocales[key];

  const stableKey = state.geoAliasToStableKey?.[key];
  if (stableKey && geoLocales[stableKey]) {
    return geoLocales[stableKey];
  }
  return null;
}

function t(key, type = "geo") {
  if (!key) return "";
  const entry = type === "geo" ? resolveGeoLocaleEntry(key) : state.locales?.[type]?.[key];
  if (state.currentLanguage === "zh") {
    return entry?.zh || key;
  }
  if (type === "geo") {
    return entry?.en || key;
  }
  return key;
}

function updateUIText() {
  const uiMap = [
    ["lblCurrentTool", "Current Tool"],
    ["toolFillBtn", "Fill"],
    ["toolEraserBtn", "Eraser"],
    ["toolEyedropperBtn", "Eyedropper"],
    ["lblRecent", "Recent"],
    ["lblPalette", "Color Palette"],
    ["lblCustom", "Custom"],
    ["lblExport", "Export Map"],
    ["lblExportFormat", "Format"],
    ["exportBtn", "Download Snapshot"],
    ["lblTexture", "Texture"],
    ["lblOverlay", "Overlay"],
    ["lblMapStyle", "Map Style"],
    ["lblColorMode", "Color Mode"],
    ["optColorModeRegion", "By Region"],
    ["optColorModePolitical", "By Neighbor (Political)"],
    ["lblPaintGranularity", "Paint Granularity"],
    ["optPaintSubdivision", "By Subdivision"],
    ["optPaintCountry", "By Country"],
    ["labelPresetPolitical", "Auto-Fill Countries"],
    ["presetClear", "Clear Map"],
    ["lblCountrySearch", "Search Countries"],
    ["lblCountryColors", "Country Colors"],
    ["resetCountryColors", "Reset Country Colors"],
    ["lblSpecialZones", "Special Zones"],
    ["lblProjectManagement", "Project Management"],
    ["lblProjectHint", "Save or load your map state as a project file."],
    ["downloadProjectBtn", "Download Project"],
    ["uploadProjectBtn", "Load Project"],
    ["lblProjectFile", "Selected File"],
    ["lblLegendEditor", "Legend Editor"],
    ["lblLegendHint", "Paint regions to generate a legend."],
    ["debugOptionPROD", "Normal View"],
    ["debugOptionGEOMETRY", "1. Geometry Check (Pink/Green)"],
    ["debugOptionARTIFACTS", "2. Artifact Hunter (Red Giants)"],
    ["debugOptionISLANDS", "3. Island Detector (Orange)"],
    ["debugOptionID_HASH", "4. ID Stability"],
  ];

  uiMap.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = t(label, "ui");
    }
  });

  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }

  const searchInput = document.getElementById("countrySearch");
  if (searchInput) {
    searchInput.setAttribute("placeholder", t("Search...", "ui"));
  }

  const projectFileName = document.getElementById("projectFileName");
  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }
}

function toggleLanguage() {
  const nextLang = state.currentLanguage === "zh" ? "en" : "zh";
  state.currentLanguage = nextLang;
  try {
    localStorage.setItem("map_lang", nextLang);
  } catch (error) {
    console.warn("Unable to persist language preference:", error);
  }
  updateUIText();
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function initTranslations() {
  updateUIText();
}

function getTooltipText(feature) {
  if (!feature) return "";
  const rawName =
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    "Unknown Region";
  const name = t(rawName, "geo");
  const code = (feature?.properties?.cntr_code || "").toUpperCase();
  const label = state.currentLanguage === "zh" ? t("Region", "ui") : "Region";
  if (!name && !code) return label;
  if (code) return `${label}: ${name} (${code})`;
  return `${label}: ${name}`;
}

export { t, initTranslations, toggleLanguage, updateUIText, getTooltipText };
