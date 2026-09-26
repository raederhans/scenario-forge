// UI translation runtime hooks and DOM refresh helpers.
import { state as runtimeState } from "../core/state.js";
import { callRuntimeHook, callRuntimeHooks } from "../core/state/index.js";
import {
  clearStartupSupportKeyUsageAuditReport,
  consumeStartupSupportKeyUsageAuditReport,
  getStartupSupportKeyUsageAuditReport,
  setStartupSupportKeyUsageAuditEnabled,
  t,
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getGeoFeatureDisplayLabel,
  getTooltipCountryContext,
  buildTooltipModel,
  renderTooltipText,
  getTooltipText,
} from "../core/i18n.js";

const state = runtimeState;

function applyDeclarativeTranslationToElement(element) {
  if (!element?.getAttribute) return;

  // 这一层只负责把 data-i18n* 属性映射到 DOM，可见文本的业务决策仍留在 t()/catalog/runtime locale。
  const applyTextValue = (localizedText) => {
    const semanticChild = typeof element.querySelector === "function"
      ? element.querySelector(":scope > .sidebar-anchor-title, :scope > .sidebar-section-title, :scope > .sidebar-support-title, :scope > .sidebar-appendix-title, :scope > .sidebar-tool-title")
      : null;
    if (semanticChild instanceof HTMLElement) {
      semanticChild.textContent = localizedText;
      return;
    }
    element.textContent = localizedText;
  };

  const textKey = String(element.getAttribute("data-i18n") || "").trim();
  if (textKey) {
    applyTextValue(t(textKey, "ui"));
  }

  const placeholderKey = String(element.getAttribute("data-i18n-placeholder") || "").trim();
  if (placeholderKey) {
    element.setAttribute("placeholder", t(placeholderKey, "ui"));
  }

  const titleKey = String(element.getAttribute("data-i18n-title") || "").trim();
  if (titleKey) {
    element.setAttribute("title", t(titleKey, "ui"));
  }

  const ariaLabelKey = String(element.getAttribute("data-i18n-aria-label") || "").trim();
  if (ariaLabelKey) {
    element.setAttribute("aria-label", t(ariaLabelKey, "ui"));
  }

  const altKey = String(element.getAttribute("data-i18n-alt") || "").trim();
  if (altKey) {
    element.setAttribute("alt", t(altKey, "ui"));
  }
}

function applyDeclarativeTranslations(root = document) {
  if (!root) return;
  // root 可以是整个 document，也可以是局部重渲染后的壳节点；
  // 统一走同一个扫描器，避免每个 panel 都维护各自的翻译补丁逻辑。
  const selector = "[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-alt]";
  const elements = [];
  if (root.nodeType === 1 && root.matches?.(selector)) {
    elements.push(root);
  }
  if (typeof root.querySelectorAll === "function") {
    elements.push(...root.querySelectorAll(selector));
  }
  elements.forEach((element) => {
    applyDeclarativeTranslationToElement(element);
  });
}

