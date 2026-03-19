// Translation helpers (Phase 13)
import { state } from "../core/state.js";
import { normalizeCountryCodeAlias } from "../core/country_code_aliases.js";

function resolveGeoLocaleEntry(key) {
  const geoLocales = state.locales?.geo || {};
  if (geoLocales[key]) return geoLocales[key];

  const stableKey = state.geoAliasToStableKey?.[key];
  if (stableKey && geoLocales[stableKey]) {
    return geoLocales[stableKey];
  }
  return null;
}

function resolveGeoLocaleText(
  key,
  {
    allowCrossLanguageFallback = true,
    includeCandidateFallback = true,
  } = {}
) {
  const candidate = String(key || "").trim();
  if (!candidate) return "";
  const entry = resolveGeoLocaleEntry(candidate);
  if (!entry || typeof entry !== "object") return "";
  const preferred = state.currentLanguage === "zh" ? entry.zh : entry.en;
  const secondary = state.currentLanguage === "zh" ? entry.en : entry.zh;
  return String(
    preferred
      || (allowCrossLanguageFallback ? secondary : "")
      || (includeCandidateFallback ? candidate : "")
  ).trim();
}

function getPreferredGeoLabel(candidates = [], fallback = "", options = {}) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const localized = resolveGeoLocaleText(candidate, options);
    if (localized) return localized;
  }
  return String(fallback || "").trim();
}

function getStrictGeoLabel(candidates = [], fallback = "") {
  return getPreferredGeoLabel(candidates, fallback, {
    allowCrossLanguageFallback: false,
    includeCandidateFallback: false,
  });
}

function hasExplicitScenarioGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  if (!candidate) return false;
  const scenarioGeo = state.scenarioGeoLocalePatchData?.geo;
  return !!(
    scenarioGeo
    && typeof scenarioGeo === "object"
    && Object.prototype.hasOwnProperty.call(scenarioGeo, candidate)
  );
}

function getSafeRawFeatureLabel(candidates = []) {
  const items = Array.isArray(candidates) ? candidates : [candidates];
  for (const rawCandidate of items) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate) continue;
    const entry = resolveGeoLocaleEntry(candidate);
    if (!entry || typeof entry !== "object") continue;
    const entryEn = String(entry.en || "").trim();
    const entryZh = String(entry.zh || "").trim();
    const isSafeDirectMatch = (entryEn && entryEn === candidate) || (!entryEn && entryZh === candidate);
    if (!isSafeDirectMatch) continue;
    const localized = resolveGeoLocaleText(candidate, {
      allowCrossLanguageFallback: true,
      includeCandidateFallback: false,
    });
    if (localized) return localized;
  }
  return "";
}

function getGeoFeatureDisplayLabel(feature, fallback = "") {
  const props = feature?.properties || {};
  const preferredIdCandidates = [];
  [
    props.__city_host_feature_id,
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    preferredIdCandidates.push(candidate);
  });
  [
    props.id,
    feature?.id,
  ].forEach((rawCandidate) => {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || preferredIdCandidates.includes(candidate)) return;
    if (hasExplicitScenarioGeoLocaleEntry(candidate)) {
      preferredIdCandidates.push(candidate);
    }
  });
  const explicitLabel = getPreferredGeoLabel(preferredIdCandidates, "", {
    allowCrossLanguageFallback: true,
    includeCandidateFallback: false,
  });
  if (explicitLabel) {
    return explicitLabel;
  }

  const rawNameCandidates = [
    props.label,
    props.name,
    props.name_en,
    props.NAME,
  ];
  const safeRawLabel = getSafeRawFeatureLabel(rawNameCandidates);
  if (safeRawLabel) {
    return safeRawLabel;
  }

  return String(
    rawNameCandidates.find((value) => String(value || "").trim())
    || props.id
    || feature?.id
    || fallback
  ).trim();
}

