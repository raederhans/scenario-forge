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
    ["lblCurrentTool", "Tools"],
    ["lblHistory", "History"],
    ["lblZoom", "Zoom"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["lblQuickPalette", "Quick Colors"],
    ["lblColorLibrary", "Color Library"],
    ["lblColorLibraryHint", "Browse the full palette library for manual work and palette reference."],
    ["lblPaletteSearch", "Search Colors"],
    ["lblScenario", "Scenario"],
    ["lblScenarioHint", "Load a bundled historical setup and reset to its baseline."],
    ["lblScenarioSelect", "Scenario"],
    ["applyScenarioBtn", "Apply"],
    ["resetScenarioBtn", "Reset Changes To Baseline"],
    ["clearScenarioBtn", "Exit Scenario"],
    ["scenarioStatus", "No scenario active"],
    ["scenarioAuditHint", "Coverage report unavailable"],
    ["lblExport", "Export Map"],
    ["lblExportFormat", "Format"],
    ["exportBtn", "Download Snapshot"],
    ["lblEditingRules", "Editing Rules"],
    ["lblTexture", "Texture"],
    ["lblOverlay", "Overlay"],
    ["optTextureNone", "Clean"],
    ["optTexturePaper", "Old Paper"],
    ["optTextureDraftGrid", "Draft Grid"],
    ["optTextureGraticule", "Graticule"],
    ["lblTextureOpacity", "Opacity"],
    ["lblTexturePaperScale", "Paper Scale"],
    ["lblTexturePaperWarmth", "Warmth"],
    ["lblTexturePaperGrain", "Grain"],
    ["lblTexturePaperWear", "Wear"],
    ["lblTextureGraticuleMajorStep", "Major Step"],
    ["lblTextureGraticuleMinorStep", "Minor Step"],
    ["lblTextureGraticuleLabelStep", "Label Step"],
    ["lblTextureDraftMajorStep", "Major Step"],
    ["lblTextureDraftMinorStep", "Minor Step"],
    ["lblTextureDraftLonOffset", "Longitude Offset"],
    ["lblTextureDraftLatOffset", "Latitude Tilt"],
    ["lblTextureDraftRoll", "Roll"],
    ["lblMapStyle", "Auto-Fill"],
    ["dockCollapseBtn", "Collapse"],
    ["labelMapStyle", "Appearance"],
    ["appearanceTabOcean", "Ocean"],
    ["appearanceTabBorders", "Borders"],
    ["appearanceTabLayers", "Context Layers"],
    ["appearanceTabDayNight", "Day / Night"],
    ["appearanceTabTexture", "Texture"],
    ["appearanceSpecialZoneBtn", "Special Zone Tool"],
    ["lblColorMode", "Color Mode"],
    ["optColorModeRegion", "By Region"],
    ["optColorModePolitical", "By Neighbor (Political)"],
    ["lblPaintGranularity", "Paint Granularity"],
    ["lblReferenceImage", "Reference Image"],
    ["optPaintSubdivision", "By Subdivision"],
    ["optPaintCountry", "By Country"],
    ["lblPaintMeaning", "Paint Meaning"],
    ["labelActiveSovereign", "Active Owner"],
    ["optPaintMeaningVisual", "Visual Color"],
    ["optPaintMeaningSovereignty", "Political Ownership"],
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
    ["lblPhysicalPanel", "Physical Regions"],
    ["lblPhysicalLayer", "Physical Regions"],
    ["lblPhysicalMode", "Mode"],
    ["optPhysicalModeAtlasContours", "Atlas + Contours"],
    ["optPhysicalModeAtlasOnly", "Atlas Only"],
    ["optPhysicalModeContoursOnly", "Contours Only"],
    ["lblPhysicalOpacity", "Opacity"],
    ["lblTerrainAtlasPanel", "Terrain Atlas"],
    ["lblPhysicalAtlasIntensity", "Atlas Intensity"],
    ["lblPhysicalRainforestEmphasis", "Rainforest Emphasis"],
    ["lblPhysicalClassMountain", "Mountains"],
    ["lblPhysicalClassPlateau", "Plateaus"],
    ["lblPhysicalClassPlains", "Plains"],
    ["lblPhysicalClassWetlands", "Wetlands & Delta"],
    ["lblPhysicalClassForest", "Forest"],
    ["lblPhysicalClassRainforest", "Rainforest"],
    ["lblPhysicalClassDesert", "Desert & Bare"],
    ["lblPhysicalClassTundra", "Tundra & Ice"],
    ["lblTerrainContoursPanel", "Terrain Contours"],
    ["lblPhysicalMinorContours", "Show Minor Contours"],
    ["lblPhysicalContourColor", "Contour Color"],
    ["lblPhysicalContourOpacity", "Contour Opacity"],
    ["lblPhysicalContourMajorWidth", "Major Width"],
    ["lblPhysicalContourMinorWidth", "Minor Width"],
    ["lblPhysicalContourMajorInterval", "Major Interval (m)"],
    ["lblPhysicalContourMinorInterval", "Minor Interval (m)"],
    ["lblPhysicalContourLowReliefCutoff", "Low-Relief Cutoff (m)"],
    ["lblPhysicalBlendMode", "Blend Mode"],
    ["lblUrbanLayer", "Urban Areas"],
    ["lblUrbanColor", "Color"],
    ["lblUrbanOpacity", "Opacity"],
    ["lblUrbanBlendMode", "Blend Mode"],
    ["lblUrbanMinArea", "Min Area (px)"],
    ["lblDayNightPanel", "Day / Night"],
    ["lblDayNightEnabled", "Enable Day / Night Cycle"],
    ["dayNightModeManualBtn", "Manual"],
    ["dayNightModeUtcBtn", "UTC Sync"],
    ["lblDayNightTime", "UTC Time"],
    ["dayNightModeHint", "Live UTC sync updates once per minute."],
    ["lblDayNightCityLights", "City Lights"],
    ["lblDayNightCityLightsStyle", "Style"],
    ["optDayNightCityLightsModern", "Modern"],
    ["optDayNightCityLightsHistorical1930s", "1930s Sparse Electrification"],
    ["lblDayNightCityLightsIntensity", "Intensity"],
    ["lblDayNightAdvanced", "Advanced"],
    ["lblDayNightTextureOpacity", "Texture Opacity"],
    ["lblDayNightCorridorStrength", "Corridor Strength"],
    ["lblDayNightCoreSharpness", "Core Sharpness"],
    ["lblDayNightShadowOpacity", "Shadow Opacity"],
    ["lblDayNightTwilightWidth", "Twilight Width"],
    ["lblRiversLayer", "Rivers"],
    ["lblRiversColor", "Color"],
    ["lblRiversOpacity", "Opacity"],
    ["lblRiversWidth", "Width"],
    ["lblRiversOutlineColor", "Outline Color"],
    ["lblRiversOutlineWidth", "Outline Width"],
    ["lblRiversDashStyle", "Dash"],
    ["lblWaterRegions", "Water Regions"],
    ["lblOpenOceanRegions", "Open Ocean Regions"],
    ["labelPresetPolitical", "Auto-Fill Countries"],
    ["presetClear", "Clear Map"],
    ["zoomResetBtn", "Fit"],
    ["lblCountrySearch", "Search Countries"],
    ["lblWaterSearch", "Search Water Regions"],
    ["lblPresetsHierarchy", "Territories & Presets"],
    ["lblCountryInspector", "Country Inspector"],
    ["lblWaterInspector", "Water Regions"],
    ["lblProjectLegend", "Project & Legend"],
    ["lblDiagnostics", "Diagnostics"],
    ["lblCountryColors", "Country Colors"],
    ["lblWaterLegend", "Water Overrides"],
    ["countryInspectorOrderingHint", "Key scenario countries first. Releasables appear under parent countries."],
    ["countryInspectorEmptyTitle", "Select a country to inspect"],
    ["countryInspectorEmptyHint", "Choose a country above, then use Active Owner and the Territories & Presets panel."],
    ["waterInspectorEmptyTitle", "Select a water region to inspect"],
    ["waterInspectorEmptyHint", "Click a sea, lake, or strait on the map, or choose one from the list."],
    ["resetCountryColors", "Reset Country Colors"],
    ["clearWaterRegionColorBtn", "Clear Water Override"],
    ["lblHistoricalPresets", "Selected Country Actions"],
    ["selectedCountryActionHint", "Choose a country above to inspect territories, presets, and releasables."],
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
    ["scenarioContextScenarioText", "Scenario: None"],
    ["scenarioContextModeText", "Mode: Visual Color"],
    ["scenarioContextActiveText", "Active: None"],
    ["scenarioContextCollapseBtn", "Collapse"],
    ["scenarioGuideTitle", "Scenario Quick Start"],
    ["scenarioGuideStepApply", "Apply Scenario"],
    ["scenarioGuideStepSelect", "Select a country in Inspector"],
    ["scenarioGuideStepActive", "Use an active owner for political actions"],
    ["scenarioGuideStepApplyActions", "Use Activate or Scenario Actions for ownership changes"],
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
  if (typeof state.updateHistoryUIFn === "function") {
    state.updateHistoryUIFn();
  }
  if (typeof state.updateZoomUIFn === "function") {
    state.updateZoomUIFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }

  const searchInput = document.getElementById("countrySearch");
  if (searchInput) {
    searchInput.setAttribute("placeholder", t("Search country or code...", "ui"));
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

  const iconButtonLabels = [
    ["toolFillBtn", "Fill tool"],
    ["toolEraserBtn", "Eraser tool"],
    ["toolEyedropperBtn", "Eyedropper tool"],
    ["brushModeBtn", "Brush"],
    ["undoBtn", "Undo"],
    ["redoBtn", "Redo"],
    ["zoomInBtn", "Zoom in"],
    ["zoomOutBtn", "Zoom out"],
    ["zoomResetBtn", "Fit"],
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Export"],
  ];
  iconButtonLabels.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const translated = t(label, "ui");
    el.setAttribute("aria-label", translated);
    el.setAttribute("title", translated);
  });

  const zoomPercentInput = document.getElementById("zoomPercentInput");
  if (zoomPercentInput) {
    zoomPercentInput.setAttribute("aria-label", t("Zoom percentage", "ui"));
    zoomPercentInput.setAttribute("title", t("Zoom percentage", "ui"));
  }

  const projectFileName = document.getElementById("projectFileName");
  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  const toolHudChip = document.getElementById("toolHudChip");
  if (toolHudChip && !toolHudChip.classList.contains("hidden")) {
    const currentText = toolHudChip.textContent?.trim();
    if (currentText) {
      toolHudChip.textContent = t(currentText, "ui");
    }
  }

  const onboardingHint = document.getElementById("mapOnboardingHint");
  if (onboardingHint) {
    onboardingHint.textContent = t(
      "Click a region to start painting, or use Auto-Fill to color all countries",
      "ui"
    );
  }

  const referencePopover = document.getElementById("dockReferencePopover");
  if (referencePopover) {
    referencePopover.setAttribute("aria-label", t("Reference tools", "ui"));
  }

  const exportPopover = document.getElementById("dockExportPopover");
  if (exportPopover) {
    exportPopover.setAttribute("aria-label", t("Export tools", "ui"));
  }

  const confirmableButtons = [
    ["presetClear", "Clear Map"],
    ["resetCountryColors", "Reset Country Colors"],
    ["specialZoneDeleteBtn", "Delete Selected"],
  ];
  confirmableButtons.forEach(([id, idleLabel]) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.confirmState) return;
    button.textContent = t(idleLabel, "ui");
  });

  const leftPanelToggle = document.getElementById("leftPanelToggle");
  if (leftPanelToggle) {
    leftPanelToggle.textContent = t("Panels", "ui");
  }

  const rightPanelToggle = document.getElementById("rightPanelToggle");
  if (rightPanelToggle) {
    rightPanelToggle.textContent = t("Inspector", "ui");
  }

  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updatePaletteLibraryUIFn === "function") {
    state.updatePaletteLibraryUIFn();
  }
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
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
  const isWaterRegion = !!feature?.properties?.water_type;
  const rawName =
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    (isWaterRegion ? "Unknown Water Region" : "Unknown Region");
  const name = t(rawName, "geo");
  const code = (feature?.properties?.cntr_code || "").toUpperCase();
  const labelKey = isWaterRegion ? "Water Region" : "Region";
  const label = state.currentLanguage === "zh" ? t(labelKey, "ui") : labelKey;
  const waterType = isWaterRegion ? String(feature?.properties?.water_type || "").trim() : "";
  if (!name && !code) return label;
  if (waterType) return `${label}: ${name} (${waterType})`;
  if (code) return `${label}: ${name} (${code})`;
  return `${label}: ${name}`;
}

export { t, initTranslations, toggleLanguage, updateUIText, getTooltipText };
