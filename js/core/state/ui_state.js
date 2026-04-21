// UI state defaults.
// 这里收口 overlay dirty 标记、可见性开关、workbench UI 和样式配置，
// 避免 state.js 与 UI reset 路径再维护第二份默认 shape。

import {
  createDefaultAnnotationView,
  createDefaultCityLayerStyleConfig,
  createDefaultDayNightStyleConfig,
  createDefaultLakeStyleConfig,
  createDefaultPhysicalStyleConfig,
  createDefaultTextureStyleConfig,
  createDefaultTransportOverviewStyleConfig,
  createDefaultTransportWorkbenchDisplayConfigs,
  createDefaultUrbanStyleConfig,
  defaultZoom,
  normalizeExportWorkbenchUiState,
} from "../state_defaults.js";

export function createDefaultManualSpecialZonesState() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function createDefaultTransportWorkbenchUiState() {
  return {
    open: false,
    activeFamily: "road",
    activeInspectorTab: "inspect",
    sampleCountry: "Japan",
    previewMode: "bounded_zoom_pan",
    previewAssetId: "japan_carrier_v3",
    previewInteractionMode: "bounded_zoom_pan",
    previewCamera: {
      scale: 1,
      translateX: 0,
      translateY: 0,
    },
    compareHeld: false,
    layerOrder: [
      "road",
      "rail",
      "airport",
      "port",
      "mineral_resources",
      "energy_facilities",
      "industrial_zones",
      "logistics_hubs",
    ],
    familyConfigs: {
      road: {},
      rail: {},
      airport: {},
      port: {},
      mineral_resources: {},
      energy_facilities: {},
      industrial_zones: {},
      logistics_hubs: {},
    },
    displayConfigs: createDefaultTransportWorkbenchDisplayConfigs(),
    sectionOpen: {
      road: {},
      rail: {},
      airport: {},
      port: {},
      mineral_resources: {},
      energy_facilities: {},
      industrial_zones: {},
      logistics_hubs: {},
    },
    shellPhase: "road-live-preview",
    restoreLeftDrawer: false,
    restoreRightDrawer: false,
  };
}

export function createDefaultReferenceImageState() {
  return {
    opacity: 0.6,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function createDefaultStyleConfig() {
  return {
    internalBorders: {
      color: "#cccccc",
      colorMode: "auto",
      opacity: 1,
      width: 0.5,
    },
    empireBorders: {
      color: "#666666",
      width: 1.0,
    },
    coastlines: {
      color: "#333333",
      width: 1.2,
    },
    parentBorders: {
      color: "#4b5563",
      opacity: 0.85,
      width: 1.1,
    },
    ocean: {
      preset: "flat",
      fillColor: "#aadaff",
      opacity: 0.72,
      scale: 1,
      contourStrength: 0.75,
      experimentalAdvancedStyles: false,
      coastalAccentEnabled: true,
      shallowBandFadeEndZoom: 2.8,
      midBandFadeEndZoom: 3.4,
      deepBandFadeEndZoom: 4.2,
      scenarioSyntheticContourFadeEndZoom: 3.0,
      scenarioShallowContourFadeEndZoom: 3.4,
    },
    lakes: createDefaultLakeStyleConfig(),
    cityPoints: {
      ...createDefaultCityLayerStyleConfig(),
    },
    urban: createDefaultUrbanStyleConfig(),
    physical: {
      ...createDefaultPhysicalStyleConfig(),
    },
    transportOverview: createDefaultTransportOverviewStyleConfig(),
    rivers: {
      color: "#3b82f6",
      opacity: 0.88,
      width: 0.5,
      outlineColor: "#e2efff",
      outlineWidth: 0.25,
      dashStyle: "solid",
    },
    specialZones: {
      disputedFill: "#f97316",
      disputedStroke: "#ea580c",
      wastelandFill: "#dc2626",
      wastelandStroke: "#b91c1c",
      customFill: "#8b5cf6",
      customStroke: "#6d28d9",
      opacity: 0.32,
      strokeWidth: 1.3,
      dashStyle: "dashed",
    },
    texture: createDefaultTextureStyleConfig(),
    dayNight: createDefaultDayNightStyleConfig(),
  };
}

export function createDefaultUiPanelState() {
  return {
    dockCollapsed: false,
    scenarioBarCollapsed: false,
    scenarioGuideDismissed: false,
    tutorialEntryVisible: true,
    tutorialDismissed: false,
    politicalEditingExpanded: false,
    scenarioVisualAdjustmentsOpen: false,
    developerMode: false,
    devWorkspaceExpanded: false,
    devWorkspaceCategory: "selection",
    rightSidebarTab: "inspector",
  };
}

export function createDefaultUiState() {
  return {
    activeDockPopover: "",
    isDirty: false,
    dirtyRevision: 0,
    onboardingDismissed: false,
    hoveredId: null,
    hoveredWaterRegionId: null,
    hoveredSpecialRegionId: null,
    hoverOverlayDirty: true,
    inspectorOverlayDirty: true,
    specialZonesOverlayDirty: true,
    frontlineOverlayDirty: true,
    operationalLinesDirty: true,
    operationGraphicsDirty: true,
    unitCountersDirty: true,
    tooltipRafHandle: null,
    tooltipPendingState: null,
    selectedWaterRegionId: "",
    selectedSpecialRegionId: "",
    zoomTransform: defaultZoom,
    showWaterRegions: true,
    showOpenOceanRegions: false,
    allowOpenOceanSelect: false,
    allowOpenOceanPaint: false,
    showScenarioSpecialRegions: true,
    showScenarioReliefOverlays: true,
    showCityPoints: true,
    showUrban: true,
    showPhysical: true,
    showRivers: true,
    showTransport: true,
    showAirports: false,
    showPorts: false,
    showRail: false,
    showRoad: false,
    showSpecialZones: false,
    cityLayerRevision: 0,
    manualSpecialZones: createDefaultManualSpecialZonesState(),
    annotationView: createDefaultAnnotationView(),
    operationalLines: [],
    operationGraphics: [],
    unitCounters: [],
    transportWorkbenchUi: createDefaultTransportWorkbenchUiState(),
    exportWorkbenchUi: normalizeExportWorkbenchUiState(null),
  };
}

export function createDefaultUiPresentationState() {
  return {
    referenceImageUrl: null,
    referenceImageState: createDefaultReferenceImageState(),
    styleConfig: createDefaultStyleConfig(),
    recentColors: [],
  };
}

export function createDefaultUiChromeState() {
  return {
    ui: createDefaultUiPanelState(),
  };
}