function t(key, type = "geo") {
  if (!key) return "";
  const entry = type === "geo" ? resolveGeoLocaleEntry(key) : state.locales?.[type]?.[key];
  const lang = state.currentLanguage === "zh" ? "zh" : "en";
  return entry?.[lang] || entry?.en || key;
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
    ["lblAppHint", "Click countries to paint. Use the dock below the map for quick tools and the left panel for deeper controls."],
    ["lblScenarioHint", "Load a bundled historical setup and reset to its baseline."],
    ["lblScenarioSelect", "Scenario"],
    ["optScenarioNone", "None"],
    ["optScenarioOwnership", "Ownership"],
    ["optScenarioFrontline", "Frontline"],
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
    ["lblBordersPanel", "Borders"],
    ["lblInternalBorders", "Internal Borders"],
    ["lblEmpireBorders", "Empire Borders"],
    ["lblCoastlines", "Coastlines"],
    ["appearanceTabLayers", "Context Layers"],
    ["appearanceTabDayNight", "Day / Night"],
    ["appearanceTabTexture", "Texture"],
    ["appearanceSpecialZoneBtn", "Special Zone Tool"],
    ["lblColorMode", "Color Mode"],
    ["optColorModeRegion", "By Region"],
    ["optColorModePolitical", "By Neighbor (Political)"],
    ["lblPaintGranularity", "Paint Granularity"],
    ["dockQuickFillLabel", "Double-Click Quick Fill"],
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
    ["optPhysicalBlendMultiply", "Multiply"],
    ["optPhysicalBlendSoftLight", "Soft Light"],
    ["optPhysicalBlendOverlay", "Overlay"],
    ["optPhysicalBlendNormal", "Normal"],
    ["lblUrbanPanel", "Urban Areas"],
    ["lblUrbanLayer", "Urban Areas"],
    ["lblUrbanColor", "Color"],
    ["lblUrbanOpacity", "Opacity"],
    ["lblUrbanBlendMode", "Blend Mode"],
    ["optUrbanBlendMultiply", "Multiply"],
    ["optUrbanBlendNormal", "Normal"],
    ["optUrbanBlendOverlay", "Overlay"],
    ["lblUrbanMinArea", "Min Area (px)"],
    ["lblCityPointsPanel", "City Points"],
    ["lblCityPointsLayer", "City Points"],
    ["lblCityPointsStylePreset", "Style Preset"],
    ["optCityThemeClassicGraphite", "Classic Graphite"],
    ["lblCityPointsMarkerScale", "Marker Scale"],
    ["lblCityPointsLabelDensity", "Label Density"],
    ["cityPointsLabelDensityHint", "Controls how many labels can appear per viewport at mid/high zoom."],
    ["optCityLabelDensitySparse", "Sparse"],
    ["optCityLabelDensityBalanced", "Balanced"],
    ["optCityLabelDensityDense", "Dense"],
    ["lblCityPointsAdvanced", "Advanced"],
    ["lblCityPointsColor", "Point Color"],
    ["lblCityPointsCapitalColor", "Capital Highlight Color"],
    ["lblCityPointsOpacity", "Point Opacity"],
    ["lblCityPointsRadius", "Point Size"],
    ["lblCityPointLabelsEnabled", "Show City Labels"],
    ["lblCityPointsLabelSize", "Label Size"],
    ["lblCityCapitalOverlayEnabled", "Highlight Capitals"],
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
    ["lblRiversPanel", "Rivers"],
    ["optRiversDashSolid", "Solid"],
    ["optRiversDashDashed", "Dashed"],
    ["optRiversDashDotted", "Dotted"],
    ["lblWaterRegions", "Water Regions"],
    ["lblWaterRegionsPanel", "Water Regions"],
    ["lblOpenOceanRegions", "Allow Open-Ocean Interaction"],
    ["labelPresetPolitical", "Auto-Fill Countries"],
    ["presetClear", "Clear Map"],
    ["zoomResetBtn", "Fit"],
    ["lblCountrySearch", "Search Countries"],
    ["lblWaterSearch", "Search Water Regions"],
    ["lblSpecialRegionSearch", "Search Special Regions"],
    ["lblPresetsHierarchy", "Territories & Presets"],
    ["lblCountryInspector", "Country Inspector"],
    ["lblWaterInspector", "Water Regions"],
    ["lblWaterInteraction", "Interaction"],
    ["lblWaterInspectorOpenOceanToggle", "Allow Open-Ocean Interaction"],
    ["waterInspectorOpenOceanHint", "When off, macro ocean regions are ignored for hover, click, and paint."],
    ["waterInspectorOpenOceanHintEnabled", "Macro ocean regions are currently included in hover, click, and paint."],
    ["lblSpecialRegionInspector", "Special Regions"],
    ["lblScenarioSpecialRegionVisibility", "Visibility"],
    ["lblScenarioSpecialRegionVisibilityToggle", "Show Scenario Special Regions"],
    ["scenarioSpecialRegionVisibilityHint", "When off, scenario special regions are hidden and ignore hover, click, and paint."],
    ["scenarioSpecialRegionVisibilityHintEnabled", "Scenario special regions are currently visible and interactive."],
    ["lblScenarioReliefOverlayVisibilityToggle", "Show Scenario Relief Overlays"],
    ["scenarioReliefOverlayVisibilityHint", "When off, shoreline, basin contour, and texture overlays are hidden for the active scenario."],
    ["scenarioReliefOverlayVisibilityHintEnabled", "Scenario relief overlays are currently visible. During pan and zoom they redraw only after the view settles."],
    ["lblProjectLegend", "Project & Legend"],
    ["lblDiagnostics", "Diagnostics"],
    ["lblCountryColors", "Country Colors"],
    ["lblWaterLegend", "Water Overrides"],
    ["lblSpecialRegionLegend", "Special Region Overrides"],
    ["countryInspectorOrderingHint", "Key scenario countries first. Releasables appear under parent countries."],
    ["countryInspectorEmptyTitle", "Select a country to inspect"],
    ["countryInspectorEmptyHint", "Choose a country above, then use Active Owner and the Territories & Presets panel."],
    ["waterInspectorEmptyTitle", "Select a water region to inspect"],
    ["waterInspectorEmptyHint", "Click a sea, lake, or strait on the map, or choose one from the list."],
    ["specialRegionInspectorEmptyTitle", "Select a special region to inspect"],
    ["specialRegionInspectorEmptyHint", "Click a drained basin or exposure zone on the map, or choose one from the list."],
    ["resetCountryColors", "Reset Country Colors"],
    ["clearWaterRegionColorBtn", "Clear Water Override"],
    ["clearSpecialRegionColorBtn", "Clear Special Region Override"],
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
    ["lblSpecialZonesStylePanel", "Special Zones Style"],
    ["optSpecialZonesDashSolid", "Solid"],
    ["optSpecialZonesDashDashed", "Dashed"],
    ["optSpecialZonesDashDotted", "Dotted"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["lblSpecialZoneType", "Type"],
    ["optSpecialZoneDisputed", "Disputed"],
    ["optSpecialZoneWasteland", "Wasteland"],
    ["optSpecialZoneCustom", "Custom"],
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
    ["lblUtilities", "Utilities"],
    ["lblReferenceOpacity", "Opacity"],
    ["lblReferenceScale", "Scale"],
    ["lblReferenceOffsetX", "Offset X"],
    ["lblReferenceOffsetY", "Offset Y"],
    ["lblExportInfoTooltip", "Export the visible map as a PNG or JPG snapshot."],
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
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }

  const searchInput = document.getElementById("countrySearch");
  if (searchInput) {
    searchInput.setAttribute("placeholder", t("Search country or code...", "ui"));
  }

  const waterSearchInput = document.getElementById("waterRegionSearch");
  if (waterSearchInput) {
    waterSearchInput.setAttribute("placeholder", t("Search sea, lake, or strait...", "ui"));
  }

  const specialRegionSearchInput = document.getElementById("specialRegionSearch");
  if (specialRegionSearchInput) {
    specialRegionSearchInput.setAttribute("placeholder", t("Search basin, shelf, or exposure...", "ui"));
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
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
}

function initTranslations() {
  updateUIText();
}

function getTooltipFeatureId(feature) {
  const raw =
    feature?.properties?.id ??
    feature?.properties?.NUTS_ID ??
    feature?.id;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function normalizeTooltipCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function extractTooltipCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

function getTooltipFeatureCountryCode(feature) {
  const props = feature?.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  const normalizedDirect = normalizeTooltipCountryCode(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }

  return normalizeTooltipCountryCode(
    extractTooltipCountryCodeFromId(props.id) ||
    extractTooltipCountryCodeFromId(props.NUTS_ID) ||
    extractTooltipCountryCodeFromId(feature?.id)
  );
}

function getTooltipRegionName(feature, fallback) {
  const rawName =
    getGeoFeatureDisplayLabel(feature) ||
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    fallback;
  return rawName || fallback;
}

function normalizeTooltipComparisonValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getTooltipCountryContext(feature) {
  const featureId = getTooltipFeatureId(feature);
  const scenarioBaselineCode = state.activeScenarioId
    ? normalizeTooltipCountryCode(state.scenarioBaselineOwnersByFeatureId?.[featureId] || "")
    : "";
  const countryCode = scenarioBaselineCode || getTooltipFeatureCountryCode(feature);
  const rawCountryName =
    state.scenarioCountriesByTag?.[countryCode]?.display_name ||
    state.countryNames?.[countryCode] ||
    countryCode;
  const countryDisplayName = t(rawCountryName, "geo") || rawCountryName || countryCode;
  return {
    countryCode,
    countryDisplayName,
  };
}

function getTooltipAdmin1Name(feature, { regionName = "", countryDisplayName = "" } = {}) {
  const candidates = [
    feature?.properties?.admin1_group,
    feature?.properties?.constituent_country,
  ];
  const regionKey = normalizeTooltipComparisonValue(regionName);
  const countryKey = normalizeTooltipComparisonValue(countryDisplayName);

  for (const candidate of candidates) {
    const rawValue = String(candidate || "").trim();
    if (!rawValue) continue;
    const displayValue = t(rawValue, "geo") || rawValue;
    const comparisonValue = normalizeTooltipComparisonValue(displayValue);
    if (!comparisonValue) continue;
    if (comparisonValue === regionKey || comparisonValue === countryKey) continue;
    return displayValue;
  }

  return "";
}

function buildLegacyTooltipModel(feature, { isWaterRegion = false, isSpecialRegion = false } = {}) {
  const fallback = isWaterRegion ? t("Unknown Water Region", "ui") : t("Unknown Region", "ui");
  const name = getTooltipRegionName(feature, fallback);
  const code = getTooltipFeatureCountryCode(feature);
  const labelKey = isWaterRegion ? "Water Region" : "Region";
  const label = state.currentLanguage === "zh" ? t(labelKey, "ui") : labelKey;
  const waterType = isWaterRegion ? String(feature?.properties?.water_type || "").trim() : "";
  const specialType = isSpecialRegion ? String(feature?.properties?.special_type || "").trim() : "";
  const lines = [];

  if (!name && !code) {
    lines.push(label);
  } else if (waterType) {
    lines.push(`${label}: ${name} (${waterType})`);
  } else if (specialType) {
    lines.push(`${label}: ${name} (${specialType})`);
  } else if (code) {
    lines.push(`${label}: ${name} (${code})`);
  } else {
    lines.push(`${label}: ${name}`);
  }

  return {
    regionName: name,
    admin1Name: "",
    countryCode: code,
    countryDisplayName: "",
    lines,
  };
}

function buildTooltipModel(feature) {
  if (!feature) {
    return {
      regionName: "",
      admin1Name: "",
      countryCode: "",
      countryDisplayName: "",
      lines: [],
    };
  }

  const isWaterRegion = !!feature?.properties?.water_type;
  const isSpecialRegion = !!feature?.properties?.special_type;
  if (isWaterRegion || isSpecialRegion) {
    return buildLegacyTooltipModel(feature, { isWaterRegion, isSpecialRegion });
  }

  const regionName = getTooltipRegionName(feature, t("Unknown Region", "ui"));
  const { countryCode, countryDisplayName } = getTooltipCountryContext(feature);
  const admin1Name = getTooltipAdmin1Name(feature, {
    regionName,
    countryDisplayName,
  });
  const lines = [regionName];
  if (admin1Name) {
    lines.push(admin1Name);
  }
  if (countryDisplayName) {
    lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
  }

  return {
    regionName,
    admin1Name,
    countryCode,
    countryDisplayName,
    lines: lines.filter(Boolean),
  };
}

function renderTooltipText(model) {
  const lines = Array.isArray(model?.lines) ? model.lines.filter(Boolean) : [];
  return lines.join("\n");
}

function getTooltipText(feature) {
  return renderTooltipText(buildTooltipModel(feature));
}

export {
  t,
  initTranslations,
  toggleLanguage,
  updateUIText,
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getGeoFeatureDisplayLabel,
  getTooltipCountryContext,
  buildTooltipModel,
  renderTooltipText,
  getTooltipText,
};
