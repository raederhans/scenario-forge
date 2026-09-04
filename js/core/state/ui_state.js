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
  createDefaultTransportWorkbenchPointDeltas,
  createDefaultUrbanStyleConfig,
  defaultZoom,
  PARENT_BORDER_STYLE_DEFAULTS,
  normalizeAnnotationView,
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeExportWorkbenchUiState,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
  normalizeTransportOverviewStyleConfig,
  normalizeTransportWorkbenchPointDeltas,
  normalizeTransportWorkbenchUiState,
  normalizeUrbanStyleConfig,
} from "../state_defaults.js";
import {
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
  listTransportRuntimeCapabilityFamilyIds,
} from "../transport_capability_registry.js";
import { getDefaultTransportWorkbenchPackIdForFamily } from "../transport_pack_resolver.js";
import { createEmptySpecialZoneLayersState } from "../special_zone_layers.js";

const TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS = listTransportRuntimeCapabilityFamilyIds();
const TRANSPORT_OVERVIEW_VISIBILITY_FIELDS = listTransportOverviewCapabilityFamilyIds()
  .map((familyId) => getTransportOverviewVisibilityField(familyId))
  .filter(Boolean);

export function createDefaultManualSpecialZonesState() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function createDefaultTransportWorkbenchUiState() {
  // transportWorkbenchUi 既要保留当前 family 的直接入口，也要保留按 family
  // 分开的 activePackIdByFamily，方便 preview/editor/main-map apply 共用同一份选择状态。
  const activePackIdByFamily = Object.fromEntries(
    TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS
      .filter((familyId) => familyId !== "layers")
      .map((familyId) => [familyId, getDefaultTransportWorkbenchPackIdForFamily(familyId)])
  );
  return {
    open: false,
    activeFamily: "road",
    activePackId: activePackIdByFamily.road || getDefaultTransportWorkbenchPackIdForFamily("road"),
    activePackIdByFamily,
    activeInspectorTab: "inspect",
    sampleCountry: "Japan",
    previewCarrierId: "japan",
    previewMode: "bounded_zoom_pan",
    previewAssetId: "japan_carrier_v3",
    previewInteractionMode: "bounded_zoom_pan",
    previewCamera: {
      scale: 1,
      translateX: 0,
      translateY: 0,
    },
    layerOrder: [...TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS],
    familyConfigs: Object.fromEntries(
      TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS.map((familyId) => [familyId, {}])
    ),
    displayConfigs: createDefaultTransportWorkbenchDisplayConfigs(),
    sectionOpen: Object.fromEntries(
      TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS.map((familyId) => [familyId, {}])
    ),
    shellPhase: "road-live-preview",
    restoreLeftDrawer: false,
    restoreRightDrawer: false,
  };
}


export function ensureTransportOverviewStyleConfigState(target) {
  if (!target || typeof target !== "object") {
    return createDefaultTransportOverviewStyleConfig();
  }
  if (!target.styleConfig || typeof target.styleConfig !== "object") {
    target.styleConfig = {};
  }
  target.styleConfig.transportOverview = normalizeTransportOverviewStyleConfig(
    target.styleConfig.transportOverview || {},
  );
  return target.styleConfig.transportOverview;
}

