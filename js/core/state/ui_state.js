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
  normalizeAnnotationView,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeExportWorkbenchUiState,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
  normalizeTransportOverviewStyleConfig,
  normalizeTransportWorkbenchUiState,
  normalizeUrbanStyleConfig,
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

function cloneImportedUiValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function restoreImportedAnnotationOverlayState(
  target,
  importedState = {},
  {
    cloneValue = cloneImportedUiValue,
    normalizeAnnotationState = normalizeAnnotationView,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const clone = typeof cloneValue === "function" ? cloneValue : cloneImportedUiValue;
  const normalizeAnnotation =
    typeof normalizeAnnotationState === "function"
      ? normalizeAnnotationState
      : normalizeAnnotationView;
  const nextAnnotationView = normalizeAnnotation({
    ...(target.annotationView || {}),
    ...(importedState.annotationView || {}),
  });
  const nextOperationalLines = Array.isArray(importedState.operationalLines)
    ? clone(importedState.operationalLines)
    : [];
  const nextOperationGraphics = Array.isArray(importedState.operationGraphics)
    ? clone(importedState.operationGraphics)
    : [];
  const nextUnitCounters = Array.isArray(importedState.unitCounters)
    ? clone(importedState.unitCounters)
    : [];
  Object.assign(target, {
    annotationView: nextAnnotationView,
    operationalLines: nextOperationalLines,
    operationGraphics: nextOperationGraphics,
    unitCounters: nextUnitCounters,
    operationalLinesDirty: true,
    operationGraphicsDirty: true,
    unitCountersDirty: true,
  });
  return {
    annotationView: nextAnnotationView,
    operationalLines: nextOperationalLines,
    operationGraphics: nextOperationGraphics,
    unitCounters: nextUnitCounters,
  };
}

export function restoreImportedLayerVisibilityState(target, layerVisibility = null) {
  if (!target || typeof target !== "object") {
    return null;
  }
  if (!layerVisibility || typeof layerVisibility !== "object") {
    return null;
  }
  const allowOpenOceanSelect =
    layerVisibility.allowOpenOceanSelect === undefined
      ? (layerVisibility.showOpenOceanRegions === undefined
          ? false
          : !!layerVisibility.showOpenOceanRegions)
      : !!layerVisibility.allowOpenOceanSelect;
  const allowOpenOceanPaint =
    layerVisibility.allowOpenOceanPaint === undefined
      ? (layerVisibility.showOpenOceanRegions === undefined
          ? false
          : !!layerVisibility.showOpenOceanRegions)
      : !!layerVisibility.allowOpenOceanPaint;
  Object.assign(target, {
    showWaterRegions:
      layerVisibility.showWaterRegions === undefined ? true : !!layerVisibility.showWaterRegions,
    allowOpenOceanSelect,
    allowOpenOceanPaint,
    showOpenOceanRegions: !!(allowOpenOceanSelect || allowOpenOceanPaint),
    showScenarioSpecialRegions:
      layerVisibility.showScenarioSpecialRegions === undefined
        ? true
        : !!layerVisibility.showScenarioSpecialRegions,
    showScenarioReliefOverlays:
      layerVisibility.showScenarioReliefOverlays === undefined
        ? true
        : !!layerVisibility.showScenarioReliefOverlays,
    showCityPoints:
      layerVisibility.showCityPoints === undefined ? true : !!layerVisibility.showCityPoints,
    showUrban: !!layerVisibility.showUrban,
    showPhysical: !!layerVisibility.showPhysical,
    showRivers: !!layerVisibility.showRivers,
    showTransport: layerVisibility.showTransport === undefined ? true : !!layerVisibility.showTransport,
    showAirports: !!layerVisibility.showAirports,
    showPorts: !!layerVisibility.showPorts,
    showRail: !!layerVisibility.showRail,
    showSpecialZones:
      layerVisibility.showSpecialZones === undefined ? false : !!layerVisibility.showSpecialZones,
  });
  return {
    allowOpenOceanSelect,
    allowOpenOceanPaint,
  };
}

export function restoreImportedStyleConfigState(
  target,
  importedStyleConfig = null,
  {
    normalizeLakeStyle = normalizeLakeStyleConfig,
    normalizeCityLayerStyle = normalizeCityLayerStyleConfig,
    normalizeUrbanStyle = normalizeUrbanStyleConfig,
    normalizePhysicalStyle = normalizePhysicalStyleConfig,
    normalizeTransportOverviewStyle = normalizeTransportOverviewStyleConfig,
    normalizeDayNightStyle = normalizeDayNightStyleConfig,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const imported =
    importedStyleConfig && typeof importedStyleConfig === "object" ? importedStyleConfig : {};
  const defaults = createDefaultStyleConfig();
  const currentStyleConfig =
    target.styleConfig && typeof target.styleConfig === "object" ? target.styleConfig : defaults;
  target.styleConfig = {
    ...currentStyleConfig,
    internalBorders: {
      ...defaults.internalBorders,
      ...((imported.internalBorders && typeof imported.internalBorders === "object")
        ? imported.internalBorders
        : {}),
    },
    empireBorders: {
      ...defaults.empireBorders,
      ...((imported.empireBorders && typeof imported.empireBorders === "object")
        ? imported.empireBorders
        : {}),
    },
    coastlines: {
      ...defaults.coastlines,
      ...((imported.coastlines && typeof imported.coastlines === "object")
        ? imported.coastlines
        : {}),
    },
    parentBorders: {
      ...(currentStyleConfig.parentBorders || defaults.parentBorders),
      ...((imported.parentBorders && typeof imported.parentBorders === "object")
        ? imported.parentBorders
        : {}),
    },
    ocean: {
      ...(currentStyleConfig.ocean || defaults.ocean),
      ...((imported.ocean && typeof imported.ocean === "object") ? imported.ocean : {}),
    },
    lakes: normalizeLakeStyle(imported.lakes),
    cityPoints: imported.cityPoints && typeof imported.cityPoints === "object"
      ? normalizeCityLayerStyle({
          ...(currentStyleConfig.cityPoints || defaults.cityPoints),
          ...imported.cityPoints,
        })
      : currentStyleConfig.cityPoints,
    urban: imported.urban && typeof imported.urban === "object"
      ? normalizeUrbanStyle({
          ...(currentStyleConfig.urban || defaults.urban),
          ...imported.urban,
        })
      : currentStyleConfig.urban,
    physical: imported.physical && typeof imported.physical === "object"
      ? normalizePhysicalStyle({
          ...(currentStyleConfig.physical || defaults.physical),
          ...imported.physical,
        })
      : currentStyleConfig.physical,
    transportOverview:
      imported.transportOverview && typeof imported.transportOverview === "object"
        ? normalizeTransportOverviewStyle({
            ...(currentStyleConfig.transportOverview || defaults.transportOverview),
            ...imported.transportOverview,
          })
        : currentStyleConfig.transportOverview,
    rivers: imported.rivers && typeof imported.rivers === "object"
      ? {
          ...(currentStyleConfig.rivers || defaults.rivers),
          ...imported.rivers,
        }
      : currentStyleConfig.rivers,
    specialZones: imported.specialZones && typeof imported.specialZones === "object"
      ? {
          ...(currentStyleConfig.specialZones || defaults.specialZones),
          ...imported.specialZones,
        }
      : currentStyleConfig.specialZones,
    texture: imported.texture && typeof imported.texture === "object"
      ? {
          ...(currentStyleConfig.texture || defaults.texture),
          ...imported.texture,
          paper: {
            ...((currentStyleConfig.texture && currentStyleConfig.texture.paper) || defaults.texture.paper),
            ...(imported.texture.paper || {}),
          },
          graticule: {
            ...((currentStyleConfig.texture && currentStyleConfig.texture.graticule) || defaults.texture.graticule),
            ...(imported.texture.graticule || {}),
          },
          draftGrid: {
            ...((currentStyleConfig.texture && currentStyleConfig.texture.draftGrid) || defaults.texture.draftGrid),
            ...(imported.texture.draftGrid || {}),
          },
        }
      : currentStyleConfig.texture,
    dayNight: imported.dayNight && typeof imported.dayNight === "object"
      ? normalizeDayNightStyle({
          ...(currentStyleConfig.dayNight || defaults.dayNight),
          ...imported.dayNight,
        })
      : currentStyleConfig.dayNight,
  };
  return target.styleConfig;
}

export function restoreImportedWorkbenchUiState(
  target,
  importedState = {},
  {
    cloneValue = cloneImportedUiValue,
    normalizeTransportWorkbenchState = normalizeTransportWorkbenchUiState,
    normalizeExportWorkbenchState = normalizeExportWorkbenchUiState,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const clone = typeof cloneValue === "function" ? cloneValue : cloneImportedUiValue;
  const normalizeTransportWorkbench =
    typeof normalizeTransportWorkbenchState === "function"
      ? normalizeTransportWorkbenchState
      : null;
  const nextTransportWorkbenchUi = importedState.transportWorkbenchUi
    ? clone(importedState.transportWorkbenchUi)
    : clone(target.transportWorkbenchUi);
  const nextExportWorkbenchUi = importedState.exportWorkbenchUi
    ? clone(importedState.exportWorkbenchUi)
    : clone(target.exportWorkbenchUi);
  Object.assign(target, {
    recentColors: Array.isArray(importedState.recentColors) ? [...importedState.recentColors] : [],
    interactionGranularity: importedState.interactionGranularity || "subdivision",
    batchFillScope: importedState.batchFillScope || "parent",
    referenceImageState: {
      ...(target.referenceImageState || {}),
      ...(importedState.referenceImageState || {}),
    },
    transportWorkbenchUi: nextTransportWorkbenchUi,
    exportWorkbenchUi: nextExportWorkbenchUi,
  });
  if (
    normalizeTransportWorkbench
    && importedState.transportWorkbenchUi
    && typeof importedState.transportWorkbenchUi === "object"
  ) {
    const normalizedTransportWorkbenchUi = normalizeTransportWorkbench({
      ...(target.transportWorkbenchUi || {}),
      ...importedState.transportWorkbenchUi,
      familyConfigs: {
        ...((target.transportWorkbenchUi && target.transportWorkbenchUi.familyConfigs) || {}),
        ...(importedState.transportWorkbenchUi.familyConfigs || {}),
      },
      displayConfigs: {
        ...((target.transportWorkbenchUi && target.transportWorkbenchUi.displayConfigs) || {}),
        ...(importedState.transportWorkbenchUi.displayConfigs || {}),
      },
      sectionOpen: {
        ...((target.transportWorkbenchUi && target.transportWorkbenchUi.sectionOpen) || {}),
        ...(importedState.transportWorkbenchUi.sectionOpen || {}),
      },
    });
    target.transportWorkbenchUi = {
      ...(target.transportWorkbenchUi || {}),
      ...normalizedTransportWorkbenchUi,
      familyConfigs: normalizedTransportWorkbenchUi.familyConfigs,
      displayConfigs: normalizedTransportWorkbenchUi.displayConfigs,
      sectionOpen: normalizedTransportWorkbenchUi.sectionOpen,
    };
  }
  if (importedState.exportWorkbenchUi && typeof importedState.exportWorkbenchUi === "object") {
    replaceExportWorkbenchUiState(
      target,
      {
        ...(target.exportWorkbenchUi || {}),
        ...importedState.exportWorkbenchUi,
        visibility: {
          ...((target.exportWorkbenchUi && target.exportWorkbenchUi.visibility) || {}),
          ...(importedState.exportWorkbenchUi.visibility
            || importedState.exportWorkbenchUi.layerVisibility
            || {}),
        },
        bakeArtifacts: Array.isArray(importedState.exportWorkbenchUi.bakeArtifacts)
          ? importedState.exportWorkbenchUi.bakeArtifacts
          : (target.exportWorkbenchUi?.bakeArtifacts || []),
      },
      { normalizeState: normalizeExportWorkbenchState },
    );
  }
  return {
    transportWorkbenchUi: target.transportWorkbenchUi,
    exportWorkbenchUi: target.exportWorkbenchUi,
  };
}

export function replaceExportWorkbenchUiState(
  target,
  nextUiState = null,
  {
    normalizeState = normalizeExportWorkbenchUiState,
  } = {},
) {
  if (!target || typeof target !== "object") {
    return normalizeExportWorkbenchUiState(null);
  }
  const normalize = typeof normalizeState === "function"
    ? normalizeState
    : normalizeExportWorkbenchUiState;
  target.exportWorkbenchUi = normalize(nextUiState);
  return target.exportWorkbenchUi;
}

export function setActiveDockPopoverState(target, nextKind = "") {
  if (!target || typeof target !== "object") {
    return "";
  }
  target.activeDockPopover = String(nextKind || "").trim();
  return target.activeDockPopover;
}
