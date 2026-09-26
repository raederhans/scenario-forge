import {
  getTransportCapabilityFamilyMetadata,
  getTransportOverviewDataLayerKeys,
  getTransportOverviewVisibilityField,
  listTransportCapabilityFamilyIds,
  supportsTransportCapabilityOverview,
} from "../../core/transport_capability_registry.js";
import {
  listDefaultThematicLayerSummaries,
  THEMATIC_LAYER_RENDER_DISABLED_REASON,
} from "../../core/thematic_layer_catalog.js";

const CONTRACT_GROUPS = Object.freeze(["appearance", "map-content", "transport", "workbench", "thematic"]);
const WORKBENCH_ONLY_REASON = "Available in Transport Workbench only";
const THEMATIC_PANEL_ID = "mapContentPanelThematic";

function translateUi(translate, key) {
  return typeof translate === "function" ? translate(key, "ui") : key;
}

function freezeArray(values = []) {
  return Object.freeze([...(Array.isArray(values) ? values : [])]);
}

function createLayerPanelContract({
  id,
  familyId = null,
  label,
  group,
  panelId = null,
  anchorId = null,
  stateOwner,
  dataOwner = null,
  renderOwner = null,
  statusProviderId,
  supportsMainOverview = true,
  supportsWorkbench = false,
  defaultVisibilityField = null,
  defaultVisible = null,
  hiddenByDefault = false,
  requiredRuntimeKeys = [],
  dataKeys = [],
  loadKeys = [],
  metricNames = [],
  supportsRuntimePreview = false,
  enabled = null,
  disabledReasonProvider = null,
  unsupportedReasonProvider = null,
  theme = "",
  geometryKind = "",
  sourcePolicy = "",
  status = "",
  coverageScope = "",
  manifestPath = "",
  defaultStyle = null,
  description = "",
}) {
  return Object.freeze({
    id,
    familyId,
    label,
    group,
    panelId,
    anchorId,
    stateOwner,
    dataOwner,
    renderOwner,
    statusProviderId,
    supportsMainOverview,
    supportsWorkbench,
    defaultVisibilityField,
    defaultVisible,
    hiddenByDefault,
    requiredRuntimeKeys: freezeArray(requiredRuntimeKeys),
    dataKeys: freezeArray(dataKeys),
    loadKeys: freezeArray(loadKeys),
    metricNames: freezeArray(metricNames),
    supportsRuntimePreview,
    enabled,
    disabledReasonProvider,
    unsupportedReasonProvider,
    theme,
    geometryKind,
    sourcePolicy,
    status,
    coverageScope,
    manifestPath,
    defaultStyle,
    description,
  });
}

