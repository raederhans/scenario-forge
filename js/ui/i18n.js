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
    ["lblPaletteSearch", "Search Colors"],
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
    ["lblPaintMeaning", "Paint Meaning"],
    ["labelActiveSovereign", "Active Sovereign"],
    ["optPaintMeaningVisual", "Visual"],
    ["optPaintMeaningSovereignty", "Sovereignty"],
    ["activeSovereignLabel", "None selected"],
    ["recalculateBordersBtn", "Recalculate Borders"],
    ["dynamicBorderStatus", "Borders up to date"],
    ["lblOcean", "Ocean"],
    ["lblOceanFillColor", "Fill Color"],
    ["lblOceanStyle", "Style"],
    ["optOceanFlat", "Flat Blue"],
    ["optOceanBathymetrySoft", "Bathymetry Soft"],
    ["optOceanBathymetryContours", "Bathymetry Contours"],
    ["optOceanWaveHachure", "Wave Hachure"],
    ["lblOceanOpacity", "Opacity"],
    ["lblOceanScale", "Scale"],
    ["lblOceanContourStrength", "Contour Strength"],
    ["labelAutoFillStyle", "Auto-Fill Style"],
    ["lblParentBorders", "Parent Unit Borders"],
    ["lblParentBorderColor", "Color"],
    ["lblParentBorderOpacity", "Opacity"],
    ["lblParentBorderWidth", "Width"],
    ["lblParentBorderCountries", "Show Parent Borders By Country"],
    ["parentBorderEnableAll", "Enable All"],
    ["parentBorderDisableAll", "Clear All"],
    ["parentBorderEmpty", "No supported countries in current dataset."],
    ["lblContextLayers", "Context Layers"],
    ["lblPhysicalLayer", "Physical Regions"],
    ["lblPhysicalPreset", "Preset"],
    ["optPhysicalAtlasSoft", "Atlas Soft"],
    ["optPhysicalContourOnly", "Contour Only"],
    ["optPhysicalTintOnly", "Tint Only"],
    ["lblPhysicalTintColor", "Tint Color"],
    ["lblPhysicalOpacity", "Opacity"],
    ["lblPhysicalContourColor", "Contour Color"],
    ["lblPhysicalContourOpacity", "Contour Opacity"],
    ["lblPhysicalContourWidth", "Contour Width"],
    ["lblPhysicalContourSpacing", "Contour Spacing"],
    ["lblPhysicalBlendMode", "Blend Mode"],
    ["lblUrbanLayer", "Urban Areas"],
    ["lblUrbanColor", "Color"],
    ["lblUrbanOpacity", "Opacity"],
    ["lblUrbanBlendMode", "Blend Mode"],
    ["lblUrbanMinArea", "Min Area (px)"],
    ["lblRiversLayer", "Rivers"],
    ["lblRiversColor", "Color"],
    ["lblRiversOpacity", "Opacity"],
    ["lblRiversWidth", "Width"],
    ["lblRiversOutlineColor", "Outline Color"],
    ["lblRiversOutlineWidth", "Outline Width"],
    ["lblRiversDashStyle", "Dash"],
    ["labelPresetPolitical", "Auto-Fill Countries"],
    ["presetClear", "Clear Map"],
    ["lblCountrySearch", "Search Countries"],
    ["lblCountryColors", "Country Colors"],
    ["resetCountryColors", "Reset Country Colors"],
    ["lblSpecialZones", "Special Zones"],
    ["lblSpecialZonesDisputedFill", "Disputed Fill"],
    ["lblSpecialZonesDisputedStroke", "Disputed Stroke"],
    ["lblSpecialZonesWastelandFill", "Wasteland Fill"],
    ["lblSpecialZonesWastelandStroke", "Wasteland Stroke"],
    ["lblSpecialZonesCustomFill", "Custom Fill"],
    ["lblSpecialZonesCustomStroke", "Custom Stroke"],
    ["lblSpecialZonesOpacity", "Opacity"],
    ["lblSpecialZonesStrokeWidth", "Stroke Width"],
    ["lblSpecialZonesDashStyle", "Dash"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["lblSpecialZoneType", "Type"],
    ["lblSpecialZoneLabel", "Label"],
    ["specialZoneStartBtn", "Start Draw"],
    ["specialZoneUndoBtn", "Undo Vertex"],
    ["specialZoneFinishBtn", "Finish"],
    ["specialZoneCancelBtn", "Cancel"],
    ["lblSpecialZoneList", "Manual Zones"],
    ["specialZoneDeleteBtn", "Delete Selected"],
    ["specialZoneEditorHint", "Click map to add vertices, double-click to finish."],
    ["No manual zones", "No manual zones"],
    ["Drawing in progress: click map to add vertices, double-click to finish.", "Drawing in progress: click map to add vertices, double-click to finish."],
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

  const paletteLibrarySearch = document.getElementById("paletteLibrarySearch");
  if (paletteLibrarySearch) {
    paletteLibrarySearch.setAttribute(
      "placeholder",
      t("Search country, ISO-2, or source tag...", "ui")
    );
  }

  const paletteLibraryToggle = document.getElementById("paletteLibraryToggle");
  if (paletteLibraryToggle) {
    const paletteLibraryPanel = document.getElementById("paletteLibraryPanel");
    const isOpen = paletteLibraryPanel ? !paletteLibraryPanel.classList.contains("hidden") : false;
    paletteLibraryToggle.textContent = isOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
  }

  const projectFileName = document.getElementById("projectFileName");
  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updatePaletteLibraryUIFn === "function") {
    state.updatePaletteLibraryUIFn();
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
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
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
