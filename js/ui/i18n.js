// Translation helpers (Phase 13)
import { state as runtimeState } from "../core/state.js";
import { callRuntimeHook, callRuntimeHooks } from "../core/state/index.js";
import { UI_COPY_CATALOG } from "./i18n_catalog.js";
import { normalizeCountryCodeAlias } from "../core/country_code_aliases.js";
import { getScenarioCountryDisplayName } from "../core/scenario_country_display.js";
const state = runtimeState;

const US_LEGACY_ZONE_LABEL_RE = /(?:\bZone\s+\d+\b|第?\s*\d+\s*[区號号])/i;
const STARTUP_SUPPORT_AUDIT_PARAM = "startup_support_audit";
let startupSupportKeyUsageAuditEnabled = null;
let startupSupportKeyUsageAuditState = null;

function shouldCaptureStartupSupportKeyUsage() {
  if (startupSupportKeyUsageAuditEnabled !== null) {
    return startupSupportKeyUsageAuditEnabled;
  }
  try {
    const params = new URLSearchParams(globalThis.location?.search || "");
    const raw = String(params.get(STARTUP_SUPPORT_AUDIT_PARAM) || "").trim().toLowerCase();
    startupSupportKeyUsageAuditEnabled = ["1", "true", "yes", "on"].includes(raw);
  } catch (_error) {
    startupSupportKeyUsageAuditEnabled = false;
  }
  return startupSupportKeyUsageAuditEnabled;
}

function getStartupSupportKeyUsageAuditState() {
  if (!shouldCaptureStartupSupportKeyUsage()) {
    return null;
  }
  if (!startupSupportKeyUsageAuditState) {
    startupSupportKeyUsageAuditState = {
      queryKeys: new Set(),
      directLocaleKeys: new Set(),
      aliasKeys: new Set(),
      aliasTargetKeys: new Set(),
      missKeys: new Set(),
    };
  }
  return startupSupportKeyUsageAuditState;
}

function recordStartupSupportKeyUsage({
  queryKey = "",
  directLocaleKey = "",
  aliasKey = "",
  aliasTargetKey = "",
  miss = false,
} = {}) {
  const auditState = getStartupSupportKeyUsageAuditState();
  if (!auditState) return;
  const normalizedQueryKey = String(queryKey || "").trim();
  if (normalizedQueryKey) {
    auditState.queryKeys.add(normalizedQueryKey);
  }
  const normalizedDirectLocaleKey = String(directLocaleKey || "").trim();
  if (normalizedDirectLocaleKey) {
    auditState.directLocaleKeys.add(normalizedDirectLocaleKey);
  }
  const normalizedAliasKey = String(aliasKey || "").trim();
  if (normalizedAliasKey) {
    auditState.aliasKeys.add(normalizedAliasKey);
  }
  const normalizedAliasTargetKey = String(aliasTargetKey || "").trim();
  if (normalizedAliasTargetKey) {
    auditState.aliasTargetKeys.add(normalizedAliasTargetKey);
  }
  if (miss && normalizedQueryKey) {
    auditState.missKeys.add(normalizedQueryKey);
  }
}

function resolveGeoLocaleEntry(key) {
  const candidate = String(key || "").trim();
  const geoLocales = runtimeState.locales?.geo || {};
  if (geoLocales[candidate]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      directLocaleKey: candidate,
    });
    return geoLocales[candidate];
  }

  const stableKey = runtimeState.geoAliasToStableKey?.[candidate];
  if (stableKey && geoLocales[stableKey]) {
    recordStartupSupportKeyUsage({
      queryKey: candidate,
      aliasKey: candidate,
      aliasTargetKey: stableKey,
    });
    return geoLocales[stableKey];
  }
  recordStartupSupportKeyUsage({
    queryKey: candidate,
    miss: true,
  });
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
  const preferred = runtimeState.currentLanguage === "zh" ? entry.zh : entry.en;
  const secondary = runtimeState.currentLanguage === "zh" ? entry.en : entry.zh;
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
  const scenarioGeo = runtimeState.scenarioGeoLocalePatchData?.geo;
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