const BASE_LAYER_PANEL_CONTRACTS = Object.freeze([
  createLayerPanelContract({
    id: "borders",
    label: "Borders",
    group: "appearance",
    panelId: "appearancePanelBorders",
    anchorId: "lblBordersPanel",
    stateOwner: "appearance_parent_border_owner",
    dataOwner: "landData",
    renderOwner: "border_draw_owner",
    statusProviderId: "base-layer",
    defaultVisibilityField: "parentBordersVisible",
    requiredRuntimeKeys: ["parentBordersVisible", "landData"],
    dataKeys: ["landData"],
    enabled: (state) => state.parentBordersVisible !== false,
  }),
  createLayerPanelContract({
    id: "physical",
    label: "Physical Regions",
    group: "appearance",
    panelId: "appearancePanelPhysical",
    anchorId: "lblPhysicalPanel",
    stateOwner: "appearance_physical_owner",
    dataOwner: "context-layer:physical",
    renderOwner: "physical_layer_render_owner",
    statusProviderId: "base-layer",
    defaultVisibilityField: "showPhysical",
    requiredRuntimeKeys: ["showPhysical", "physicalData", "physicalSemanticsData"],
    dataKeys: ["physicalData", "physicalSemanticsData", "physicalContourMajorData", "physicalContourMinorData"],
    loadKeys: ["physical", "physical_semantics", "physical_contours_major", "physical_contours_minor"],
    metricNames: ["drawPhysicalContourLayer", "drawPhysicalAtlasLayer", "drawPhysicalBasePass", "drawPhysicalReliefOverlayLayer"],
    enabled: (state) => state.showPhysical !== false,
  }),
  createLayerPanelContract({
    id: "urban",
    label: "Urban Areas",
    group: "appearance",
    panelId: "appearancePanelUrban",
    anchorId: "lblUrbanPanel",
    stateOwner: "appearance_controls_controller",
    dataOwner: "context-layer:urban",
    renderOwner: "map_renderer.context_layers",
    statusProviderId: "base-layer",
    defaultVisibilityField: "showUrban",
    requiredRuntimeKeys: ["showUrban", "urbanData"],
    dataKeys: ["urbanData"],
    loadKeys: ["urban"],
    metricNames: ["drawUrbanLayer"],
    enabled: (state) => state.showUrban !== false,
  }),
  createLayerPanelContract({
    id: "city-points",
    label: "City Points",
    group: "appearance",
    panelId: "appearancePanelCityPoints",
    anchorId: "lblCityPointsPanel",
    stateOwner: "appearance_city_points_owner",
    dataOwner: "worldCitiesData",
    renderOwner: "city_points_render_owner",
    statusProviderId: "base-layer",
    defaultVisibilityField: "showCityPoints",
    requiredRuntimeKeys: ["showCityPoints", "worldCitiesData"],
    dataKeys: ["worldCitiesData"],
    metricNames: ["drawLabelsPass", "drawCityPointsLayer"],
    enabled: (state) => state.showCityPoints !== false,
  }),
  createLayerPanelContract({
    id: "rivers",
    label: "Rivers",
    group: "map-content",
    panelId: null,
    anchorId: "lblRiversPanel",
    stateOwner: "appearance_rivers_owner",
    dataOwner: "context-layer:rivers",
    renderOwner: "river_layer_render_owner",
    statusProviderId: "base-layer",
    defaultVisibilityField: "showRivers",
    requiredRuntimeKeys: ["showRivers", "riversData"],
    dataKeys: ["riversData"],
    loadKeys: ["rivers"],
    metricNames: ["drawRiversLayer"],
    enabled: (state) => state.showRivers !== false,
  }),
  createLayerPanelContract({
    id: "ocean",
    label: "Ocean",
    group: "map-content",
    panelId: "appearancePanelOcean",
    anchorId: "lblOcean",
    stateOwner: "ocean_lake_controls_controller",
    dataOwner: "oceanData",
    renderOwner: "ocean_render_owner",
    statusProviderId: "base-layer",
    requiredRuntimeKeys: ["oceanData"],
    dataKeys: ["oceanData"],
    enabled: () => true,
  }),
  createLayerPanelContract({
    id: "bathymetry",
    label: "Bathymetry",
    group: "map-content",
    panelId: "appearancePanelOcean",
    anchorId: "lblOceanStyleCard",
    stateOwner: "ocean_lake_controls_controller",
    dataOwner: "activeBathymetryBandsData/activeBathymetryContoursData",
    renderOwner: "ocean_render_owner",
    statusProviderId: "bathymetry",
    defaultVisibilityField: "styleConfig.ocean.experimentalAdvancedStyles",
    requiredRuntimeKeys: ["styleConfig.ocean.experimentalAdvancedStyles", "activeBathymetryBandsData", "activeBathymetryContoursData"],
    dataKeys: ["activeBathymetryBandsData", "activeBathymetryContoursData"],
    disabledReasonProvider: ({ translate } = {}) => translateUi(translate, "Off"),
  }),
  createLayerPanelContract({
    id: "day-night",
    label: "Day / Night",
    group: "map-content",
    panelId: "appearancePanelDayNight",
    anchorId: "lblDayNightPanel",
    stateOwner: "appearance_texture_owner",
    dataOwner: null,
    renderOwner: "map_renderer.day_night_pass",
    statusProviderId: "day-night",
    defaultVisibilityField: "styleConfig.dayNight.enabled",
    requiredRuntimeKeys: ["styleConfig.dayNight.enabled", "styleConfig.dayNight.mode"],
  }),
  createLayerPanelContract({
    id: "texture",
    label: "Texture",
    group: "map-content",
    panelId: "appearancePanelTexture",
    anchorId: "lblTexture",
    stateOwner: "appearance_texture_owner",
    dataOwner: null,
    renderOwner: "map_renderer.texture_pass",
    statusProviderId: "texture",
    defaultVisibilityField: "styleConfig.texture.mode",
    requiredRuntimeKeys: ["styleConfig.texture.mode"],
  }),
  createLayerPanelContract({
    id: "transport",
    label: "Transport",
    group: "transport",
    panelId: "appearancePanelTransport",
    anchorId: "lblTransportPanel",
    stateOwner: "transport_appearance_controller",
    dataOwner: "transport_capability_registry",
    renderOwner: "transport_overview_render_owner",
    statusProviderId: "transport-master",
    defaultVisibilityField: "showTransport",
    requiredRuntimeKeys: ["showTransport", "styleConfig.transportOverview"],
    supportsWorkbench: true,
  }),
]);

