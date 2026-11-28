import { callRuntimeHook } from "../../core/state/index.js";
import { ensureActiveScenarioOptionalLayerLoaded } from "../../core/scenario/scenario_resources.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import {
  normalizeTransportOverviewStyleConfig,
  resolveLinkedTransportOverviewScopeAndThreshold,
} from "../../core/state.js";
import {
  getTransportCapabilityDefaultOverviewConfig,
  getTransportOverviewDataLayerKeys,
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
  normalizeTransportOverviewVisualMode,
} from "../../core/transport_capability_registry.js";
import {
  buildTransportFamilySummaryText as buildTransportFamilySummaryTextForState,
  formatTransportPercent,
} from "./appearance_transport_summary.js";
import {
  setTransportFamilyVisibilityState,
  setTransportMasterVisibilityState,
} from "../../core/state/actions/transport_actions.js";

/**
 * Owns the Appearance panel transport controls: DOM sync, family toggles,
 * style mutations, and summary refresh batching.
 */
export function createTransportAppearanceController({
  runtimeState,
  t,
  clamp,
  renderDirty,
  normalizeOceanFillColor,
}) {
  const transportAppearanceMasterToggle = document.getElementById("transportAppearanceMasterToggle");
  const transportVisualMode = document.getElementById("transportVisualMode");
  const transportFacilityUnderlyingMapSelection = document.getElementById("transportFacilityUnderlyingMapSelection");
  const transportAirportCard = document.getElementById("transportAirportCard");
  const transportPortCard = document.getElementById("transportPortCard");
  const transportRailCard = document.getElementById("transportRailCard");
  const transportRoadCard = document.getElementById("transportRoadCard");
  const transportAirportControls = document.getElementById("transportAirportControls");
  const transportPortControls = document.getElementById("transportPortControls");
  const transportRailControls = document.getElementById("transportRailControls");
  const transportRoadControls = document.getElementById("transportRoadControls");
  const transportAirportSummaryMeta = document.getElementById("transportAirportSummaryMeta");
  const transportPortSummaryMeta = document.getElementById("transportPortSummaryMeta");
  const transportRailSummaryMeta = document.getElementById("transportRailSummaryMeta");
  const transportRoadSummaryMeta = document.getElementById("transportRoadSummaryMeta");

  const toggleAirports = document.getElementById("toggleAirports");
  const togglePorts = document.getElementById("togglePorts");
  const toggleEraRailways = document.getElementById("toggleEraRailways");
  const eraRailwaysToggleRow = document.getElementById("eraRailwaysToggleRow");

  // 启动剧本的 activeScenarioManifest 可能是启动包内嵌的子集，不含 era_railways_url；
  // 与可选图层加载器一致，以剧本 bundle 缓存里的完整 manifest 为准。
  function activeScenarioHasEraRailways() {
    const scenarioId = String(runtimeState.activeScenarioId || "").trim();
    return !!(runtimeState.scenarioEraRailwaysData
      || runtimeState.scenarioBundleCacheById?.[scenarioId]?.manifest?.era_railways_url
      || runtimeState.activeScenarioManifest?.era_railways_url);
  }
  const toggleRail = document.getElementById("toggleRail");
  const toggleRoad = document.getElementById("toggleRoad");

  const airportVisualStrength = document.getElementById("airportVisualStrength");
  const airportVisualStrengthValue = document.getElementById("airportVisualStrengthValue");
  const airportOpacity = document.getElementById("airportOpacity");
  const airportOpacityValue = document.getElementById("airportOpacityValue");
  const airportPrimaryColor = document.getElementById("airportPrimaryColor");
  const airportLabelsEnabled = document.getElementById("airportLabelsEnabled");
  const airportLabelDensity = document.getElementById("airportLabelDensity");
  const airportLabelMode = document.getElementById("airportLabelMode");
  const airportLabelSize = document.getElementById("airportLabelSize");
  const airportLabelSizeValue = document.getElementById("airportLabelSizeValue");
  const airportLabelHalo = document.getElementById("airportLabelHalo");
  const airportLabelHaloValue = document.getElementById("airportLabelHaloValue");
  const airportCoverageReach = document.getElementById("airportCoverageReach");
  const airportCoverageReachValue = document.getElementById("airportCoverageReachValue");
  const airportScopeLinked = document.getElementById("airportScopeLinked");
  const airportScope = document.getElementById("airportScope");
  const airportImportanceThreshold = document.getElementById("airportImportanceThreshold");

  const portVisualStrength = document.getElementById("portVisualStrength");
  const portVisualStrengthValue = document.getElementById("portVisualStrengthValue");
  const portOpacity = document.getElementById("portOpacity");
  const portOpacityValue = document.getElementById("portOpacityValue");
  const portPrimaryColor = document.getElementById("portPrimaryColor");
  const portLabelsEnabled = document.getElementById("portLabelsEnabled");
  const portLabelDensity = document.getElementById("portLabelDensity");
  const portLabelMode = document.getElementById("portLabelMode");
  const portLabelSize = document.getElementById("portLabelSize");
  const portLabelSizeValue = document.getElementById("portLabelSizeValue");
  const portLabelHalo = document.getElementById("portLabelHalo");
  const portLabelHaloValue = document.getElementById("portLabelHaloValue");
  const portCoverageReach = document.getElementById("portCoverageReach");
  const portCoverageReachValue = document.getElementById("portCoverageReachValue");
  const portScopeLinked = document.getElementById("portScopeLinked");
  const portTier = document.getElementById("portTier");
  const portImportanceThreshold = document.getElementById("portImportanceThreshold");

  const railVisualStrength = document.getElementById("railVisualStrength");
  const railVisualStrengthValue = document.getElementById("railVisualStrengthValue");
  const railOpacity = document.getElementById("railOpacity");
  const railOpacityValue = document.getElementById("railOpacityValue");
  const railPrimaryColor = document.getElementById("railPrimaryColor");
  const railLabelsEnabled = document.getElementById("railLabelsEnabled");
  const railLabelDensity = document.getElementById("railLabelDensity");
  const railCoverageReach = document.getElementById("railCoverageReach");
  const railCoverageReachValue = document.getElementById("railCoverageReachValue");
  const railScopeLinked = document.getElementById("railScopeLinked");
  const railScope = document.getElementById("railScope");
  const railImportanceThreshold = document.getElementById("railImportanceThreshold");

  const roadVisualStrength = document.getElementById("roadVisualStrength");
  const roadVisualStrengthValue = document.getElementById("roadVisualStrengthValue");
  const roadOpacity = document.getElementById("roadOpacity");
  const roadOpacityValue = document.getElementById("roadOpacityValue");
  const roadPrimaryColor = document.getElementById("roadPrimaryColor");
  const roadLabelsEnabled = document.getElementById("roadLabelsEnabled");
  const roadLabelDensity = document.getElementById("roadLabelDensity");
  const roadCoverageReach = document.getElementById("roadCoverageReach");
  const roadCoverageReachValue = document.getElementById("roadCoverageReachValue");
  const roadScopeLinked = document.getElementById("roadScopeLinked");
  const roadScope = document.getElementById("roadScope");
  const roadImportanceThreshold = document.getElementById("roadImportanceThreshold");

  const getTransportAppearanceConfig = () => {
    runtimeState.styleConfig.transportOverview = normalizeTransportOverviewStyleConfig(
      runtimeState.styleConfig?.transportOverview || {},
    );
    return runtimeState.styleConfig.transportOverview;
  };

  const getTransportAppearanceVisualMode = () => normalizeTransportOverviewVisualMode(
    getTransportAppearanceConfig().visualMode,
    "distribution",
  );

  const getTransportFamilyDefaults = (familyId) => (
    getTransportCapabilityDefaultOverviewConfig(familyId) || {}
  );

  const getTransportFamilyValue = (familyConfig, familyDefaults, key, fallback) => (
    familyConfig?.[key] ?? familyDefaults?.[key] ?? fallback
  );

  const scheduleTransportAppearanceFrame = (callback) => {
    const scheduleFrame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (frameCallback) => setTimeout(frameCallback, 0);
    return scheduleFrame(callback);
  };
  let transportAppearanceUiFrameId = 0;

  const getEffectiveTransportScopeState = (familyId, familyConfig) => (
    // linked 模式让 coverageReach 推导 scope/threshold；manual 模式保留用户显式选择。
    getTransportFamilyValue(familyConfig, getTransportFamilyDefaults(familyId), "scopeLinkMode", "linked") === "manual"
      ? {
        scope: String(getTransportFamilyValue(familyConfig, getTransportFamilyDefaults(familyId), "scope", "")).trim().toLowerCase(),
        importanceThreshold: String(getTransportFamilyValue(familyConfig, getTransportFamilyDefaults(familyId), "importanceThreshold", "")).trim().toLowerCase(),
      }
      : resolveLinkedTransportOverviewScopeAndThreshold(
        familyId,
        getTransportFamilyValue(familyConfig, getTransportFamilyDefaults(familyId), "coverageReach", 0.5),
      )
  );

  const buildTransportFamilySummaryText = (familyId, masterEnabled, familyEnabled, familyConfig, effectiveScope) =>
    buildTransportFamilySummaryTextForState({
      familyId,
      masterEnabled,
      familyEnabled,
      familyConfig,
      effectiveScope,
      collections: {
        airport: runtimeState.airportsData,
        port: runtimeState.portsData,
        rail: runtimeState.railwaysData,
        road: runtimeState.roadsData,
      },
      metrics: runtimeState.renderPerfMetrics,
      zoomScale: runtimeState.zoomTransform?.k,
      visualMode: getTransportAppearanceVisualMode(),
      translate: t,
    });

  const renderTransportAppearanceDirty = (reason) => {
    const normalizedReason = String(reason || "").trim();
    renderDirty(normalizedReason || "transport-appearance");
    if (transportAppearanceUiFrameId) return;
    transportAppearanceUiFrameId = scheduleTransportAppearanceFrame(() => {
      transportAppearanceUiFrameId = 0;
      renderTransportAppearanceUi();
    });
  };

  const refreshTransportAppearanceUiAfterLayerLoad = (layerId) => (error) => {
    console.warn(`[transport-appearance] Failed to refresh ${layerId} layer data.`, error);
    renderTransportAppearanceUi();
  };

  const getTransportOverviewDataLayerRequest = (familyId) => {
    const layerKeys = getTransportOverviewDataLayerKeys(familyId);
    if (layerKeys.length === 0) return null;
    // rail 这类 family 需要主线和站点等多个 layer 同波次加载，单项 family 继续传字符串。
    return layerKeys.length === 1 ? layerKeys[0] : layerKeys;
  };

  const requestTransportOverviewDataLayers = (familyId, reason, { renderNow = true } = {}) => {
    const layerRequest = getTransportOverviewDataLayerRequest(familyId);
    if (!layerRequest || typeof runtimeState.ensureContextLayerDataFn !== "function") return null;
    return runtimeState.ensureContextLayerDataFn(layerRequest, { reason, renderNow })
      .then(renderTransportAppearanceUi)
      .catch(refreshTransportAppearanceUiAfterLayerLoad(familyId));
  };

  const isTransportOverviewFamilyVisible = (familyId) => {
    const visibilityField = getTransportOverviewVisibilityField(familyId);
    return !!visibilityField && !!runtimeState[visibilityField];
  };

  const setTransportAppearanceGroupEnabled = (container, enabled) => {
    if (!(container instanceof HTMLElement)) return;
    container.classList.toggle("opacity-60", !enabled);
  };

  const renderTransportAppearanceUi = () => {
    const transportConfig = getTransportAppearanceConfig();
    const airportConfig = transportConfig.airport || {};
    const portConfig = transportConfig.port || {};
    const railConfig = transportConfig.rail || {};
    const roadConfig = transportConfig.road || {};
    const airportDefaults = getTransportFamilyDefaults("airport");
    const portDefaults = getTransportFamilyDefaults("port");
    const railDefaults = getTransportFamilyDefaults("rail");
    const roadDefaults = getTransportFamilyDefaults("road");
    const visualMode = normalizeTransportOverviewVisualMode(transportConfig.visualMode, "distribution");
    const transportEnabled = runtimeState.showTransport !== false;
    const airportScopeState = getEffectiveTransportScopeState("airport", airportConfig);
    const portScopeState = getEffectiveTransportScopeState("port", portConfig);
    const railScopeState = getEffectiveTransportScopeState("rail", railConfig);
    const roadScopeState = getEffectiveTransportScopeState("road", roadConfig);

    if (transportAppearanceMasterToggle) transportAppearanceMasterToggle.checked = transportEnabled;
    if (transportVisualMode) transportVisualMode.value = visualMode;
    if (transportFacilityUnderlyingMapSelection) {
      transportFacilityUnderlyingMapSelection.checked = !!transportConfig.allowFacilityUnderlyingMapSelection;
    }

    const airportVisualStrengthValueRaw = getTransportFamilyValue(airportConfig, airportDefaults, "visualStrength", 0.62);
    const airportOpacityValueRaw = getTransportFamilyValue(airportConfig, airportDefaults, "opacity", 0.82);
    const airportLabelSizeValueRaw = getTransportFamilyValue(airportConfig, airportDefaults, "labelSize", 9);
    const airportLabelHaloValueRaw = getTransportFamilyValue(airportConfig, airportDefaults, "labelHalo", 0.22);
    const airportCoverageReachValueRaw = getTransportFamilyValue(airportConfig, airportDefaults, "coverageReach", 0.38);
    if (airportVisualStrength) airportVisualStrength.value = String(Math.round(Number(airportVisualStrengthValueRaw) * 100));
    if (airportVisualStrengthValue) airportVisualStrengthValue.textContent = formatTransportPercent(airportVisualStrengthValueRaw);
    if (airportOpacity) airportOpacity.value = String(Math.round(Number(airportOpacityValueRaw) * 100));
    if (airportOpacityValue) airportOpacityValue.textContent = formatTransportPercent(airportOpacityValueRaw);
    if (airportPrimaryColor) airportPrimaryColor.value = normalizeOceanFillColor(getTransportFamilyValue(airportConfig, airportDefaults, "primaryColor", "#1d4ed8"));
    if (airportLabelsEnabled) airportLabelsEnabled.checked = !!getTransportFamilyValue(airportConfig, airportDefaults, "labelsEnabled", true);
    if (airportLabelDensity) airportLabelDensity.value = String(getTransportFamilyValue(airportConfig, airportDefaults, "labelDensity", "sparse"));
    if (airportLabelMode) airportLabelMode.value = String(getTransportFamilyValue(airportConfig, airportDefaults, "labelMode", "adaptive"));
    if (airportLabelSize) airportLabelSize.value = String(Math.round(Number(airportLabelSizeValueRaw)));
    if (airportLabelSizeValue) airportLabelSizeValue.textContent = `${Math.round(Number(airportLabelSizeValueRaw))}px`;
    if (airportLabelHalo) airportLabelHalo.value = String(Math.round(Number(airportLabelHaloValueRaw) * 100));
    if (airportLabelHaloValue) airportLabelHaloValue.textContent = formatTransportPercent(airportLabelHaloValueRaw);
    if (airportCoverageReach) airportCoverageReach.value = String(Math.round(Number(airportCoverageReachValueRaw) * 100));
    if (airportCoverageReachValue) airportCoverageReachValue.textContent = formatTransportPercent(airportCoverageReachValueRaw);
    if (airportScopeLinked) airportScopeLinked.checked = String(getTransportFamilyValue(airportConfig, airportDefaults, "scopeLinkMode", "linked")) !== "manual";
    if (airportScope) airportScope.value = airportScopeState.scope;
    if (airportImportanceThreshold) airportImportanceThreshold.value = airportScopeState.importanceThreshold;
    if (toggleAirports) toggleAirports.checked = !!runtimeState.showAirports;
    if (transportAirportSummaryMeta) {
      transportAirportSummaryMeta.textContent = buildTransportFamilySummaryText("airport", transportEnabled, !!runtimeState.showAirports, airportConfig, airportScopeState);
    }

    const portVisualStrengthValueRaw = getTransportFamilyValue(portConfig, portDefaults, "visualStrength", 0.58);
    const portOpacityValueRaw = getTransportFamilyValue(portConfig, portDefaults, "opacity", 0.78);
    const portLabelSizeValueRaw = getTransportFamilyValue(portConfig, portDefaults, "labelSize", 9);
    const portLabelHaloValueRaw = getTransportFamilyValue(portConfig, portDefaults, "labelHalo", 0.22);
    const portCoverageReachValueRaw = getTransportFamilyValue(portConfig, portDefaults, "coverageReach", 0.38);
    if (portVisualStrength) portVisualStrength.value = String(Math.round(Number(portVisualStrengthValueRaw) * 100));
    if (portVisualStrengthValue) portVisualStrengthValue.textContent = formatTransportPercent(portVisualStrengthValueRaw);
    if (portOpacity) portOpacity.value = String(Math.round(Number(portOpacityValueRaw) * 100));
    if (portOpacityValue) portOpacityValue.textContent = formatTransportPercent(portOpacityValueRaw);
    if (portPrimaryColor) portPrimaryColor.value = normalizeOceanFillColor(getTransportFamilyValue(portConfig, portDefaults, "primaryColor", "#b45309"));
    if (portLabelsEnabled) portLabelsEnabled.checked = !!getTransportFamilyValue(portConfig, portDefaults, "labelsEnabled", true);
    if (portLabelDensity) portLabelDensity.value = String(getTransportFamilyValue(portConfig, portDefaults, "labelDensity", "sparse"));
    if (portLabelMode) portLabelMode.value = String(getTransportFamilyValue(portConfig, portDefaults, "labelMode", "adaptive"));
    if (portLabelSize) portLabelSize.value = String(Math.round(Number(portLabelSizeValueRaw)));
    if (portLabelSizeValue) portLabelSizeValue.textContent = `${Math.round(Number(portLabelSizeValueRaw))}px`;
    if (portLabelHalo) portLabelHalo.value = String(Math.round(Number(portLabelHaloValueRaw) * 100));
    if (portLabelHaloValue) portLabelHaloValue.textContent = formatTransportPercent(portLabelHaloValueRaw);
    if (portCoverageReach) portCoverageReach.value = String(Math.round(Number(portCoverageReachValueRaw) * 100));
    if (portCoverageReachValue) portCoverageReachValue.textContent = formatTransportPercent(portCoverageReachValueRaw);
    if (portScopeLinked) portScopeLinked.checked = String(getTransportFamilyValue(portConfig, portDefaults, "scopeLinkMode", "linked")) !== "manual";
    if (portTier) portTier.value = portScopeState.scope;
    if (portImportanceThreshold) portImportanceThreshold.value = portScopeState.importanceThreshold;
    if (togglePorts) togglePorts.checked = !!runtimeState.showPorts;
    if (transportPortSummaryMeta) {
      transportPortSummaryMeta.textContent = buildTransportFamilySummaryText("port", transportEnabled, !!runtimeState.showPorts, portConfig, portScopeState);
    }

    const railVisualStrengthValueRaw = getTransportFamilyValue(railConfig, railDefaults, "visualStrength", 0.72);
    const railOpacityValueRaw = getTransportFamilyValue(railConfig, railDefaults, "opacity", 0.8);
    const railCoverageReachValueRaw = getTransportFamilyValue(railConfig, railDefaults, "coverageReach", 0.62);
    if (railVisualStrength) railVisualStrength.value = String(Math.round(Number(railVisualStrengthValueRaw) * 100));
    if (railVisualStrengthValue) railVisualStrengthValue.textContent = formatTransportPercent(railVisualStrengthValueRaw);
    if (railOpacity) railOpacity.value = String(Math.round(Number(railOpacityValueRaw) * 100));
    if (railOpacityValue) railOpacityValue.textContent = formatTransportPercent(railOpacityValueRaw);
    if (railPrimaryColor) railPrimaryColor.value = normalizeOceanFillColor(getTransportFamilyValue(railConfig, railDefaults, "primaryColor", "#0f172a"));
    if (railLabelsEnabled) railLabelsEnabled.checked = !!getTransportFamilyValue(railConfig, railDefaults, "labelsEnabled", false);
    if (railLabelDensity) railLabelDensity.value = String(getTransportFamilyValue(railConfig, railDefaults, "labelDensity", "sparse"));
    if (railCoverageReach) railCoverageReach.value = String(Math.round(Number(railCoverageReachValueRaw) * 100));
    if (railCoverageReachValue) railCoverageReachValue.textContent = formatTransportPercent(railCoverageReachValueRaw);
    if (railScopeLinked) railScopeLinked.checked = String(getTransportFamilyValue(railConfig, railDefaults, "scopeLinkMode", "linked")) !== "manual";
    if (railScope) railScope.value = railScopeState.scope;
    if (railImportanceThreshold) railImportanceThreshold.value = railScopeState.importanceThreshold;
    if (toggleEraRailways) toggleEraRailways.checked = runtimeState.showEraRailways !== false;
    if (eraRailwaysToggleRow) eraRailwaysToggleRow.hidden = !activeScenarioHasEraRailways();
    if (toggleRail) toggleRail.checked = !!runtimeState.showRail;
    if (transportRailSummaryMeta) {
      transportRailSummaryMeta.textContent = buildTransportFamilySummaryText("rail", transportEnabled, !!runtimeState.showRail, railConfig, railScopeState);
    }

    const roadVisualStrengthValueRaw = getTransportFamilyValue(roadConfig, roadDefaults, "visualStrength", 0.76);
    const roadOpacityValueRaw = getTransportFamilyValue(roadConfig, roadDefaults, "opacity", 0.84);
    const roadCoverageReachValueRaw = getTransportFamilyValue(roadConfig, roadDefaults, "coverageReach", 0.62);
    if (roadVisualStrength) roadVisualStrength.value = String(Math.round(Number(roadVisualStrengthValueRaw) * 100));
    if (roadVisualStrengthValue) roadVisualStrengthValue.textContent = formatTransportPercent(roadVisualStrengthValueRaw);
    if (roadOpacity) roadOpacity.value = String(Math.round(Number(roadOpacityValueRaw) * 100));
    if (roadOpacityValue) roadOpacityValue.textContent = formatTransportPercent(roadOpacityValueRaw);
    if (roadPrimaryColor) roadPrimaryColor.value = normalizeOceanFillColor(getTransportFamilyValue(roadConfig, roadDefaults, "primaryColor", "#374151"));
    if (roadLabelsEnabled) roadLabelsEnabled.checked = !!getTransportFamilyValue(roadConfig, roadDefaults, "labelsEnabled", false);
    if (roadLabelDensity) roadLabelDensity.value = String(getTransportFamilyValue(roadConfig, roadDefaults, "labelDensity", "sparse"));
    if (roadCoverageReach) roadCoverageReach.value = String(Math.round(Number(roadCoverageReachValueRaw) * 100));
    if (roadCoverageReachValue) roadCoverageReachValue.textContent = formatTransportPercent(roadCoverageReachValueRaw);
    if (roadScopeLinked) roadScopeLinked.checked = String(getTransportFamilyValue(roadConfig, roadDefaults, "scopeLinkMode", "linked")) !== "manual";
    if (roadScope) roadScope.value = roadScopeState.scope;
    if (roadImportanceThreshold) roadImportanceThreshold.value = roadScopeState.importanceThreshold;
    if (toggleRoad) toggleRoad.checked = !!runtimeState.showRoad;
    if (transportRoadSummaryMeta) {
      transportRoadSummaryMeta.textContent = buildTransportFamilySummaryText("road", transportEnabled, !!runtimeState.showRoad, roadConfig, roadScopeState);
    }

    [
      airportVisualStrength, airportOpacity, airportPrimaryColor, airportLabelsEnabled, airportLabelDensity,
      airportLabelMode, airportLabelSize, airportLabelHalo, airportScopeLinked, airportScope, airportImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      portVisualStrength, portOpacity, portPrimaryColor, portLabelsEnabled, portLabelDensity,
      portLabelMode, portLabelSize, portLabelHalo, portScopeLinked, portTier, portImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      railVisualStrength, railOpacity, railPrimaryColor, railLabelsEnabled, railLabelDensity,
      railScopeLinked, railScope, railImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [
      roadVisualStrength, roadOpacity, roadPrimaryColor, roadLabelsEnabled, roadLabelDensity,
      roadScopeLinked, roadScope, roadImportanceThreshold,
    ].forEach((control) => { if (control) control.disabled = !transportEnabled; });
    [toggleAirports, togglePorts, toggleRail, toggleRoad].forEach((control) => {
      if (control) control.disabled = false;
    });
    if (transportVisualMode) transportVisualMode.disabled = !transportEnabled;
    if (transportFacilityUnderlyingMapSelection) transportFacilityUnderlyingMapSelection.disabled = !transportEnabled;

    const airportManual = String(airportConfig.scopeLinkMode || "linked") === "manual";
    const portManual = String(portConfig.scopeLinkMode || "linked") === "manual";
    const railManual = String(railConfig.scopeLinkMode || "linked") === "manual";
    const roadManual = String(roadConfig.scopeLinkMode || "linked") === "manual";
    if (airportCoverageReach) airportCoverageReach.disabled = !transportEnabled || airportManual;
    if (airportScope) airportScope.disabled = !transportEnabled || !airportManual;
    if (airportImportanceThreshold) airportImportanceThreshold.disabled = !transportEnabled || !airportManual;
    if (portCoverageReach) portCoverageReach.disabled = !transportEnabled || portManual;
    if (portTier) portTier.disabled = !transportEnabled || !portManual;
    if (portImportanceThreshold) portImportanceThreshold.disabled = !transportEnabled || !portManual;
    if (railCoverageReach) railCoverageReach.disabled = !transportEnabled || railManual;
    if (railScope) railScope.disabled = !transportEnabled || !railManual;
    if (railImportanceThreshold) railImportanceThreshold.disabled = !transportEnabled || !railManual;
    if (roadCoverageReach) roadCoverageReach.disabled = !transportEnabled || roadManual;
    if (roadScope) roadScope.disabled = !transportEnabled || !roadManual;
    if (roadImportanceThreshold) roadImportanceThreshold.disabled = !transportEnabled || !roadManual;

    setTransportAppearanceGroupEnabled(transportAirportControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportPortControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportRailControls, transportEnabled);
    setTransportAppearanceGroupEnabled(transportRoadControls, transportEnabled);

    transportAirportCard?.classList.toggle("opacity-60", !transportEnabled);
    transportPortCard?.classList.toggle("opacity-60", !transportEnabled);
    transportRailCard?.classList.toggle("opacity-60", !transportEnabled);
    transportRoadCard?.classList.toggle("opacity-60", !transportEnabled);
    callRuntimeHook(runtimeState, "syncFacilityInfoCardVisibilityFn");
  };

  const applyTransportAppearanceMasterToggle = (nextEnabled) => {
    const normalized = !!nextEnabled;
    if ((runtimeState.showTransport !== false) === normalized) {
      renderTransportAppearanceUi();
      return;
    }
    setTransportMasterVisibilityState(runtimeState, normalized);
    if (normalized && hasVisibleTransportFamily()) {
      callRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", "transport-master-toggle");
    }
    if (normalized) {
      for (const familyId of listTransportOverviewCapabilityFamilyIds()) {
        if (isTransportOverviewFamilyVisible(familyId)) {
          void requestTransportOverviewDataLayers(familyId, "transport-master-toggle");
        }
      }
    }
    renderTransportAppearanceDirty("toggle-transport-overview");
  };

  const releaseDeferredContextForTransportToggle = (reason) => {
    callRuntimeHook(runtimeState, "releaseDeferredContextBasePassFn", reason);
  };

  const hasVisibleTransportFamily = () => (
    listTransportOverviewCapabilityFamilyIds().some((familyId) => isTransportOverviewFamilyVisible(familyId))
  );

  const bindEvents = () => {
    if (transportAppearanceMasterToggle && !transportAppearanceMasterToggle.dataset.bound) {
      transportAppearanceMasterToggle.addEventListener("change", (event) => {
        applyTransportAppearanceMasterToggle(!!event.target.checked);
      });
      transportAppearanceMasterToggle.dataset.bound = "true";
    }

    if (transportVisualMode && !transportVisualMode.dataset.bound) {
      transportVisualMode.addEventListener("change", (event) => {
        getTransportAppearanceConfig().visualMode = normalizeTransportOverviewVisualMode(
          event.target.value || "distribution",
          "distribution",
        );
        renderTransportAppearanceDirty("transport-visual-mode");
      });
      transportVisualMode.dataset.bound = "true";
    }
    if (transportFacilityUnderlyingMapSelection && !transportFacilityUnderlyingMapSelection.dataset.bound) {
      transportFacilityUnderlyingMapSelection.addEventListener("change", (event) => {
        getTransportAppearanceConfig().allowFacilityUnderlyingMapSelection = !!event.target.checked;
        renderTransportAppearanceDirty("transport-facility-underlying-selection");
      });
      transportFacilityUnderlyingMapSelection.dataset.bound = "true";
    }

    // 以下 family toggle 同时承担可见性、context layer 加载和 summary 刷新的提交边界。
    if (toggleAirports && !toggleAirports.dataset.bound) {
      toggleAirports.checked = !!runtimeState.showAirports;
      toggleAirports.addEventListener("change", (event) => {
        setTransportFamilyVisibilityState(runtimeState, "airport", event.target.checked);
        if (runtimeState.showAirports) {
          releaseDeferredContextForTransportToggle("toggle-airports");
        }
        if (runtimeState.showAirports) {
          void requestTransportOverviewDataLayers("airport", "toolbar-toggle");
        }
        renderTransportAppearanceDirty("toggle-airports");
      });
      toggleAirports.dataset.bound = "true";
    }

    if (togglePorts && !togglePorts.dataset.bound) {
      togglePorts.checked = !!runtimeState.showPorts;
      togglePorts.addEventListener("change", (event) => {
        setTransportFamilyVisibilityState(runtimeState, "port", event.target.checked);
        if (runtimeState.showPorts) {
          releaseDeferredContextForTransportToggle("toggle-ports");
        }
        if (runtimeState.showPorts) {
          void requestTransportOverviewDataLayers("port", "toolbar-toggle");
        }
        renderTransportAppearanceDirty("toggle-ports");
      });
      togglePorts.dataset.bound = "true";
    }

    if (toggleEraRailways && !toggleEraRailways.dataset.bound) {
      toggleEraRailways.addEventListener("change", (event) => {
        setAppearanceVisibilityState(runtimeState, "showEraRailways", event.target.checked);
        if (runtimeState.showEraRailways) {
          setAppearanceVisibilityState(runtimeState, "showTransport", true);
          releaseDeferredContextForTransportToggle("toggle-era-railways");
          void ensureActiveScenarioOptionalLayerLoaded("erarailways", { renderNow: true });
        }
        renderTransportAppearanceDirty("toggle-era-railways");
      });
      toggleEraRailways.dataset.bound = "true";
    }

    if (toggleRail && !toggleRail.dataset.bound) {
      toggleRail.checked = !!runtimeState.showRail;
      toggleRail.addEventListener("change", (event) => {
        setTransportFamilyVisibilityState(runtimeState, "rail", event.target.checked);
        if (runtimeState.showRail) {
          releaseDeferredContextForTransportToggle("toggle-rail");
        }
        if (runtimeState.showRail) {
          void requestTransportOverviewDataLayers("rail", "toolbar-toggle");
        }
        renderTransportAppearanceDirty("toggle-rail");
      });
      toggleRail.dataset.bound = "true";
    }

    if (toggleRoad && !toggleRoad.dataset.bound) {
      toggleRoad.checked = !!runtimeState.showRoad;
      toggleRoad.addEventListener("change", (event) => {
        setTransportFamilyVisibilityState(runtimeState, "road", event.target.checked);
        if (runtimeState.showRoad) {
          releaseDeferredContextForTransportToggle("toggle-road");
        }
        if (runtimeState.showRoad) {
          void requestTransportOverviewDataLayers("road", "toolbar-toggle");
        }
        renderTransportAppearanceDirty("toggle-road");
      });
      toggleRoad.dataset.bound = "true";
    }

    const bindInput = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("input", (event) => {
        mutate(event);
        renderTransportAppearanceDirty(reason);
      });
      element.dataset.bound = "true";
    };
    const bindChange = (element, mutate, reason) => {
      if (!element || element.dataset.bound === "true") return;
      element.addEventListener("change", (event) => {
        mutate(event);
        renderTransportAppearanceDirty(reason);
      });
      element.dataset.bound = "true";
    };
    function bindFamily(family, controls) {
      const defaults = getTransportFamilyDefaults(family);
      const getConfig = () => getTransportAppearanceConfig()[family];
      const applyLinkedScope = (config) => {
        const linked = resolveLinkedTransportOverviewScopeAndThreshold(family, config.coverageReach);
        config.scope = linked.scope;
        config.importanceThreshold = linked.importanceThreshold;
      };

      bindInput(controls.visualStrength, (event) => {
        const value = Number(event.target.value);
        getConfig().visualStrength = clamp(Number.isFinite(value) ? value / 100 : defaults.visualStrength, 0, 1);
      }, `transport-${family}-visual-strength`);
      bindInput(controls.opacity, (event) => {
        const value = Number(event.target.value);
        getConfig().opacity = clamp(Number.isFinite(value) ? value / 100 : defaults.opacity, 0.2, 1);
      }, `transport-${family}-opacity`);
      bindInput(controls.primaryColor, (event) => {
        getConfig().primaryColor = normalizeOceanFillColor(event.target.value || defaults.primaryColor);
      }, `transport-${family}-primary-color`);
      bindChange(controls.labelsEnabled, (event) => {
        getConfig().labelsEnabled = !!event.target.checked;
      }, `transport-${family}-labels-enabled`);
      bindChange(controls.labelDensity, (event) => {
        getConfig().labelDensity = String(event.target.value || defaults.labelDensity);
      }, `transport-${family}-label-density`);
      bindChange(controls.labelMode, (event) => {
        getConfig().labelMode = String(event.target.value || defaults.labelMode);
      }, `transport-${family}-label-mode`);
      bindInput(controls.labelSize, (event) => {
        const value = Number(event.target.value);
        const labelSize = clamp(Math.round(Number.isFinite(value) ? value : defaults.labelSize), 7, 16);
        getConfig().labelSize = labelSize;
        if (controls.labelSizeValue) controls.labelSizeValue.textContent = `${labelSize}px`;
      }, `transport-${family}-label-size`);
      bindInput(controls.labelHalo, (event) => {
        const value = Number(event.target.value);
        const labelHalo = clamp(Number.isFinite(value) ? value / 100 : defaults.labelHalo, 0, 1);
        getConfig().labelHalo = labelHalo;
        if (controls.labelHaloValue) controls.labelHaloValue.textContent = formatTransportPercent(labelHalo);
      }, `transport-${family}-label-halo`);
      bindInput(controls.coverageReach, (event) => {
        const value = Number(event.target.value);
        const config = getConfig();
        config.coverageReach = clamp(Number.isFinite(value) ? value / 100 : defaults.coverageReach, 0, 1);
        if (String(config.scopeLinkMode || "linked") !== "manual") {
          applyLinkedScope(config);
        }
      }, `transport-${family}-coverage-reach`);
      bindChange(controls.scopeLinked, (event) => {
        const config = getConfig();
        config.scopeLinkMode = event.target.checked ? "linked" : "manual";
        if (config.scopeLinkMode === "linked") {
          applyLinkedScope(config);
        }
      }, `transport-${family}-scope-link`);
      bindChange(controls.scope, (event) => {
        const config = getConfig();
        config.scopeLinkMode = "manual";
        config.scope = String(event.target.value || defaults.scope);
      }, `transport-${family}-scope`);
      bindChange(controls.importanceThreshold, (event) => {
        const config = getConfig();
        config.scopeLinkMode = "manual";
        config.importanceThreshold = String(event.target.value || defaults.importanceThreshold);
      }, `transport-${family}-importance-threshold`);
    }

    bindFamily("airport", {
      visualStrength: airportVisualStrength, opacity: airportOpacity,
      primaryColor: airportPrimaryColor, labelsEnabled: airportLabelsEnabled,
      labelDensity: airportLabelDensity,
      labelMode: airportLabelMode,
      labelSize: airportLabelSize, labelSizeValue: airportLabelSizeValue,
      labelHalo: airportLabelHalo, labelHaloValue: airportLabelHaloValue,
      coverageReach: airportCoverageReach, scopeLinked: airportScopeLinked,
      scope: airportScope, importanceThreshold: airportImportanceThreshold,
    });

    bindFamily("port", {
      visualStrength: portVisualStrength, opacity: portOpacity,
      primaryColor: portPrimaryColor, labelsEnabled: portLabelsEnabled,
      labelDensity: portLabelDensity,
      labelMode: portLabelMode,
      labelSize: portLabelSize, labelSizeValue: portLabelSizeValue,
      labelHalo: portLabelHalo, labelHaloValue: portLabelHaloValue,
      coverageReach: portCoverageReach, scopeLinked: portScopeLinked,
      scope: portTier, importanceThreshold: portImportanceThreshold,
    });

    bindFamily("rail", {
      visualStrength: railVisualStrength, opacity: railOpacity,
      primaryColor: railPrimaryColor, labelsEnabled: railLabelsEnabled,
      labelDensity: railLabelDensity,
      coverageReach: railCoverageReach, scopeLinked: railScopeLinked,
      scope: railScope, importanceThreshold: railImportanceThreshold,
    });

    bindFamily("road", {
      visualStrength: roadVisualStrength, opacity: roadOpacity,
      primaryColor: roadPrimaryColor, labelsEnabled: roadLabelsEnabled,
      labelDensity: roadLabelDensity,
      coverageReach: roadCoverageReach, scopeLinked: roadScopeLinked,
      scope: roadScope, importanceThreshold: roadImportanceThreshold,
    });

  };

  return {
    bindEvents,
    renderTransportAppearanceUi,
  };
}