function isUsFeature(feature) {
  const props = feature?.properties || {};
  const featureId = String(props.id || feature?.id || "").trim();
  const countryCode = String(props.cntr_code || "").trim().toUpperCase();
  return countryCode === "US" || featureId.startsWith("US_");
}

function isUsLegacyZoneLabel(text) {
  return US_LEGACY_ZONE_LABEL_RE.test(String(text || "").trim());
}

function getGeoFeatureDisplayLabel(feature, fallback = "") {
  const props = feature?.properties || {};
  const rawNameCandidates = [
    props.label,
    props.name,
    props.name_en,
    props.NAME,
  ];
  const canonicalRawName = String(
    rawNameCandidates.find((value) => String(value || "").trim()) || ""
  ).trim();
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
  const shouldBypassUsLegacyZoneLabel = (
    explicitLabel
    && isUsFeature(feature)
    && canonicalRawName
    && !isUsLegacyZoneLabel(canonicalRawName)
    && isUsLegacyZoneLabel(explicitLabel)
  );
  if (explicitLabel && !shouldBypassUsLegacyZoneLabel) {
    return explicitLabel;
  }

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
  const entry = type === "geo" ? resolveGeoLocaleEntry(key) : runtimeState.locales?.[type]?.[key];
  const lang = runtimeState.currentLanguage === "zh" ? "zh" : "en";
  if (entry?.[lang] || entry?.en) {
    return entry?.[lang] || entry?.en || key;
  }
  if (type !== "geo") {
    const inlineEntry = UI_COPY_CATALOG[key];
    if (inlineEntry?.[lang] || inlineEntry?.en) {
      return inlineEntry?.[lang] || inlineEntry?.en || key;
    }
  }
  return key;
}