const LAYER_STATUS_ANCHOR_BY_ID = Object.freeze(Object.fromEntries(
  BASE_LAYER_PANEL_CONTRACTS
    .filter((contract) => contract.anchorId)
    .map((contract) => [contract.id, contract.anchorId])
));

function createThematicCatalogPanelContract() {
  return createLayerPanelContract({
    id: "thematic",
    familyId: "thematic",
    label: "Thematic Layers",
    group: "thematic",
    panelId: THEMATIC_PANEL_ID,
    stateOwner: "thematic_layer_catalog_preview",
    dataOwner: "thematic_layer_catalog",
    renderOwner: null,
    statusProviderId: "thematic-catalog",
    supportsMainOverview: false,
    supportsRuntimePreview: true,
    defaultVisible: false,
    hiddenByDefault: true,
    requiredRuntimeKeys: ["thematic_layer_catalog"],
    dataKeys: ["thematic_layer_catalog"],
    loadKeys: ["thematic_layer_catalog"],
    disabledReasonProvider: ({ translate } = {}) => translateUi(translate, THEMATIC_LAYER_RENDER_DISABLED_REASON),
  });
}

function createThematicLayerPanelContract(layer) {
  return createLayerPanelContract({
    id: `thematic-layer:${layer.layerId}`,
    familyId: "thematic",
    label: layer.title || layer.layerId,
    group: "thematic",
    panelId: THEMATIC_PANEL_ID,
    stateOwner: "thematic_layer_catalog_preview",
    dataOwner: `thematic_layer:${layer.layerId}`,
    renderOwner: null,
    statusProviderId: "thematic-layer",
    supportsMainOverview: false,
    supportsRuntimePreview: true,
    defaultVisible: layer.defaultVisible,
    hiddenByDefault: layer.hiddenByDefault,
    requiredRuntimeKeys: ["thematic_layer_catalog", `thematic_layer:${layer.layerId}`],
    dataKeys: ["thematic_layer_catalog", `thematic_layer:${layer.layerId}`],
    loadKeys: ["thematic_layer_catalog", `thematic_layer:${layer.layerId}`],
    enabled: () => false,
    disabledReasonProvider: ({ translate } = {}) => translateUi(translate, THEMATIC_LAYER_RENDER_DISABLED_REASON),
    theme: layer.theme,
    geometryKind: layer.geometryKind,
    sourcePolicy: layer.sourcePolicy,
    status: layer.status,
    coverageScope: layer.coverageScope,
    manifestPath: layer.manifestPath,
    defaultStyle: layer.defaultStyle,
    description: layer.description,
  });
}