function updateUIText() {
  applyDeclarativeTranslations(document);

  const uiMap = [
    ["lblCurrentTool", "Tools"],
    ["lblHistory", "History"],
    ["lblZoom", "Zoom"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["Layer-based special zones are the canonical editor. Use the workbench below to create layers, choose presets, and edit memberships.", "Layer-based special zones are the canonical editor. Use the workbench below to create layers, choose presets, and edit memberships."],
    ["Layer-based special zones are the canonical editor. Use the workbench above to edit memberships.", "Layer-based special zones are the canonical editor. Use the workbench above to edit memberships."],
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
    ["lblExportTarget", "Target:"],
    ["optExportTargetComposite", "Composite image"],
    ["optExportTargetPerLayerPng", "Per-layer PNG"],
    ["optExportTargetBakePack", "Bake pack (v1.1)"],
    ["lblExportFormat", "Format"],
    ["lblExportScale", "Export Resolution"],
    ["lblExportWorkbenchMainLayers", "Main Layers"],
    ["exportWorkbenchHint", "Drag to reorder exported layer groups. Visibility only applies to this export session."],
    ["optExportScale1x", "Current preview (1×)"],
    ["optExportScale1_5x", "High (1.5×)"],
    ["optExportScale2x", "Ultra (2×)"],
    ["optExportScale4x", "Maximum detail (4×)"],
    ["exportResolutionHint", "Preview rendering and final export resolution are independent. Final export is capped at 8K (7680 × 4320)."],
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
    ["lblTextureGraticuleColor", "Line Color"],
    ["lblTextureGraticuleLabelColor", "Label Color"],
    ["lblTextureGraticuleLabelSize", "Label Size"],
    ["lblTextureGraticuleMajorWidth", "Major Width"],
    ["lblTextureGraticuleMinorWidth", "Minor Width"],
    ["lblTextureGraticuleMajorOpacity", "Major Opacity"],
    ["lblTextureGraticuleMinorOpacity", "Minor Opacity"],
    ["lblTextureDraftMajorStep", "Major Step"],
    ["lblTextureDraftMinorStep", "Minor Step"],
    ["lblTextureDraftLonOffset", "Longitude Offset"],
    ["lblTextureDraftLatOffset", "Latitude Tilt"],
    ["lblTextureDraftRoll", "Roll"],
    ["lblTextureDraftColor", "Line Color"],
    ["lblTextureDraftWidth", "Line Width"],
    ["lblTextureDraftMajorOpacity", "Major Opacity"],
    ["lblTextureDraftMinorOpacity", "Minor Opacity"],
    ["lblTextureDraftDash", "Dash Style"],
    ["optTextureDraftDashDashed", "Dashed"],
    ["optTextureDraftDashDotted", "Dotted"],
    ["optTextureDraftDashSolid", "Solid"],
    ["lblMapStyle", "Auto-Fill"],
    ["dockHandleLabel", "Collapse"],
    ["labelMapStyle", "Appearance"],
    ["labelMapContent", "Map Content"],
    ["appearanceTabOcean", "Ocean"],
    ["mapContentTabOcean", "Ocean"],
    ["mapContentTabDayNight", "Day / Night"],
    ["mapContentTabTexture", "Texture"],
    ["mapContentTabRivers", "Rivers"],
    ["appearanceTabBorders", "Borders"],
    ["appearanceTabPhysical", "Physical Regions"],
    ["appearanceTabUrban", "Urban Areas"],
    ["appearanceTabCityPoints", "City Points"],
    ["lblBordersPanel", "Borders"],
    ["lblInternalBorders", "Internal Borders"],
    ["lblEmpireBorders", "Country Borders"],
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
    ["lblOceanCoastalAccent", "Coastal Accent"],
    ["lblOceanAdvancedStylesToggle", "Experimental Bathymetry"],
    ["lblOceanStyle", "Style"],
    ["optOceanFlat", "Flat Blue"],
    ["optOceanBathymetrySoft", "Bathymetry Soft"],
    ["optOceanBathymetryContours", "Bathymetry Contours"],
    ["lblOceanOpacity", "Opacity"],
    ["lblOceanScale", "Scale"],
    ["lblOceanContourStrength", "Contour Strength"],
    ["lblOceanBathymetryDebug", "Bathymetry Debug"],
    ["oceanBathymetryDebugHint", "Advanced high-zoom tuning for nearshore fill and scenario contour exit thresholds."],
    ["lblOceanBathymetrySource", "Data Source"],
    ["lblOceanBathymetryBands", "Bands"],
    ["lblOceanBathymetryContours", "Contours"],
    ["lblOceanShallowFadeEndZoom", "Nearshore Fill Exit"],
    ["lblOceanMidFadeEndZoom", "Mid-depth Fill Exit"],
    ["lblOceanDeepFadeEndZoom", "Deep Fill Exit"],
    ["lblOceanScenarioSyntheticContourFadeEndZoom", "Synthetic Contour Exit"],
    ["lblOceanScenarioShallowContourFadeEndZoom", "Shallow Scenario Contour Exit"],
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
    ["lblPhysicalTabPanel", "Physical Regions"],
    ["lblPhysicalPanel", "Physical Regions"],
    ["lblPhysicalLayer", "Physical Regions"],
    ["lblPhysicalPreset", "Visual Preset"],
    ["optPhysicalPresetPoliticalClean", "Political Clean"],
    ["optPhysicalPresetBalanced", "Balanced"],
    ["optPhysicalPresetTerrainRich", "Terrain Rich"],
    ["lblPhysicalMode", "Mode"],
    ["optPhysicalModeAtlasContours", "Atlas + Contours"],
    ["optPhysicalModeAtlasOnly", "Atlas Only"],
    ["optPhysicalModeContoursOnly", "Contours Only"],
    ["lblPhysicalOpacity", "Opacity"],
    ["lblTerrainAtlasPanel", "Terrain Atlas"],
    ["lblPhysicalAtlasIntensity", "Atlas Intensity"],
    ["lblPhysicalRainforestEmphasis", "Rainforest Emphasis"],
    ["lblPhysicalClassMountain", "High Relief Mountains"],
    ["lblPhysicalClassMountainHills", "Mountain Hills"],
    ["lblPhysicalClassPlateau", "Upland Plateaus"],
    ["lblPhysicalClassBadlands", "Badlands & Canyon"],
    ["lblPhysicalClassPlains", "Plains Lowlands"],
    ["lblPhysicalClassBasin", "Basins & Valleys"],
    ["lblPhysicalClassWetlands", "Wetlands & Delta"],
    ["lblPhysicalClassForestTemperate", "Temperate Forest"],
    ["lblPhysicalClassRainforestTropical", "Tropical Rainforest"],
    ["lblPhysicalClassGrassland", "Grassland & Steppe"],
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
    ["lblPhysicalIntensityFieldPanel", "Intensity Field"],
    ["lblPhysicalIntensityFieldChannelAtlas", "Atlas"],
    ["lblPhysicalIntensityFieldChannelContour", "Contour"],
    ["lblPhysicalIntensityFieldEnabled", "Enable Channel"],
    ["physicalIntensityFieldToolToggleBtn", "Enter Tool"],
    ["physicalIntensityFieldPaintBtn", "Paint"],
    ["physicalIntensityFieldEraseBtn", "Erase"],
    ["physicalIntensityFieldPointsBtn", "Points"],
    ["lblPhysicalIntensityFieldWeight", "Strength"],
    ["lblPhysicalIntensityFieldRadius", "Radius"],
    ["physicalIntensityFieldClearBtn", "Clear Channel"],
    ["lblPhysicalIntensityFieldPointCount", "Points"],
    ["lblUrbanPanel", "Urban Areas"],
    ["lblUrbanTabPanel", "Urban Areas"],
    ["lblUrbanLayer", "Urban Areas"],
    ["lblUrbanColor", "Color"],
    ["lblUrbanOpacity", "Opacity"],
    ["lblUrbanBlendMode", "Blend Mode"],
    ["optUrbanBlendMultiply", "Multiply"],
    ["optUrbanBlendNormal", "Normal"],
    ["optUrbanBlendOverlay", "Overlay"],
    ["lblUrbanMinArea", "Min Area (px)"],
    ["lblCityPointsPanel", "City Points"],
    ["lblCityPointsTabPanel", "City Points"],
    ["lblCityPointsLayer", "City Points"],
    ["lblCityPointsPresetDensityGroup", "Preset & Density"],
    ["cityPointsPresetDensityGroupHint", "Choose a city marker treatment first, then tune how many point markers and labels are allowed to surface."],
    ["optCityPointsThemeClassicGraphite", "Graphite Signal"],
    ["optCityPointsThemeAtlasInk", "Cyan Beacon"],
    ["optCityPointsThemeParchmentSepia", "Vermilion Ledger"],
    ["optCityPointsThemeSlateBlue", "Royal Violet"],
    ["optCityPointsThemeIvoryOutline", "Ivory Night"],
    ["lblCityPointsMarkerScale", "Marker Scale"],
    ["lblCityPointsMarkerDensity", "Point Density"],
    ["lblCityPointsLabelDensity", "Label Density"],
    ["cityPointsMarkerDensityHint", "Controls how many city markers can appear per viewport at mid/high zoom."],
    ["cityPointsLabelDensityHint", "Controls label count only. It does not change point density."],
    ["optCityLabelDensitySparse", "Sparse"],
    ["optCityLabelDensityBalanced", "Balanced"],
    ["optCityLabelDensityDense", "Dense"],
    ["lblCityPointsVisibilityGroup", "Visibility"],
    ["cityPointsVisibilityGroupHint", "Keep the main visibility controls together so opacity, labels, and capital emphasis read as one layer."],
    ["lblCityPointsAdvanced", "Advanced"],
    ["cityPointsAdvancedHint", "Fine-tune colors and label size once the preset and density feel close."],
    ["lblCityPointsColor", "Point Color"],
    ["lblCityPointsCapitalColor", "Capital Highlight Color"],
    ["lblCityPointsOpacity", "Point Opacity"],
    ["lblCityPointLabelsEnabled", "Show City Labels"],
    ["lblCityPointsLabelSize", "Label Size"],
    ["lblTransportFacilityUnderlyingMapSelection", "Allow Underlying Map Selection"],
    ["lblAirportLabelSize", "Label Size"],
    ["lblAirportLabelHalo", "Label Halo"],
    ["lblPortLabelSize", "Label Size"],
    ["lblPortLabelHalo", "Label Halo"],
    ["lblCityCapitalOverlayEnabled", "Highlight Capitals"],
    ["lblDayNightPanel", "Day / Night"],
    ["lblDayNightEnabled", "Enable Day / Night Cycle"],
    ["lblDayNightMode", "Clock Mode"],
    ["optDayNightModeManual", "Manual UTC"],
    ["optDayNightModeUtc", "Live Computer UTC"],
    ["optDayNightModeCycle", "Continuous Cycle"],
    ["lblDayNightTime", "UTC Time"],
    ["dayNightSyncComputerUtcBtn", "Sync Computer UTC Time"],
    ["lblDayNightCycleSpeed", "Cycle Speed"],
    ["lblDayNightCityLights", "City Lights"],
    ["lblDayNightCityLightsStyle", "Style"],
    ["optDayNightCityLightsModern", "Modern"],
    ["optDayNightCityLightsHistorical1930s", "1930s Electrification Proxy"],
    ["lblDayNightCityLightsIntensity", "Intensity"],
    ["lblDayNightAdvanced", "Advanced"],
    ["lblDayNightTextureOpacity", "Texture Opacity (Modern only)"],
    ["lblDayNightCorridorStrength", "Corridor Strength (Modern only)"],
    ["lblDayNightCoreSharpness", "Core Sharpness (Modern only)"],
    ["lblDayNightHistoricalOnly", "Historical only"],
    ["lblDayNightHistoricalCityLightsDensity", "Historical Light Density"],
    ["lblDayNightHistoricalCityLightsSecondaryRetention", "Secondary City Retention"],
    ["lblDayNightShadowOpacity", "Shadow Opacity"],
    ["lblDayNightTwilightWidth", "Twilight Width"],
    ["lblRiversLayer", "Rivers"],
    ["lblRiversVisibilityGroup", "Visibility"],
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
    ["lblCountrySearch", "Search Countries"],
    ["lblWaterSearch", "Search Water Regions"],
    ["lblSpecialRegionSearch", "Search Special Regions"],
    ["lblPresetsHierarchy", "Territories & Presets"],
    ["lblCountryInspector", "Country Inspector"],
    ["lblWaterInspector", "Water Regions"],
    ["lblWaterInteraction", "Interaction"],
    ["lblWaterInspectorOpenOceanToggle", "Allow Open-Ocean Interaction"],
    ["lblWaterInspectorOpenOceanSelectToggle", "Allow Open-Ocean Selection"],
    ["waterInspectorOpenOceanSelectHint", "When off, macro ocean regions stay hidden from inspector selection and map picking."],
    ["waterInspectorOpenOceanSelectHintEnabled", "Macro ocean regions are currently available in the inspector and map picking."],
    ["lblWaterInspectorOpenOceanPaintToggle", "Allow Open-Ocean Paint"],
    ["waterInspectorOpenOceanPaintHint", "When off, macro ocean regions can be inspected but ignore paint, eraser, and eyedropper actions."],
    ["waterInspectorOpenOceanPaintHintEnabled", "Macro ocean regions currently accept paint, eraser, and eyedropper actions."],
    ["lblWaterFilters", "Filters"],
    ["lblWaterInspectorOverridesOnlyToggle", "Overrides Only"],
    ["lblWaterFilterType", "Type"],
    ["lblWaterFilterGroup", "Group"],
    ["lblWaterFilterSource", "Source"],
    ["lblWaterSort", "Sort"],
    ["lblWaterInspectorMeta", "Region Details"],
    ["lblWaterInspectorHierarchy", "Family"],
    ["lblWaterInspectorBatch", "Batch Actions"],
    ["lblWaterInspectorScope", "Apply Scope"],
    ["lblSpecialRegionInspector", "Special Regions"],
    ["lblScenarioSpecialRegionVisibility", "Visibility"],
    ["lblScenarioSpecialRegionVisibilityToggle", "Show Scenario Special Regions"],
    ["scenarioSpecialRegionVisibilityHint", "When off, scenario special regions are hidden and ignore hover, click, and paint."],
    ["scenarioSpecialRegionVisibilityHintEnabled", "Scenario special regions are currently visible and interactive."],
    ["lblScenarioReliefOverlayVisibilityToggle", "Show Scenario Relief Overlays"],
    ["scenarioReliefOverlayVisibilityHint", "When off, shoreline, basin contour, and texture overlays are hidden for the active scenario."],
    ["scenarioReliefOverlayVisibilityHintEnabled", "Scenario relief overlays are currently visible. Cached relief stays visible during pan and zoom, then redraws exactly after the view settles."],
    ["lblProjectLegend", "Project Management"],
    ["lblDiagnostics", "Diagnostics"],
    ["lblCountryColors", "Country Colors"],
    ["lblWaterLegend", "Water Overrides"],
    ["countryInspectorOrderingHint", "Key scenario countries first. Releasables appear under parent countries."],
    ["countryInspectorEmptyTitle", "Select a country to inspect"],
    ["countryInspectorEmptyHint", "Choose a country above, then use Active Owner and the Territories & Presets panel."],
    ["waterInspectorEmptyTitle", "Select a water region to inspect"],
    ["waterInspectorEmptyHint", "Click a sea, lake, or strait on the map, or choose one from the list."],
    ["waterInspectorResultCount", "regions"],
    ["specialRegionInspectorEmptyTitle", "Select a special region to inspect"],
    ["specialRegionInspectorEmptyHint", "Click a drained basin or exposure zone on the map, or choose one from the list."],
    ["resetCountryColors", "Reset Country Colors"],
    ["clearWaterRegionColorBtn", "Clear Water Override"],
    ["applyWaterFamilyOverrideBtn", "Apply Current Color To Scope"],
    ["clearWaterFamilyOverrideBtn", "Clear Scope Overrides"],
    ["waterInspectorJumpToParentBtn", "Jump To Parent"],
    ["clearSpecialRegionColorBtn", "Special Region Overrides Retired"],
    ["lblHistoricalPresets", "Selected Country Actions"],
    ["selectedCountryActionHint", "Choose a country above to inspect territories, presets, and releasables."],
    ["lblSpecialZones", "Special Zones"],
    ["lblSpecialZonesDisputedFill", "Disputed Fill"],
    ["lblSpecialZoneEditor", "Special Zone Editor"],
    ["Layer-based special zones are the canonical editor. Use the workbench below to create layers, choose presets, and edit memberships.", "Layer-based special zones are the canonical editor. Use the workbench below to create layers, choose presets, and edit memberships."],
    ["Layer-based special zones are the canonical editor. Use the workbench above to edit memberships.", "Layer-based special zones are the canonical editor. Use the workbench above to edit memberships."],
    ["No manual zones", "No manual zones"],
    ["Special zone layers workbench", "Special zone layers workbench"],
    ["Layer-based special zones", "Layer-based special zones"],
    ["Layers", "Layers"],
    ["layers", "layers"],
    ["active members", "active members"],
    ["Preset library", "Preset library"],
    ["Active layer", "Active layer"],
    ["Bulk actions and save", "Bulk actions and save"],
    ["Create a preset or custom layer to start editing map membership.", "Create a preset or custom layer to start editing map membership."],
    ["No active special zone layer.", "No active special zone layer."],
    ["No special zone layers yet.", "No special zone layers yet."],
    ["Edit map membership", "Edit map membership"],
    ["Exit membership tool", "Exit membership tool"],
    ["Membership tool active. Click a land tile to toggle it; Alt-click removes it.", "Membership tool active. Click a land tile to toggle it; Alt-click removes it."],
    ["Membership tool closed.", "Membership tool closed."],
    ["Add dev selection", "Add dev selection"],
    ["Replace with dev selection", "Replace with dev selection"],
    ["Country / owner id", "Country / owner id"],
    ["Add country / owner", "Add country / owner"],
    ["features added from country / owner filter.", "features added from country / owner filter."],
    ["Copy members from layer", "Copy members from layer"],
    ["Duplicate layer", "Duplicate layer"],
    ["Clear members", "Clear members"],
    ["Delete layer", "Delete layer"],
    ["Save scenario layer asset", "Save scenario layer asset"],
    ["Scenario special zone layers loaded. Review changes before saving.", "Scenario special zone layers loaded. Review changes before saving."],
    ["Special zones loaded", "Special zones loaded"],
    ["Scenario special zone layers saved.", "Scenario special zone layers saved."],
    ["Special zones saved", "Special zones saved"],
    ["Scenario layer asset save is available only in the local dev server.", "Scenario layer asset save is available only in the local dev server."],
    ["Read-only scenario asset", "Read-only scenario asset"],
    ["Use Layer-based special zones for new edits.", "Use Layer-based special zones for new edits."],
    ["Finish or cancel the current legacy drawing, then use Layer-based special zones.", "Finish or cancel the current legacy drawing, then use Layer-based special zones."],
    ["Layer-based special zones are the canonical editor. Use the workbench above to edit memberships.", "Layer-based special zones are the canonical editor. Use the workbench above to edit memberships."],
    ["lblProjectManagement", "Project Management"],
    ["downloadProjectBtn", "Download Project"],
    ["uploadProjectBtn", "Load Project"],
    ["lblProjectFile", "Selected File"],
    ["lblLegendProject", "Legend"],
    ["lblUtilities", "Utilities"],
    ["utilitiesGuideBtn", "Guide"],
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Open workbench"],
    ["referenceToolHint", "Upload a local image, align it with opacity / scale / offsets, then keep those alignment values in the project. The image file itself needs to be uploaded again when you restore the project."],
    ["lblExportTarget", "Target"],
    ["optExportTargetComposite", "Composite image"],
    ["optExportTargetPerLayer", "Per-layer PNG"],
    ["optExportTargetBakePack", "Bake pack (v1.1)"],
    ["inspectorSidebarTabInspector", "Inspector"],
    ["inspectorSidebarTabProject", "Project"],
    ["lblReferenceOpacity", "Opacity"],
    ["lblReferenceScale", "Scale"],
    ["lblReferenceOffsetX", "Offset X"],
    ["lblReferenceOffsetY", "Offset Y"],
    ["lblLegendEditor", "Legend Editor"],
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
    ["scenarioGuideCloseBtn", "Close"],
    ["transportWorkbenchInfoTitle", "Transport guide"],
  ];

  uiMap.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (el) {
      const localizedText = t(label, "ui");
      const semanticChild = typeof el.querySelector === "function"
        ? el.querySelector(":scope > .sidebar-anchor-title, :scope > .sidebar-section-title, :scope > .sidebar-support-title, :scope > .sidebar-appendix-title, :scope > .sidebar-tool-title")
        : null;
      if (semanticChild instanceof HTMLElement) {
        semanticChild.textContent = localizedText;
      } else {
        el.textContent = localizedText;
      }
    }
  });

  const uiAttributeMap = [
    ["zoomUtilityViewportGroup", "aria-label", "Viewport controls"],
    ["zoomUtilitySystemGroup", "aria-label", "System status"],
    ["zoomUtilityWorkspaceGroup", "aria-label", "Workspace entry"],
  ];

  uiAttributeMap.forEach(([id, attributeName, label]) => {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute(attributeName, t(label, "ui"));
    }
  });

  callRuntimeHooks(state, [
    "updateToolUIFn",
    "updateHistoryUIFn",
    "updateZoomUIFn",
    "updatePaintModeUIFn",
    "updateDevWorkspaceUIFn",
    "updateToolbarInputsFn",
    "updateTransportAppearanceUIFn",
    "updateFacilityInfoCardUiFn",
    "refreshSampleProjectBannerFn",
    "syncDeveloperModeUiFn",
  ]);

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
    const label = isOpen
      ? t("Hide Color Library", "ui")
      : t("Browse All Colors", "ui");
    paletteLibraryToggle.setAttribute("aria-label", label);
    paletteLibraryToggle.setAttribute("title", label);
    const toggleLabel = document.getElementById("paletteLibraryToggleLabel");
    if (toggleLabel) toggleLabel.textContent = label;
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
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Open workbench"],
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
  if (
    projectFileName
    && (
      !projectFileName.textContent.trim()
      || projectFileName.dataset?.projectFileState === "empty"
    )
  ) {
    if (projectFileName.dataset) projectFileName.dataset.projectFileState = "empty";
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
      "Select a region to start painting, or use Auto-Fill to color all countries",
      "ui"
    );
  }

  const referencePopover = document.getElementById("dockReferencePopover");
  if (referencePopover) {
    referencePopover.setAttribute("aria-label", t("Reference tools", "ui"));
  }

  const confirmableButtons = [
    ["resetCountryColors", "Reset Country Colors"],
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

  callRuntimeHooks(state, [
    "updateActiveSovereignUIFn",
    "updatePaintModeUIFn",
    "updateWorkspaceStatusFn",
    "refreshTransportWorkbenchUiFn",
    "refreshSampleProjectBannerFn",
    "updatePaletteLibraryUIFn",
    "updateScenarioUIFn",
    "renderScenarioAuditPanelFn",
  ]);
}