export function createDefaultReferenceImageState() {
  return {
    opacity: 0.6,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function createDefaultRiversStyleConfig() {
  return {
    color: "#3b82f6",
    opacity: 0.88,
    width: 0.5,
    outlineColor: "#e2efff",
    outlineWidth: 0.25,
    dashStyle: "solid",
  };
}

export function normalizeRiversStyleConfig(rawConfig = {}, {
  clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
  normalizeOceanFillColor = (value) => value,
} = {}) {
  const defaults = createDefaultRiversStyleConfig();
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const numberOr = (value, defaultValue) => (
    Number.isFinite(Number(value)) ? Number(value) : defaultValue
  );

  return {
    ...source,
    color: normalizeOceanFillColor(source.color || defaults.color),
    opacity: clamp(numberOr(source.opacity, defaults.opacity), 0, 1),
    width: clamp(numberOr(source.width, defaults.width), 0.2, 4),
    outlineColor: normalizeOceanFillColor(source.outlineColor || defaults.outlineColor),
    outlineWidth: clamp(numberOr(source.outlineWidth, defaults.outlineWidth), 0, 3),
    dashStyle: String(source.dashStyle || defaults.dashStyle),
  };
}

export function normalizeReferenceImageState(rawState, {
  clamp = (value, min, max) => Math.min(max, Math.max(min, value)),
} = {}) {
  const defaults = createDefaultReferenceImageState();
  const state = rawState && typeof rawState === "object" ? rawState : {};
  return {
    opacity: clamp(
      Number.isFinite(Number(state.opacity)) ? Number(state.opacity) : defaults.opacity,
      0,
      1,
    ),
    scale: clamp(
      Number.isFinite(Number(state.scale)) ? Number(state.scale) : defaults.scale,
      0.2,
      3,
    ),
    offsetX: clamp(
      Number.isFinite(Number(state.offsetX)) ? Number(state.offsetX) : defaults.offsetX,
      -1000,
      1000,
    ),
    offsetY: clamp(
      Number.isFinite(Number(state.offsetY)) ? Number(state.offsetY) : defaults.offsetY,
      -1000,
      1000,
    ),
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
      opacity: 0.9,
      width: 1.0,
    },
    coastlines: {
      color: "#333333",
      opacity: 0.8,
      width: 1.2,
    },
    parentBorders: {
      color: PARENT_BORDER_STYLE_DEFAULTS.color,
      opacity: PARENT_BORDER_STYLE_DEFAULTS.opacity,
      width: PARENT_BORDER_STYLE_DEFAULTS.width,
    },
    ocean: {
      preset: "flat",
      fillColor: "#aadaff",
      opacity: 0.82,
      scale: 1.14,
      contourStrength: 0.34,
      experimentalAdvancedStyles: false,
      coastalAccentEnabled: true,
      shallowBandFadeEndZoom: 2.5,
      midBandFadeEndZoom: 3.0,
      deepBandFadeEndZoom: 3.8,
      scenarioSyntheticContourFadeEndZoom: 2.7,
      scenarioShallowContourFadeEndZoom: 3.1,
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
    rivers: createDefaultRiversStyleConfig(),
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

export function normalizeOpenOceanLayerVisibility(layerVisibility = null) {
  const source = layerVisibility && typeof layerVisibility === "object" ? layerVisibility : {};
  const allowOpenOceanSelect =
    source.allowOpenOceanSelect === undefined
      ? false
      : !!source.allowOpenOceanSelect;
  const allowOpenOceanPaint =
    source.allowOpenOceanPaint === undefined
      ? false
      : !!source.allowOpenOceanPaint;
  const showOpenOceanRegions =
    source.showOpenOceanRegions === undefined
      ? true
      : !!source.showOpenOceanRegions;
  return {
    allowOpenOceanSelect,
    allowOpenOceanPaint,
    showOpenOceanRegions,
  };
}

export function createDefaultUiState() {
  // createDefaultUiState 只收口运行中的 UI/runtime dirty 标记与开关；
  // 更细的 panel/workbench/style 默认值继续分散到专门 helper，避免这里再长出第二套 schema。
  const openOceanLayerVisibility = normalizeOpenOceanLayerVisibility();
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
    showOpenOceanRegions: openOceanLayerVisibility.showOpenOceanRegions,
    allowOpenOceanSelect: openOceanLayerVisibility.allowOpenOceanSelect,
    allowOpenOceanPaint: openOceanLayerVisibility.allowOpenOceanPaint,
    showScenarioSpecialRegions: true,
    showScenarioAtlantropa: true,
    showScenarioReliefOverlays: true,
    showCityPoints: true,
    showBlankFeatureLabels: false,
    showStrategicResourceMarkers: false,
    strategicChoroplethMetric: "",
    showUrban: true,
    showPhysical: true,
    showRivers: true,
    showTransport: true,
    showAirports: false,
    showPorts: false,
    showRail: false,
    showRoad: false,
    showSpecialZones: false,
    hgoIdentity: {
      enabled: false,
      nameMode: "scenario",
      showSuggestedAliases: true,
      variantSelections: {},
    },
    specialZoneMembershipBrushMode: "add",
    cityLayerRevision: 0,
    specialZoneLayers: createEmptySpecialZoneLayersState(),
    manualSpecialZones: createDefaultManualSpecialZonesState(),
    annotationView: createDefaultAnnotationView(),
    operationalLines: [],
    operationGraphics: [],
    unitCounters: [],
    transportWorkbenchPointDeltas: createDefaultTransportWorkbenchPointDeltas(),
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
  const openOceanLayerVisibility = normalizeOpenOceanLayerVisibility(layerVisibility);
  const transportOverviewLayerVisibility = {};
  TRANSPORT_OVERVIEW_VISIBILITY_FIELDS.forEach((field) => {
    transportOverviewLayerVisibility[field] = !!layerVisibility[field];
  });
  Object.assign(target, {
    showWaterRegions:
      layerVisibility.showWaterRegions === undefined ? true : !!layerVisibility.showWaterRegions,
    allowOpenOceanSelect: openOceanLayerVisibility.allowOpenOceanSelect,
    allowOpenOceanPaint: openOceanLayerVisibility.allowOpenOceanPaint,
    showOpenOceanRegions: openOceanLayerVisibility.showOpenOceanRegions,
    showScenarioSpecialRegions:
      layerVisibility.showScenarioSpecialRegions === undefined
        ? true
        : !!layerVisibility.showScenarioSpecialRegions,
    showScenarioAtlantropa:
      layerVisibility.showScenarioAtlantropa === undefined
        ? true
        : !!layerVisibility.showScenarioAtlantropa,
    showScenarioReliefOverlays:
      layerVisibility.showScenarioReliefOverlays === undefined
        ? true
        : !!layerVisibility.showScenarioReliefOverlays,
    showCityPoints:
      layerVisibility.showCityPoints === undefined ? true : !!layerVisibility.showCityPoints,
    showBlankFeatureLabels:
      layerVisibility.showBlankFeatureLabels === undefined ? false : !!layerVisibility.showBlankFeatureLabels,
    showStrategicResourceMarkers:
      layerVisibility.showStrategicResourceMarkers === undefined
        ? false
        : !!layerVisibility.showStrategicResourceMarkers,
    strategicChoroplethMetric: String(layerVisibility.strategicChoroplethMetric || ""),
    showUrban: !!layerVisibility.showUrban,
    showPhysical: !!layerVisibility.showPhysical,
    showRivers: !!layerVisibility.showRivers,
    showTransport: layerVisibility.showTransport === undefined ? true : !!layerVisibility.showTransport,
    ...transportOverviewLayerVisibility,
    showSpecialZones:
      layerVisibility.showSpecialZones === undefined ? false : !!layerVisibility.showSpecialZones,
  });
  return {
    allowOpenOceanSelect: openOceanLayerVisibility.allowOpenOceanSelect,
    allowOpenOceanPaint: openOceanLayerVisibility.allowOpenOceanPaint,
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
  // 导入 style config 时采用“默认值 + 当前安全字段 + 导入补丁”的合并顺序，
  // 让旧快照缺失的新字段自动补齐，同时保留已经过 normalize 的嵌套 shape。
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
      ? normalizeRiversStyleConfig({
          ...(currentStyleConfig.rivers || defaults.rivers),
          ...imported.rivers,
        })
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
  // workbench UI 恢复分两层：
  // 先深拷贝导入快照，避免直接复用旧引用；
  // 再对 transport/export workbench 分别做 normalize，收口新增字段和 family 局部配置。
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
    transportWorkbenchPointDeltas: importedState.transportWorkbenchPointDeltas
      ? normalizeTransportWorkbenchPointDeltas(clone(importedState.transportWorkbenchPointDeltas))
      : normalizeTransportWorkbenchPointDeltas(clone(target.transportWorkbenchPointDeltas)),
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

export function markDirtyState(target, reason = "") {
  if (!target || typeof target !== "object") {
    return 0;
  }
  // dirtyRevision 是 save/history/watchers 共用的“发生过可保存变更”时钟，
  // 即便 isDirty 已经是 true，也继续递增，方便观察者区分连续两次编辑。
  target.isDirty = true;
  target.dirtyRevision = Number(target.dirtyRevision || 0) + 1;
  if (reason) {
    target.lastDirtyReason = String(reason);
  }
  return target.dirtyRevision;
}

export function clearDirtyState(target, reason = "") {
  if (!target || typeof target !== "object") {
    return false;
  }
  // clear 只重置当前脏标记，不回滚 dirtyRevision。
  // 历史记录与自动保存仍可以把 revision 当作单调递增事件号使用。
  target.isDirty = false;
  if (reason) {
    target.lastDirtyReason = String(reason);
  }
  return target.isDirty;
}