function applyDeclarativeTranslationToElement(element) {
  if (!element?.getAttribute) return;

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
    ["lblOceanCoastalAccent", "Coastal Accent"],
    ["oceanCoastalAccentHint", "Available only in the TNO 1962 scenario."],
    ["lblOceanAdvancedStylesToggle", "Experimental Bathymetry"],
    ["oceanAdvancedStylesHint", "Enable data-driven bathymetry presets for testing. May reduce pan and zoom performance."],
    ["lblOceanStyle", "Style"],
    ["optOceanFlat", "Flat Blue"],
    ["optOceanBathymetrySoft", "Bathymetry Soft"],
    ["optOceanBathymetryContours", "Bathymetry Contours"],
    ["oceanStylePresetHint", "Flat Blue keeps the ocean fill clean with no bathymetry overlay."],
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
    ["lblPhysicalPanel", "Physical Regions"],
    ["lblPhysicalLayer", "Physical Regions"],
    ["lblPhysicalPreset", "Visual Preset"],
    ["optPhysicalPresetPoliticalClean", "Political Clean"],
    ["optPhysicalPresetBalanced", "Balanced"],
    ["optPhysicalPresetTerrainRich", "Terrain Rich"],
    ["physicalPresetHint", "Balanced keeps terrain visible while staying cleaner over political fills."],
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
    ["lblCityPointsPresetDensityGroup", "Preset & Density"],
    ["cityPointsPresetDensityGroupHint", "Choose a restrained map treatment first, then tune how many point markers and labels are allowed to surface."],
    ["lblCityPointsStylePreset", "Style Preset"],
    ["optCityPointsThemeClassicGraphite", "Classic Graphite"],
    ["optCityPointsThemeAtlasInk", "Atlas Ink"],
    ["optCityPointsThemeParchmentSepia", "Parchment Sepia"],
    ["optCityPointsThemeSlateBlue", "Slate Blue"],
    ["optCityPointsThemeIvoryOutline", "Ivory Outline"],
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
    ["waterInspectorResultCount", "regions"],
    ["specialRegionInspectorEmptyTitle", "Select a special region to inspect"],
    ["specialRegionInspectorEmptyHint", "Click a drained basin or exposure zone on the map, or choose one from the list."],
    ["resetCountryColors", "Reset Country Colors"],
    ["clearWaterRegionColorBtn", "Clear Water Override"],
    ["applyWaterFamilyOverrideBtn", "Apply Current Color To Scope"],
    ["clearWaterFamilyOverrideBtn", "Clear Scope Overrides"],
    ["waterInspectorJumpToParentBtn", "Jump To Parent"],
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
    ["lblProjectHint", "Save the current map state as a project file or restore one from disk. Loading a project replaces the current working state, and the app asks before continuing when the saved scenario baseline differs from the current assets."],
    ["downloadProjectBtn", "Download Project"],
    ["uploadProjectBtn", "Load Project"],
    ["lblProjectFile", "Selected File"],
    ["lblUtilities", "Utilities"],
    ["utilitiesGuideBtn", "Guide"],
    ["dockReferenceBtn", "Reference"],
    ["dockExportBtn", "Open workbench"],
    ["scenarioGuideSupportHint", "Open this manual from the scenario bar or the Utilities panel. Both Guide buttons open the same help surface, so you can keep the next editing step visible while you work."],
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
    ["lblLegendHint", "Paint the map first, then rename each color entry here. Empty names clear the label, and the current legend list is kept inside this working session."],
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
    ["zoomResetBtn", "Fit"],
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

  const confirmableButtons = [
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

  callRuntimeHooks(state, [
    "updateActiveSovereignUIFn",
    "updatePaintModeUIFn",
    "updateWorkspaceStatusFn",
    "refreshTransportWorkbenchUiFn",
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
  updateUIText();
  callRuntimeHooks(state, [
    "updateToolbarInputsFn",
    "renderCountryListFn",
    "renderPresetTreeFn",
    "updateParentBorderCountryListFn",
    "updatePaintModeUIFn",
    "updateDevWorkspaceUIFn",
    "updateSpecialZoneEditorUIFn",
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
  const scenarioBaselineCode = runtimeState.activeScenarioId
    ? normalizeTooltipCountryCode(runtimeState.scenarioBaselineOwnersByFeatureId?.[featureId] || "")
    : "";
  const countryCode = scenarioBaselineCode || getTooltipFeatureCountryCode(feature);
  const rawCountryName =
    getScenarioCountryDisplayName(runtimeState.scenarioCountriesByTag?.[countryCode]) ||
    runtimeState.countryNames?.[countryCode] ||
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
  const label = runtimeState.currentLanguage === "zh" ? t(labelKey, "ui") : labelKey;
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

function consumeStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  startupSupportKeyUsageAuditState = null;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(runtimeState.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(runtimeState.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function getStartupSupportKeyUsageAuditReport() {
  const auditState = startupSupportKeyUsageAuditState;
  if (!auditState) {
    return null;
  }
  return {
    enabled: true,
    language: String(runtimeState.currentLanguage || "en").trim() || "en",
    baseLocalizationLevel: String(runtimeState.baseLocalizationLevel || "").trim(),
    queryKeys: Array.from(auditState.queryKeys).sort(),
    directLocaleKeys: Array.from(auditState.directLocaleKeys).sort(),
    aliasKeys: Array.from(auditState.aliasKeys).sort(),
    aliasTargetKeys: Array.from(auditState.aliasTargetKeys).sort(),
    missKeys: Array.from(auditState.missKeys).sort(),
  };
}

function clearStartupSupportKeyUsageAuditReport() {
  startupSupportKeyUsageAuditState = null;
}

export {
  clearStartupSupportKeyUsageAuditReport,
  consumeStartupSupportKeyUsageAuditReport,
  getStartupSupportKeyUsageAuditReport,
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