async function toggleLanguage() {
  const nextLang = runtimeState.currentLanguage === "zh" ? "en" : "zh";
  runtimeState.currentLanguage = nextLang;
  try {
    localStorage.setItem("map_lang", nextLang);
  } catch (error) {
    console.warn("Unable to persist language preference:", error);
  }
  try {
    await callRuntimeHook(state, "ensureFullLocalizationDataReadyFn", {
      reason: "language-toggle",
      renderNow: false,
    });
  } catch (error) {
    console.warn("Unable to hydrate full localization data before language toggle:", error);
  }
  // 语言切换分三段：先切 runtime language，再刷新现有 UI 文案，最后补 active scenario 的 geo locale patch。
  // 这样即使异步 locale 资源稍后到达，界面也能先用稳定回退链完成一次可见刷新。
  updateUIText();
  callRuntimeHook(state, "renderPaletteFn", runtimeState.currentPaletteTheme);
  callRuntimeHooks(state, [
    "updateToolbarInputsFn",
    "renderCountryListFn",
    "renderPresetTreeFn",
    "updateParentBorderCountryListFn",
    "updatePaintModeUIFn",
    "updateDevWorkspaceUIFn",
    "refreshSampleProjectBannerFn",
    "updateSpecialZoneEditorUIFn",
    "updateWaterInteractionUIFn",
    "renderWaterRegionListFn",
    "renderSpecialRegionListFn",
    "refreshProjectAccountLanguageFn",
  ]);
  try {
    const { ensureScenarioGeoLocalePatchForLanguage } = await import("../core/scenario_resources.js");
    if (typeof ensureScenarioGeoLocalePatchForLanguage === "function") {
      await ensureScenarioGeoLocalePatchForLanguage(nextLang, { renderNow: false });
    }
  } catch (error) {
    console.warn("Unable to refresh scenario geo locale patch for active language:", error);
  }
  callRuntimeHook(state, "renderNowFn");
}

function initTranslations() {
  updateUIText();
}

export {
  clearStartupSupportKeyUsageAuditReport,
  consumeStartupSupportKeyUsageAuditReport,
  getStartupSupportKeyUsageAuditReport,
  setStartupSupportKeyUsageAuditEnabled,
  t,
  initTranslations,
  toggleLanguage,
  updateUIText,
  applyDeclarativeTranslations,
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getGeoFeatureDisplayLabel,
  getTooltipCountryContext,
  buildTooltipModel,
  renderTooltipText,
  getTooltipText,
};