function createTransportLayerPanelContract(familyId) {
  const metadata = getTransportCapabilityFamilyMetadata(familyId);
  const supportsMainOverview = supportsTransportCapabilityOverview(familyId);
  const dataLayerKeys = getTransportOverviewDataLayerKeys(familyId);
  return createLayerPanelContract({
    id: `transport-${familyId}`,
    familyId,
    label: metadata?.label || familyId,
    group: supportsMainOverview ? "transport" : "workbench",
    panelId: "appearancePanelTransport",
    stateOwner: "transport_capability_registry",
    dataOwner: dataLayerKeys.length ? dataLayerKeys.join(",") : null,
    renderOwner: supportsMainOverview ? "transport_overview_render_owner" : "transport_workbench_preview_owner",
    statusProviderId: "transport-family",
    supportsMainOverview,
    supportsWorkbench: true,
    defaultVisibilityField: getTransportOverviewVisibilityField(familyId) || null,
    requiredRuntimeKeys: ["showTransport", "styleConfig.transportOverview"],
    dataKeys: dataLayerKeys,
    unsupportedReasonProvider: supportsMainOverview
      ? null
      : ({ translate } = {}) => translateUi(translate, WORKBENCH_ONLY_REASON),
  });
}

function cloneContract(contract) {
  return Object.freeze({
    ...contract,
    requiredRuntimeKeys: freezeArray(contract.requiredRuntimeKeys),
    dataKeys: freezeArray(contract.dataKeys),
    loadKeys: freezeArray(contract.loadKeys),
    metricNames: freezeArray(contract.metricNames),
    defaultStyle: contract.defaultStyle && typeof contract.defaultStyle === "object"
      ? Object.freeze({ ...contract.defaultStyle })
      : contract.defaultStyle,
  });
}

export function listBaseLayerPanelContracts() {
  return BASE_LAYER_PANEL_CONTRACTS.map(cloneContract);
}

export function listBaseLayerStatusContracts() {
  return BASE_LAYER_PANEL_CONTRACTS
    .filter((contract) => contract.statusProviderId === "base-layer")
    .map(cloneContract);
}

export function listTransportLayerPanelContracts() {
  return listTransportCapabilityFamilyIds().map(createTransportLayerPanelContract);
}

export function listThematicLayerPanelContracts() {
  return [
    createThematicCatalogPanelContract(),
    ...listDefaultThematicLayerSummaries().map(createThematicLayerPanelContract),
  ].map(cloneContract);
}

export function listLayerPanelContracts() {
  return [
    ...listBaseLayerPanelContracts(),
    ...listThematicLayerPanelContracts(),
    ...listTransportLayerPanelContracts(),
  ];
}

export function getLayerPanelContractById(id) {
  const normalizedId = String(id || "").trim();
  return listLayerPanelContracts().find((contract) => contract.id === normalizedId) || null;
}

export function getLayerPanelStatusAnchorMap() {
  return Object.freeze({ ...LAYER_STATUS_ANCHOR_BY_ID });
}

export function getLayerStatusAnchorById(id) {
  const normalizedId = String(id || "").trim();
  return LAYER_STATUS_ANCHOR_BY_ID[normalizedId] || "";
}

export function getLayerPanelDisabledReason(contract, { translate } = {}) {
  return typeof contract?.disabledReasonProvider === "function"
    ? contract.disabledReasonProvider({ translate })
    : "";
}

export function getLayerPanelUnsupportedReason(contract, { translate } = {}) {
  return typeof contract?.unsupportedReasonProvider === "function"
    ? contract.unsupportedReasonProvider({ translate })
    : "";
}

export {
  CONTRACT_GROUPS,
  WORKBENCH_ONLY_REASON,
};
