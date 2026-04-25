// Transport workbench controller.
// 这个模块负责 transport workbench 的状态归一、面板渲染、预览联动和内部事件绑定。
// toolbar.js 继续保留全局 overlay 协调、URL restore、顶层 chrome 和其他 support surface 的仲裁。

import {
  state as runtimeState,
  createDefaultTransportWorkbenchDisplayConfig,
  normalizeTransportWorkbenchDisplayConfig,
} from "../../core/state.js";
import { markDirty } from "../../core/dirty_state.js";
import { t } from "../i18n.js";
import {
  focusSurface as focusOverlaySurface,
  rememberSurfaceTrigger as rememberOverlayTrigger,
  restoreSurfaceTriggerFocus as restoreOverlayTriggerFocus,
} from "../ui_contract.js";
import {
  destroyTransportWorkbenchCarrier,
  ensureTransportWorkbenchCarrier,
  getTransportWorkbenchCarrierViewState,
  resetTransportWorkbenchCarrierView,
  resizeTransportWorkbenchCarrier,
  setTransportWorkbenchCarrierViewChangeListener,
  setTransportWorkbenchCarrierFamily,
  stepTransportWorkbenchCarrierZoom,
  toggleTransportWorkbenchCarrierQuarterTurn,
} from "../transport_workbench_carrier.js";
import {
  clearAllTransportWorkbenchFamilyPreviews,
  destroyAllTransportWorkbenchFamilyPreviews,
  getTransportWorkbenchFamilyPreviewSnapshot,
  isTransportWorkbenchFamilyLivePreviewCapable,
  renderTransportWorkbenchFamilyPreview,
  setTransportWorkbenchFamilyPreviewSelectionListener,
  warmTransportWorkbenchFamilyPreview,
} from "../transport_workbench_family_preview.js";
import {
  isTransportWorkbenchLivePreviewFamily,
  isTransportWorkbenchManifestOnlyRuntimeFamily,
  listTransportWorkbenchWarmupPlans,
} from "../transport_workbench_family_registry.js";
import {
  getTransportWorkbenchManifestDefaultVariantId,
  getTransportWorkbenchManifestVariantMeta,
  listTransportWorkbenchManifestVariantEntries,
} from "../transport_workbench_manifest_variants.js";
import { formatJapanRailVisibilityReason } from "../transport_workbench_rail_preview.js";
import {
  TRANSPORT_WORKBENCH_FAMILIES,
  ROAD_CLASS_OPTIONS,
  ROAD_REF_CLASS_OPTIONS,
  RAIL_STATUS_OPTIONS,
  RAIL_CLASS_OPTIONS,
  AIRPORT_TYPE_OPTIONS,
  AIRPORT_STATUS_OPTIONS,
  PORT_DESIGNATION_OPTIONS,
  PORT_MANAGER_TYPE_OPTIONS,
  INDUSTRIAL_VARIANT_OPTIONS,
  INDUSTRIAL_SITE_CLASS_OPTIONS,
  INDUSTRIAL_COASTAL_OPTIONS,
  LOGISTICS_HUB_TYPE_OPTIONS,
  LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS,
  ENERGY_STATUS_OPTIONS,
  TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS,
  TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS,
  TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS,
  TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS,
  TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS,
  TRANSPORT_WORKBENCH_INSPECTOR_TABS,
  TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS,
  TRANSPORT_WORKBENCH_INLINE_HELP_COPY,
  TRANSPORT_WORKBENCH_DATA_CONTRACTS,
  TRANSPORT_WORKBENCH_TAB_SECTION_MAP,
} from "./transport_workbench_descriptor.js";
const state = runtimeState;

const TRANSPORT_WORKBENCH_FAMILY_IDS = new Set(TRANSPORT_WORKBENCH_FAMILIES.map((family) => family.id));
const TRANSPORT_WORKBENCH_SORTABLE_LAYER_IDS = TRANSPORT_WORKBENCH_FAMILIES
  .filter((family) => family.id !== "layers")
  .map((family) => family.id);

function formatTransportWorkbenchSlugLabel(value) {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildEnergyFacilitySubtypeControlOptions(previewSnapshot) {
  const catalog = Array.isArray(previewSnapshot?.subtypeCatalog) ? previewSnapshot.subtypeCatalog : [];
  return catalog
    .filter((entry) => entry?.availability === "local")
    .map((entry) => ({
      value: String(entry.subtype_id || "").trim(),
      label: formatTransportWorkbenchSlugLabel(entry.subtype_id),
    }))
    .filter((entry) => entry.value);
}

const TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES = TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS.map((option) => option.value);
export { TRANSPORT_WORKBENCH_INSPECTOR_TABS };
export const TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS = TRANSPORT_WORKBENCH_INSPECTOR_TABS.map((tab) => tab.id);
const TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS = new Set([
  "port",
  "mineral_resources",
  "energy_facilities",
  "industrial_zones",
  "logistics_hubs",
]);
const TRANSPORT_WORKBENCH_DEFAULT_CONFIGS = {
  road: {
    roadClass: ["motorway", "trunk", "primary"],
    excludeLinks: true,
    excludeServiceLike: true,
    zoomGate: "balanced",
    motorwayIdentitySource: "osm_plus_n06",
    preferOfficialRef: true,
    preferOfficialNameWhenPresent: true,
    showSourceConflicts: false,
    mergeContiguousSegments: true,
    minProjectedSegmentPx: 6,
    suppressShortPrimarySegments: true,
    denseMetroGuard: "balanced",
    showRefs: true,
    refClasses: ["motorway", "trunk", "primary"],
    labelDensityPreset: "balanced",
    allowPrimaryRefsAtHighZoom: true,
    strokePreset: "corridor",
    selectedEmphasis: "outline",
    baseOpacity: 88,
    refOpacity: 82,
    motorwayWidth: 2.8,
    trunkWidth: 2.0,
    primaryWidth: 1.18,
  },
  rail: {
    status: ["active"],
    class: ["high_speed", "trunk", "branch"],
    showServiceAtHighZoomOnly: true,
    showOsmPatchSegments: true,
    officialActiveNetworkLocked: true,
    allowOsmActiveGapFill: false,
    strictDedupMode: "strict",
    showReconciliationConflicts: false,
    showMajorStations: true,
    importanceThreshold: "regional_core",
    singlePrimaryStationPerCity: true,
    showStationLabels: true,
    labelDensityPreset: "balanced",
    statusEncoding: "line_style",
    showBranchAtCurrentZoom: true,
    showServiceLines: false,
    stationSymbolPreset: "dot_ring",
    lineOpacity: 92,
    stationOpacity: 86,
    inactiveFadeStrength: 72,
  },
  airport: {
    airportTypes: AIRPORT_TYPE_OPTIONS.map((option) => option.value),
    statuses: ["active", "paused"],
    importanceThreshold: "regional_core",
    showLabels: true,
    labelDensityPreset: "balanced",
    baseOpacity: 90,
  },
  port: {
    displayMode: "inspect",
    displayPreset: "balanced",
    aggregationAlgorithm: "cluster",
    labelLevel: "anchor",
    labelBudget: 8,
    labelSeparation: 1,
    labelAllowMerge: true,
    legalDesignations: PORT_DESIGNATION_OPTIONS.map((option) => option.value),
    managerTypes: PORT_MANAGER_TYPE_OPTIONS.map((option) => option.value),
    importanceThreshold: "regional_core",
    showLabels: true,
    labelDensityPreset: "balanced",
    baseOpacity: 90,
  },
  mineral_resources: {
    displayMode: "aggregate",
    displayPreset: "balanced",
    aggregationAlgorithm: "hex",
    labelLevel: "category",
    labelBudget: 7,
    labelSeparation: 1.15,
    labelAllowMerge: true,
    showLabels: false,
    labelDensityPreset: "sparse",
    pointOpacity: 72,
    pointSize: 92,
  },
  energy_facilities: {
    displayMode: "inspect",
    displayPreset: "balanced",
    aggregationAlgorithm: "cluster",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1,
    labelAllowMerge: true,
    facilitySubtypes: [],
    statuses: ENERGY_STATUS_OPTIONS.map((option) => option.value),
    showLabels: true,
    labelDensityPreset: "very_sparse",
    pointOpacity: 86,
    pointSize: 100,
  },
  industrial_zones: {
    displayMode: "aggregate",
    displayPreset: "pattern_first",
    aggregationAlgorithm: "square",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1.1,
    labelAllowMerge: true,
    variant: "internal",
    siteClasses: INDUSTRIAL_SITE_CLASS_OPTIONS.map((option) => option.value),
    coastalModes: INDUSTRIAL_COASTAL_OPTIONS.map((option) => option.value),
    showLabels: false,
    labelDensityPreset: "sparse",
    fillOpacity: 74,
    outlineOpacity: 88,
  },
  logistics_hubs: {
    displayMode: "aggregate",
    displayPreset: "pattern_first",
    aggregationAlgorithm: "cluster",
    labelLevel: "category",
    labelBudget: 8,
    labelSeparation: 1.12,
    labelAllowMerge: true,
    hubTypes: LOGISTICS_HUB_TYPE_OPTIONS.map((option) => option.value),
    operatorClassifications: LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS.map((option) => option.value),
    showLabels: false,
    labelDensityPreset: "sparse",
    pointOpacity: 78,
    pointSize: 100,
  },
};

const TRANSPORT_WORKBENCH_BASELINE_CONFIGS = {
  road: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road)),
  rail: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail)),
  airport: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport)),
  port: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port)),
  mineral_resources: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources)),
  energy_facilities: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities)),
  industrial_zones: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones)),
  logistics_hubs: JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs)),
};

const TRANSPORT_WORKBENCH_SECTION_DEFAULTS = {
  road: {
    inclusion: true,
    source_hardening: true,
    noise_control: false,
    labels: false,
    style: false,
    diagnostics: false,
  },
  rail: {
    network_scope: true,
    source_reconciliation: true,
    major_stations: false,
    line_presentation: false,
    style: false,
    diagnostics: false,
  },
  airport: {
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  port: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  mineral_resources: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  energy_facilities: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  industrial_zones: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    data_variant: true,
    filtering: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
  logistics_hubs: {
    display_mode: true,
    aggregation_mode: true,
    label_strategy: true,
    facility_scope: true,
    visibility: true,
    style: false,
    diagnostics: false,
  },
};

function normalizeTransportWorkbenchFamily(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_FAMILY_IDS.has(normalized) ? normalized : "road";
}

function normalizeTransportWorkbenchInspectorTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS.includes(normalized) ? normalized : "inspect";
}

function mapTransportWorkbenchLabelLevelToMaxLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "region") return 1;
  if (normalized === "category") return 3;
  return 2;
}

function mapTransportWorkbenchMaxLevelToLabelLevel(value) {
  const numeric = Number(value);
  if (numeric >= 3) return "category";
  if (numeric <= 1) return "region";
  return "anchor";
}

function normalizeTransportWorkbenchEnum(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

function normalizeTransportWorkbenchMulti(value, allowedValues, fallbackValues) {
  const next = Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter((entry) => allowedValues.includes(entry))
    : [];
  return next.length ? Array.from(new Set(next)) : [...fallbackValues];
}

function normalizeTransportWorkbenchDensityConfig(source, defaults, {
  allowedAlgorithms = TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.map((option) => option.value),
  defaultDisplayMode = "inspect",
} = {}) {
  return {
    displayMode: normalizeTransportWorkbenchEnum(
      source.displayMode,
      TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS.map((option) => option.value),
      defaults.displayMode || defaultDisplayMode
    ),
    displayPreset: normalizeTransportWorkbenchEnum(
      source.displayPreset,
      TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS.map((option) => option.value),
      defaults.displayPreset || "balanced"
    ),
    aggregationAlgorithm: normalizeTransportWorkbenchEnum(
      source.aggregationAlgorithm,
      allowedAlgorithms,
      defaults.aggregationAlgorithm || allowedAlgorithms[0]
    ),
    labelLevel: normalizeTransportWorkbenchEnum(
      source.labelLevel,
      TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS.map((option) => option.value),
      defaults.labelLevel || "anchor"
    ),
    labelBudget: Math.max(3, Math.min(18, Number(source.labelBudget) || defaults.labelBudget || 8)),
    labelSeparation: Math.max(0.7, Math.min(1.8, Number(source.labelSeparation) || defaults.labelSeparation || 1)),
    labelAllowMerge: source.labelAllowMerge !== false,
  };
}

function normalizeTransportWorkbenchLayerOrder(value) {
  const next = Array.isArray(value)
    ? value
      .map((entry) => normalizeTransportWorkbenchFamily(entry))
      .filter((entry) => TRANSPORT_WORKBENCH_SORTABLE_LAYER_IDS.includes(entry))
    : [];
  const deduped = Array.from(new Set(next));
  TRANSPORT_WORKBENCH_SORTABLE_LAYER_IDS.forEach((familyId) => {
    if (!deduped.includes(familyId)) {
      deduped.push(familyId);
    }
  });
  return deduped;
}

function normalizeRoadTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    roadClass: normalizeTransportWorkbenchMulti(source.roadClass, ROAD_CLASS_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.roadClass),
    excludeLinks: source.excludeLinks !== false,
    excludeServiceLike: source.excludeServiceLike !== false,
    zoomGate: normalizeTransportWorkbenchEnum(source.zoomGate, ["strict", "balanced", "loose"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.zoomGate),
    motorwayIdentitySource: normalizeTransportWorkbenchEnum(source.motorwayIdentitySource, ["osm_plus_n06", "osm_only"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.motorwayIdentitySource),
    preferOfficialRef: source.preferOfficialRef !== false,
    preferOfficialNameWhenPresent: source.preferOfficialNameWhenPresent !== false,
    showSourceConflicts: !!source.showSourceConflicts,
    mergeContiguousSegments: source.mergeContiguousSegments !== false,
    minProjectedSegmentPx: Math.max(2, Math.min(16, Number(source.minProjectedSegmentPx) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.minProjectedSegmentPx)),
    suppressShortPrimarySegments: source.suppressShortPrimarySegments !== false,
    denseMetroGuard: normalizeTransportWorkbenchEnum(source.denseMetroGuard, ["light", "balanced", "strict"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.denseMetroGuard),
    showRefs: source.showRefs !== false,
    refClasses: normalizeTransportWorkbenchMulti(source.refClasses, ROAD_CLASS_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.refClasses),
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.labelDensityPreset),
    allowPrimaryRefsAtHighZoom: source.allowPrimaryRefsAtHighZoom !== false,
    strokePreset: normalizeTransportWorkbenchEnum(source.strokePreset, ["corridor", "review", "quiet"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.strokePreset),
    selectedEmphasis: normalizeTransportWorkbenchEnum(source.selectedEmphasis, ["outline", "glow", "mute_others"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.selectedEmphasis),
    baseOpacity: Math.max(40, Math.min(100, Number(source.baseOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.baseOpacity)),
    refOpacity: Math.max(30, Math.min(100, Number(source.refOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.refOpacity)),
    motorwayWidth: Math.max(1.6, Math.min(4.8, Number(source.motorwayWidth) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.motorwayWidth)),
    trunkWidth: Math.max(1.1, Math.min(3.8, Number(source.trunkWidth) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.trunkWidth)),
    primaryWidth: Math.max(0.55, Math.min(2.8, Number(source.primaryWidth) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.road.primaryWidth)),
  };
}

function normalizeRailTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    status: normalizeTransportWorkbenchMulti(source.status, RAIL_STATUS_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.status),
    class: normalizeTransportWorkbenchMulti(source.class, RAIL_CLASS_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.class),
    showServiceAtHighZoomOnly: source.showServiceAtHighZoomOnly !== false,
    showOsmPatchSegments: source.showOsmPatchSegments !== false,
    officialActiveNetworkLocked: source.officialActiveNetworkLocked !== false,
    allowOsmActiveGapFill: !!source.allowOsmActiveGapFill,
    strictDedupMode: normalizeTransportWorkbenchEnum(source.strictDedupMode, ["strict", "strict_plus_name"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.strictDedupMode),
    showReconciliationConflicts: !!source.showReconciliationConflicts,
    showMajorStations: source.showMajorStations !== false,
    importanceThreshold: normalizeTransportWorkbenchEnum(source.importanceThreshold, ["capital_core", "regional_core", "broad_major"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.importanceThreshold),
    singlePrimaryStationPerCity: source.singlePrimaryStationPerCity !== false,
    showStationLabels: source.showStationLabels !== false,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.labelDensityPreset),
    statusEncoding: normalizeTransportWorkbenchEnum(source.statusEncoding, ["line_style", "line_style_plus_hue"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.statusEncoding),
    showBranchAtCurrentZoom: source.showBranchAtCurrentZoom !== false,
    showServiceLines: !!source.showServiceLines,
    stationSymbolPreset: normalizeTransportWorkbenchEnum(source.stationSymbolPreset, ["dot_ring", "solid_dot", "quiet_square"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.stationSymbolPreset),
    lineOpacity: Math.max(40, Math.min(100, Number(source.lineOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.lineOpacity)),
    stationOpacity: Math.max(35, Math.min(100, Number(source.stationOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.stationOpacity)),
    inactiveFadeStrength: Math.max(0, Math.min(100, Number(source.inactiveFadeStrength) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.rail.inactiveFadeStrength)),
  };
}

function normalizeAirportTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    airportTypes: normalizeTransportWorkbenchMulti(source.airportTypes, AIRPORT_TYPE_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport.airportTypes),
    statuses: normalizeTransportWorkbenchMulti(source.statuses, AIRPORT_STATUS_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport.statuses),
    importanceThreshold: normalizeTransportWorkbenchEnum(source.importanceThreshold, ["national_core", "regional_core", "local_connector"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport.importanceThreshold),
    showLabels: source.showLabels !== false,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport.labelDensityPreset),
    baseOpacity: Math.max(35, Math.min(100, Number(source.baseOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.airport.baseOpacity)),
  };
}

function normalizePortTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeTransportWorkbenchDensityConfig(source, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port, {
      allowedAlgorithms: ["cluster", "square", "density_surface"],
      defaultDisplayMode: "inspect",
    }),
    legalDesignations: normalizeTransportWorkbenchMulti(source.legalDesignations, PORT_DESIGNATION_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port.legalDesignations),
    managerTypes: normalizeTransportWorkbenchMulti(source.managerTypes, PORT_MANAGER_TYPE_OPTIONS.map((option) => option.value), TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port.managerTypes),
    importanceThreshold: normalizeTransportWorkbenchEnum(source.importanceThreshold, ["national_core", "regional_core", "local_connector"], TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port.importanceThreshold),
    showLabels: source.showLabels !== false,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port.labelDensityPreset),
    baseOpacity: Math.max(35, Math.min(100, Number(source.baseOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.port.baseOpacity)),
  };
}

function normalizeMineralResourceTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeTransportWorkbenchDensityConfig(source, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources, {
      allowedAlgorithms: ["hex", "square", "density_surface"],
      defaultDisplayMode: "aggregate",
    }),
    showLabels: !!source.showLabels,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources.labelDensityPreset),
    pointOpacity: Math.max(28, Math.min(100, Number(source.pointOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources.pointOpacity)),
    pointSize: Math.max(72, Math.min(148, Number(source.pointSize) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.mineral_resources.pointSize)),
  };
}

function normalizeEnergyFacilityTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeTransportWorkbenchDensityConfig(source, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities, {
      allowedAlgorithms: ["cluster", "square", "density_surface"],
      defaultDisplayMode: "inspect",
    }),
    facilitySubtypes: Array.isArray(source.facilitySubtypes)
      ? source.facilitySubtypes.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [...TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities.facilitySubtypes],
    statuses: normalizeTransportWorkbenchMulti(
      source.statuses,
      ENERGY_STATUS_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities.statuses
    ),
    showLabels: source.showLabels !== false,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities.labelDensityPreset),
    pointOpacity: Math.max(30, Math.min(100, Number(source.pointOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities.pointOpacity)),
    pointSize: Math.max(72, Math.min(148, Number(source.pointSize) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.energy_facilities.pointSize)),
  };
}

function normalizeIndustrialTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeTransportWorkbenchDensityConfig(source, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones, {
      allowedAlgorithms: ["square", "hex", "density_surface"],
      defaultDisplayMode: "aggregate",
    }),
    variant: normalizeTransportWorkbenchEnum(
      source.variant,
      INDUSTRIAL_VARIANT_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.variant
    ),
    siteClasses: normalizeTransportWorkbenchMulti(
      source.siteClasses,
      INDUSTRIAL_SITE_CLASS_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.siteClasses
    ),
    coastalModes: normalizeTransportWorkbenchMulti(
      source.coastalModes,
      INDUSTRIAL_COASTAL_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.coastalModes
    ),
    showLabels: !!source.showLabels,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.labelDensityPreset),
    fillOpacity: Math.max(18, Math.min(100, Number(source.fillOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.fillOpacity)),
    outlineOpacity: Math.max(28, Math.min(100, Number(source.outlineOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.industrial_zones.outlineOpacity)),
  };
}

function normalizeLogisticsHubTransportWorkbenchConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...normalizeTransportWorkbenchDensityConfig(source, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs, {
      allowedAlgorithms: ["cluster", "square", "density_surface"],
      defaultDisplayMode: "aggregate",
    }),
    hubTypes: normalizeTransportWorkbenchMulti(
      source.hubTypes,
      LOGISTICS_HUB_TYPE_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs.hubTypes
    ),
    operatorClassifications: normalizeTransportWorkbenchMulti(
      source.operatorClassifications,
      LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS.map((option) => option.value),
      TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs.operatorClassifications
    ),
    showLabels: !!source.showLabels,
    labelDensityPreset: normalizeTransportWorkbenchEnum(source.labelDensityPreset, TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES, TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs.labelDensityPreset),
    pointOpacity: Math.max(30, Math.min(100, Number(source.pointOpacity) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs.pointOpacity)),
    pointSize: Math.max(72, Math.min(148, Number(source.pointSize) || TRANSPORT_WORKBENCH_DEFAULT_CONFIGS.logistics_hubs.pointSize)),
  };
}

function ensureTransportWorkbenchUiState() {
  if (!runtimeState.transportWorkbenchUi || typeof runtimeState.transportWorkbenchUi !== "object") {
    runtimeState.transportWorkbenchUi = {};
  }
  runtimeState.transportWorkbenchUi.open = !!runtimeState.transportWorkbenchUi.open;
  runtimeState.transportWorkbenchUi.activeFamily = normalizeTransportWorkbenchFamily(runtimeState.transportWorkbenchUi.activeFamily);
  runtimeState.transportWorkbenchUi.sampleCountry = "Japan";
  runtimeState.transportWorkbenchUi.previewMode = "bounded_zoom_pan";
  runtimeState.transportWorkbenchUi.previewAssetId = "japan_carrier_v3";
  runtimeState.transportWorkbenchUi.previewInteractionMode = "bounded_zoom_pan";
  if (!runtimeState.transportWorkbenchUi.previewCamera || typeof runtimeState.transportWorkbenchUi.previewCamera !== "object") {
    runtimeState.transportWorkbenchUi.previewCamera = {};
  }
  runtimeState.transportWorkbenchUi.previewCamera.scale = Number(runtimeState.transportWorkbenchUi.previewCamera.scale) || 1;
  runtimeState.transportWorkbenchUi.previewCamera.translateX = Number(runtimeState.transportWorkbenchUi.previewCamera.translateX) || 0;
  runtimeState.transportWorkbenchUi.previewCamera.translateY = Number(runtimeState.transportWorkbenchUi.previewCamera.translateY) || 0;
  runtimeState.transportWorkbenchUi.compareHeld = !!runtimeState.transportWorkbenchUi.compareHeld;
  runtimeState.transportWorkbenchUi.activeInspectorTab = normalizeTransportWorkbenchInspectorTab(runtimeState.transportWorkbenchUi.activeInspectorTab);
  runtimeState.transportWorkbenchUi.layerOrder = normalizeTransportWorkbenchLayerOrder(runtimeState.transportWorkbenchUi.layerOrder);
  if (!runtimeState.transportWorkbenchUi.familyConfigs || typeof runtimeState.transportWorkbenchUi.familyConfigs !== "object") {
    runtimeState.transportWorkbenchUi.familyConfigs = {};
  }
  if (!runtimeState.transportWorkbenchUi.displayConfigs || typeof runtimeState.transportWorkbenchUi.displayConfigs !== "object") {
    runtimeState.transportWorkbenchUi.displayConfigs = {};
  }
  runtimeState.transportWorkbenchUi.familyConfigs.road = normalizeRoadTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.road);
  runtimeState.transportWorkbenchUi.familyConfigs.rail = normalizeRailTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.rail);
  runtimeState.transportWorkbenchUi.familyConfigs.airport = normalizeAirportTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.airport);
  runtimeState.transportWorkbenchUi.familyConfigs.port = normalizePortTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.port);
  runtimeState.transportWorkbenchUi.familyConfigs.mineral_resources = normalizeMineralResourceTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.mineral_resources);
  runtimeState.transportWorkbenchUi.familyConfigs.energy_facilities = normalizeEnergyFacilityTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.energy_facilities);
  runtimeState.transportWorkbenchUi.familyConfigs.industrial_zones = normalizeIndustrialTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.industrial_zones);
  runtimeState.transportWorkbenchUi.familyConfigs.logistics_hubs = normalizeLogisticsHubTransportWorkbenchConfig(runtimeState.transportWorkbenchUi.familyConfigs.logistics_hubs);
  ["road", "rail", "airport", "port", "mineral_resources", "energy_facilities", "industrial_zones", "logistics_hubs"].forEach((familyId) => {
    runtimeState.transportWorkbenchUi.displayConfigs[familyId] = normalizeTransportWorkbenchDisplayConfig(
      runtimeState.transportWorkbenchUi.displayConfigs[familyId],
      familyId
    );
  });
  ["airport", "port", "mineral_resources", "energy_facilities", "industrial_zones", "logistics_hubs"].forEach((familyId) => {
    if (!runtimeState.transportWorkbenchUi.familyConfigs[familyId] || typeof runtimeState.transportWorkbenchUi.familyConfigs[familyId] !== "object") {
      runtimeState.transportWorkbenchUi.familyConfigs[familyId] = {};
    }
  });
  if (!runtimeState.transportWorkbenchUi.sectionOpen || typeof runtimeState.transportWorkbenchUi.sectionOpen !== "object") {
    runtimeState.transportWorkbenchUi.sectionOpen = {};
  }
  ["road", "rail", "airport", "port", "mineral_resources", "energy_facilities", "industrial_zones", "logistics_hubs"].forEach((familyId) => {
    const defaults = TRANSPORT_WORKBENCH_SECTION_DEFAULTS[familyId];
    const source = runtimeState.transportWorkbenchUi.sectionOpen[familyId] && typeof runtimeState.transportWorkbenchUi.sectionOpen[familyId] === "object"
      ? runtimeState.transportWorkbenchUi.sectionOpen[familyId]
      : {};
    runtimeState.transportWorkbenchUi.sectionOpen[familyId] = Object.fromEntries(
      Object.entries(defaults).map(([sectionKey, defaultValue]) => [sectionKey, source[sectionKey] !== undefined ? !!source[sectionKey] : defaultValue])
    );
  });
  runtimeState.transportWorkbenchUi.shellPhase = "road-live-preview";
  runtimeState.transportWorkbenchUi.restoreLeftDrawer = !!runtimeState.transportWorkbenchUi.restoreLeftDrawer;
  runtimeState.transportWorkbenchUi.restoreRightDrawer = !!runtimeState.transportWorkbenchUi.restoreRightDrawer;
  return runtimeState.transportWorkbenchUi;
}

function resetTransportWorkbenchSectionState() {
  ensureTransportWorkbenchUiState();
  runtimeState.transportWorkbenchUi.sectionOpen = {
    road: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.road },
    rail: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.rail },
    airport: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.airport },
    port: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.port },
    mineral_resources: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.mineral_resources },
    energy_facilities: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.energy_facilities },
    industrial_zones: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.industrial_zones },
    logistics_hubs: { ...TRANSPORT_WORKBENCH_SECTION_DEFAULTS.logistics_hubs },
  };
}

const TRANSPORT_WORKBENCH_CONTROL_SCHEMAS = {
  road: [
    {
      key: "inclusion",
      title: "Inclusion",
      description: "Decide what enters the Japan road pack before any style rule runs.",
      controls: [
        { type: "multi", key: "roadClass", label: "Road classes", options: ROAD_CLASS_OPTIONS, description: "Pilot scope stays on motorway, trunk, and primary." },
        { type: "toggle", key: "excludeLinks", label: "Exclude *_link", description: "Keep motorway_link, trunk_link, and primary_link out by default." },
        { type: "toggle", key: "excludeServiceLike", label: "Exclude service-like roads", description: "Keep service, residential, and track out of the first pack." },
        { type: "select", key: "zoomGate", label: "Zoom gate", description: "Controls low, mid, and high-zoom reveal behavior.", options: [
          { value: "strict", label: "Strict corridor" },
          { value: "balanced", label: "Balanced" },
          { value: "loose", label: "Loose reveal" },
        ] },
      ],
    },
    {
      key: "source_hardening",
      title: "Source Hardening",
      description: "Bind OSM geometry and N06 motorway hardening into one Japan adapter.",
      controls: [
        { type: "select", key: "motorwayIdentitySource", label: "Motorway identity source", description: "Japan baseline defaults to OSM geometry plus N06 hardening.", options: [
          { value: "osm_plus_n06", label: "OSM + N06 hardening" },
          { value: "osm_only", label: "OSM only" },
        ] },
        { type: "toggle", key: "preferOfficialRef", label: "Prefer official ref", description: "Use official motorway refs when they exist." },
        { type: "toggle", key: "preferOfficialNameWhenPresent", label: "Prefer official name", description: "Use official names when source values disagree." },
        { type: "toggle", key: "showSourceConflicts", label: "Show source conflicts", description: "Expose OSM versus N06 conflicts instead of hiding them." },
      ],
    },
    {
      key: "noise_control",
      title: "Noise Control",
      description: "Use explicit rules. Do not lean on fuzzy post-fix cleanup.",
      controls: [
        { type: "toggle", key: "mergeContiguousSegments", label: "Merge contiguous segments", description: "Safely merge same-class runs before rendering." },
        { type: "range", key: "minProjectedSegmentPx", label: "Min projected segment", description: "Very short projected segments drop out to reduce spark noise.", min: 2, max: 16, step: 1, unit: "px" },
        { type: "toggle", key: "suppressShortPrimarySegments", label: "Suppress short primary", description: "Hide extra-short primary stubs in the first pass." },
        { type: "select", key: "denseMetroGuard", label: "Dense metro guard", description: "Extra denoise strength for Tokyo and Osaka density.", options: [
          { value: "light", label: "Light" },
          { value: "balanced", label: "Balanced" },
          { value: "strict", label: "Strict" },
        ] },
      ],
    },
    {
      key: "labels",
      title: "Labels",
      description: "road_labels remains a separate pack focused on motorway and national refs.",
      controls: [
        { type: "toggle", key: "showRefs", label: "Show refs", description: "Turns road_labels on or off." },
        { type: "multi", key: "refClasses", label: "Ref classes", options: ROAD_REF_CLASS_OPTIONS, description: "Primary is now available. Lower classes stay visible in UI but disabled until data lands." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively refs fill the corridor.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
        { type: "toggle", key: "allowPrimaryRefsAtHighZoom", label: "Allow primary refs at high zoom", description: "Primary refs stay gated until closer inspection." },
      ],
    },
    {
      key: "style",
      title: "Style",
      description: "These controls style only the transport overlay shell, not the carrier base map.",
      controls: [
        { type: "select", key: "strokePreset", label: "Stroke preset", description: "Sets motorway, trunk, and primary emphasis.", options: [
          { value: "corridor", label: "Corridor" },
          { value: "review", label: "Review" },
          { value: "quiet", label: "Quiet" },
        ] },
        { type: "select", key: "selectedEmphasis", label: "Selected emphasis", description: "How a chosen segment should stand out later.", options: [
          { value: "outline", label: "Outline" },
          { value: "glow", label: "Glow" },
          { value: "mute_others", label: "Mute others" },
        ] },
        { type: "range", key: "motorwayWidth", label: "Motorway width", description: "Screen-space width for motorway strokes.", min: 1.6, max: 4.8, step: 0.05, unit: "px" },
        { type: "range", key: "trunkWidth", label: "Trunk width", description: "Screen-space width for trunk strokes.", min: 1.1, max: 3.8, step: 0.05, unit: "px" },
        { type: "range", key: "primaryWidth", label: "Primary width", description: "Screen-space width for primary strokes.", min: 0.55, max: 2.8, step: 0.05, unit: "px" },
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall road line opacity.", min: 40, max: 100, step: 1, unit: "%" },
        { type: "range", key: "refOpacity", label: "Ref opacity", description: "Overall road_labels opacity.", min: 30, max: 100, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Diagnostics", description: "Explain rule intent only. Do not fabricate pack statistics.", kind: "diagnostics" },
  ],
  rail: [
    {
      key: "network_scope",
      title: "Network Scope",
      description: "Lock what enters the Japan rail pack before render style.",
      controls: [
        { type: "multi", key: "status", label: "Statuses", options: RAIL_STATUS_OPTIONS, description: "Japan rail baseline opens only active by default." },
        { type: "multi", key: "class", label: "Classes", options: RAIL_CLASS_OPTIONS, description: "Low zoom should favor high_speed and trunk." },
        { type: "toggle", key: "showServiceAtHighZoomOnly", label: "Service only at high zoom", description: "Keep service lines from dominating national views." },
        { type: "toggle", key: "showOsmPatchSegments", label: "Show OSM patch segments", description: "Display only explicit lifecycle or gap patches." },
      ],
    },
    {
      key: "source_reconciliation",
      title: "Source Reconciliation",
      description: "Official active network stays locked. OSM only patches lifecycle and gaps.",
      controls: [
        { type: "toggle", key: "officialActiveNetworkLocked", label: "Official active network locked", description: "Official Japan source defines active network boundaries." },
        { type: "toggle", key: "allowOsmActiveGapFill", label: "Allow OSM active gap fill", description: "Permit OSM to fill only obvious official gaps." },
        { type: "select", key: "strictDedupMode", label: "Dedup mode", description: "Keep reconciliation strict rather than heuristic.", options: [
          { value: "strict", label: "Strict" },
          { value: "strict_plus_name", label: "Strict + name" },
        ] },
        { type: "toggle", key: "showReconciliationConflicts", label: "Show reconciliation conflicts", description: "Expose official-versus-OSM conflicts instead of hiding them." },
      ],
    },
    {
      key: "major_stations",
      title: "Major Stations",
      description: "Only major stations are in scope, not a full station product.",
      controls: [
        { type: "toggle", key: "showMajorStations", label: "Show major stations", description: "Turn the major station layer on or off." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Controls the lowest station importance that survives.", options: [
          { value: "capital_core", label: "Capital core" },
          { value: "regional_core", label: "Regional core" },
          { value: "broad_major", label: "Broad major" },
        ] },
        { type: "toggle", key: "singlePrimaryStationPerCity", label: "Single primary station per city", description: "Keep one main station per city by default." },
        { type: "toggle", key: "showStationLabels", label: "Show station labels", description: "Expose names only for retained major stations." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively station names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "line_presentation",
      title: "Line Presentation",
      description: "Differentiate lifecycle by line style, brightness, and opacity first.",
      controls: [
        { type: "select", key: "statusEncoding", label: "Status encoding", description: "How inactive lines fade away in preview.", options: [
          { value: "line_style", label: "Line style" },
          { value: "line_style_plus_hue", label: "Line style + hue" },
        ] },
        { type: "toggle", key: "showBranchAtCurrentZoom", label: "Show branch at current zoom", description: "Whether branch lines participate at the current zoom gate." },
        { type: "toggle", key: "showServiceLines", label: "Show service lines", description: "Keep service lines off unless deliberately reviewing them." },
        { type: "select", key: "stationSymbolPreset", label: "Station symbol", description: "Symbol treatment for major stations.", options: [
          { value: "dot_ring", label: "Dot ring" },
          { value: "solid_dot", label: "Solid dot" },
          { value: "quiet_square", label: "Quiet square" },
        ] },
      ],
    },
    {
      key: "style",
      title: "Style",
      description: "These controls style only the future rail overlay shell.",
      controls: [
        { type: "range", key: "lineOpacity", label: "Line opacity", description: "Overall rail line opacity.", min: 40, max: 100, step: 1, unit: "%" },
        { type: "range", key: "stationOpacity", label: "Station opacity", description: "Overall major-station opacity.", min: 35, max: 100, step: 1, unit: "%" },
        { type: "range", key: "inactiveFadeStrength", label: "Inactive fade strength", description: "How strongly inactive lifecycle states fade.", min: 0, max: 100, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Diagnostics", description: "Explain reconciliation intent only. Do not fabricate pack statistics.", kind: "diagnostics" },
  ],
  airport: [
    {
      key: "facility_scope",
      title: "Facility Scope",
      description: "Keep the first airport pass deterministic and point-only.",
      controls: [
        { type: "multi", key: "airportTypes", label: "Airport types", options: AIRPORT_TYPE_OPTIONS, description: "Select which official airport classes remain visible." },
        { type: "multi", key: "statuses", label: "Statuses", options: AIRPORT_STATUS_OPTIONS, description: "Filter airport status using normalized official status categories." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Hide lower-importance airports before render.", options: [
          { value: "national_core", label: "National core" },
          { value: "regional_core", label: "Regional core" },
          { value: "local_connector", label: "Local connector" },
        ] },
      ],
    },
    {
      key: "visibility",
      title: "Visibility",
      description: "Keep label reveal simple and intentional.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose airport names only when the current zoom can carry them cleanly." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively airport names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Style",
      description: "These controls style only the airport overlay shell.",
      controls: [
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall airport point opacity.", min: 35, max: 100, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Diagnostics", description: "Expose airport adapter intent and pack status only.", kind: "diagnostics" },
  ],
  port: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Keep ports inspect-first, but allow aggregate and density views when the official layer becomes crowded.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for ports.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds, not fixed counts.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Aggregation stays dynamic and only steps in when the current view becomes dense.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how dense port points should be summarized.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Labels use geographic anchors first, then category when the map can carry it.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels to keep on screen before label aggregation kicks in.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values spread labels further apart.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Facility Scope",
      description: "Filter the currently selected official coverage tier without introducing a second tier control.",
      controls: [
        { type: "multi", key: "legalDesignations", label: "Legal designations", options: PORT_DESIGNATION_OPTIONS, description: "Select which official port legal classes remain visible." },
        { type: "multi", key: "managerTypes", label: "Manager types", options: PORT_MANAGER_TYPE_OPTIONS, description: "Filter by official manager type code." },
        { type: "select", key: "importanceThreshold", label: "Importance threshold", description: "Hide lower-importance ports before render.", options: [
          { value: "national_core", label: "National core" },
          { value: "regional_core", label: "Regional core" },
          { value: "local_connector", label: "Local connector" },
        ] },
      ],
    },
    {
      key: "visibility",
      title: "Visibility",
      description: "Keep port names gated by the current zoom and importance.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose port names only when the current zoom can carry them cleanly." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively port names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Style",
      description: "These controls style only the port overlay shell.",
      controls: [
        { type: "range", key: "baseOpacity", label: "Base opacity", description: "Overall port point opacity.", min: 35, max: 100, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Diagnostics", description: "Expose port adapter intent and release constraints only.", kind: "diagnostics" },
  ],
  mineral_resources: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Mineral review defaults to aggregation so dense mine points reveal pattern before single-site inspection.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for mineral resources.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds drive when inspect, aggregate, or density takes over.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Grid-based aggregation works better than raw point carpets for dense mineral clusters.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how mineral points should be aggregated.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["hex", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Prefer geographic anchors with dominant resource category, then back off when the map gets crowded.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated mineral labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels kept before geographic label merge takes over.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep mineral labels opt-in so dense point fields stay readable.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose mineral labels only during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively mineral labels are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      description: "These controls only affect the mineral point overlay shell.",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall mineral point opacity.", min: 28, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the mineral point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Data Check", description: "Keep pack scope, visible site count, and source governance visible during review.", kind: "diagnostics" },
  ],
  energy_facilities: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Energy stays inspect-first, but the same mode language is available when facility density rises.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for energy facilities.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when aggregation should take over.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Aggregation is optional here, but the mode should still honor subtype-driven density shifts.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how energy facilities should summarize at lower zooms.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Subtype-driven labels should stay sparse and readable instead of repeating raw facility names everywhere.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive aggregated energy labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum labels kept before label merge kicks in.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Facility Scope",
      description: "Only approved local subtypes enter the live energy pack.",
      controls: [
        {
          type: "multi",
          key: "facilitySubtypes",
          label: "Local subtypes",
          options: ({ previewSnapshot }) => buildEnergyFacilitySubtypeControlOptions(previewSnapshot),
          description: "Choose which approved local energy subtypes remain visible.",
          defaultAllWhenEmpty: true,
        },
        { type: "multi", key: "statuses", label: "Statuses", options: ENERGY_STATUS_OPTIONS, description: "Filter energy facilities by normalized source status." },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep facility names visible only when the current zoom can carry them cleanly.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose energy facility labels during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively facility names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      description: "These controls only affect the energy point overlay shell.",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall energy point opacity.", min: 30, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the energy point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Data Check", description: "Keep local versus reference-only subtype scope and pack state visible during review.", kind: "diagnostics" },
  ],
  industrial_zones: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Industrial land defaults to aggregated pattern reading before raw polygon inspection.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for industrial land.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when polygons collapse into pattern views.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Industrial review needs pattern-first summarization without blending internal and open tracks.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how industrial land should summarize at lower zooms.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["square", "hex", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Use geographic anchors and dominant land context before falling back to fewer region labels.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive industrial labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum industrial labels kept before merge and downgrade.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "data_variant",
      title: "Source Track",
      description: "Switch between the official review track and the open publishable track without blending them.",
      controls: [
        { type: "select", key: "variant", label: "Source track", description: "Choose which industrial land source track to review in the carrier.", options: INDUSTRIAL_VARIANT_OPTIONS },
      ],
    },
    {
      key: "filtering",
      title: "Filters",
      description: "Reduce the visible land footprint without inventing a merged industrial score.",
      controls: [
        { type: "multi", key: "siteClasses", label: "Land type", options: INDUSTRIAL_SITE_CLASS_OPTIONS, description: "Keep only the industrial land types you want to inspect." },
        {
          type: "multi",
          key: "coastalModes",
          label: "Location context",
          options: INDUSTRIAL_COASTAL_OPTIONS,
          description: "This filter only applies to the internal official variant.",
          showWhen: (config) => String(config?.variant || "internal") === "internal",
        },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep names opt-in so polygon review stays readable.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose polygon names only when you want name-led review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively polygon names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      description: "These controls only affect the industrial land overlay shell in the carrier.",
      controls: [
        { type: "range", key: "fillOpacity", label: "Fill opacity", description: "Overall polygon fill opacity.", min: 18, max: 100, step: 1, unit: "%" },
        { type: "range", key: "outlineOpacity", label: "Outline opacity", description: "Overall polygon outline opacity.", min: 28, max: 100, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Data Check", description: "Keep the active source track, filter scope, and pack state visible during review.", kind: "diagnostics" },
  ],
  logistics_hubs: [
    {
      key: "display_mode",
      title: "Display Mode",
      description: "Logistics hubs default to aggregation so you can read corridors and hot zones before drilling into points.",
      controls: [
        { type: "select", key: "displayMode", label: "Mode", description: "Choose the current view language for logistics hubs.", options: TRANSPORT_WORKBENCH_DISPLAY_MODE_OPTIONS },
        { type: "select", key: "displayPreset", label: "Preset", description: "Dynamic thresholds decide when the layer moves between inspect, aggregate, and density.", options: TRANSPORT_WORKBENCH_DISPLAY_PRESET_OPTIONS },
      ],
    },
    {
      key: "aggregation_mode",
      title: "Aggregation",
      description: "Cluster and grid views are both valid here, depending on how aggressively you want to compress the point field.",
      controls: [
        { type: "select", key: "aggregationAlgorithm", label: "Algorithm", description: "Choose how logistics hubs should summarize when dense.", options: TRANSPORT_WORKBENCH_AGGREGATION_ALGORITHM_OPTIONS.filter((option) => ["cluster", "square", "density_surface"].includes(option.value)) },
      ],
    },
    {
      key: "label_strategy",
      title: "Label Strategy",
      description: "Use geographic anchors and dominant logistics function, then merge labels when corridor density spikes.",
      controls: [
        { type: "select", key: "labelLevel", label: "Label level", description: "Choose how descriptive logistics labels should be.", options: TRANSPORT_WORKBENCH_LABEL_LEVEL_OPTIONS },
        { type: "range", key: "labelBudget", label: "Label budget", description: "Maximum logistics labels kept before merge.", min: 3, max: 18, step: 1 },
        { type: "range", key: "labelSeparation", label: "Label separation", description: "Higher values increase spacing between labels.", min: 0.7, max: 1.8, step: 0.05 },
      ],
    },
    {
      key: "facility_scope",
      title: "Hub Scope",
      description: "Reduce the visible hub set while keeping the logistics layer point-based.",
      controls: [
        { type: "multi", key: "hubTypes", label: "Hub category", options: LOGISTICS_HUB_TYPE_OPTIONS, description: "Filter which logistics hub categories remain visible." },
        { type: "multi", key: "operatorClassifications", label: "Operator type", options: LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS, description: "Filter hubs by operator type." },
      ],
    },
    {
      key: "visibility",
      title: "Labels",
      description: "Keep names gated so hub points stay readable over industrial land.",
      controls: [
        { type: "toggle", key: "showLabels", label: "Show labels", description: "Expose logistics hub labels only during closer review." },
        { type: "select", key: "labelDensityPreset", label: "Label density", description: "Controls how aggressively hub names are kept on screen.", options: TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS },
      ],
    },
    {
      key: "style",
      title: "Appearance",
      description: "These controls only affect the logistics point overlay shell.",
      controls: [
        { type: "range", key: "pointOpacity", label: "Point opacity", description: "Overall logistics point opacity.", min: 30, max: 100, step: 1, unit: "%" },
        { type: "range", key: "pointSize", label: "Point size", description: "Scales the logistics point marker size.", min: 72, max: 148, step: 1, unit: "%" },
      ],
    },
    { key: "diagnostics", title: "Data Check", description: "Keep the active hub scope, visible point count, and pack state visible during review.", kind: "diagnostics" },
  ],
};

export function createTransportWorkbenchController({
  scenarioTransportWorkbenchBtn = null,
  transportAppearanceWorkbenchBtn = null,
  transportWorkbenchOverlay = null,
  transportWorkbenchPanel = null,
  transportWorkbenchInfoBtn = null,
  transportWorkbenchInfoPopover = null,
  transportWorkbenchInfoBody = null,
  transportWorkbenchSectionHelpPopover = null,
  transportWorkbenchSectionHelpTitle = null,
  transportWorkbenchSectionHelpBody = null,
  transportWorkbenchCloseBtn = null,
  transportWorkbenchResetBtn = null,
  transportWorkbenchApplyBtn = null,
  transportWorkbenchTitle = null,
  transportWorkbenchLensTitle = null,
  transportWorkbenchLensSections = null,
  transportWorkbenchFamilyStatus = null,
  transportWorkbenchCountryStatus = null,
  transportWorkbenchPreviewMode = null,
  transportWorkbenchPreviewTitle = null,
  transportWorkbenchPreviewCanvas = null,
  transportWorkbenchPreviewActions = null,
  transportWorkbenchPreviewControls = null,
  transportWorkbenchCarrierMount = null,
  transportWorkbenchLayerOrderPanel = null,
  transportWorkbenchLayerOrderList = null,
  transportWorkbenchCompareBtn = null,
  transportWorkbenchCompareStatus = null,
  transportWorkbenchZoomOutBtn = null,
  transportWorkbenchZoomInBtn = null,
  transportWorkbenchRotateBtn = null,
  transportWorkbenchInspectorTitle = null,
  transportWorkbenchInspectorTabButtons = [],
  transportWorkbenchInspectorPanels = {},
  transportWorkbenchInspectorDetails = null,
  transportWorkbenchInspectorEmptyTitle = null,
  transportWorkbenchInspectorEmptyBody = null,
  transportWorkbenchDisplaySections = null,
  transportWorkbenchAggregationSections = null,
  transportWorkbenchLabelSections = null,
  transportWorkbenchCoverageSections = null,
  transportWorkbenchDataSections = null,
  transportWorkbenchFamilyTabs = [],
} = {}) {
  const closeTransportWorkbenchInfoPopover = ({ restoreFocus = false } = {}) => {
    if (!transportWorkbenchInfoPopover) return;
    transportWorkbenchInfoPopover.classList.add("hidden");
    transportWorkbenchInfoPopover.setAttribute("aria-hidden", "true");
    transportWorkbenchInfoBtn?.setAttribute("aria-expanded", "false");
    if (restoreFocus && transportWorkbenchInfoBtn && typeof transportWorkbenchInfoBtn.focus === "function") {
      transportWorkbenchInfoBtn.focus({ preventScroll: true });
    }
  };

  let transportWorkbenchSectionHelpState = null;
  let transportWorkbenchPreviewViewSyncRaf = 0;
  let transportWorkbenchPreviewLastViewKey = "";
  let transportWorkbenchPreviewWarmupScheduled = false;
  let transportWorkbenchDraggedLayerId = "";

  const closeTransportWorkbenchSectionHelpPopover = ({ restoreFocus = false } = {}) => {
    if (!transportWorkbenchSectionHelpPopover) return;
    transportWorkbenchSectionHelpPopover.classList.add("hidden");
    transportWorkbenchSectionHelpPopover.setAttribute("aria-hidden", "true");
    if (transportWorkbenchSectionHelpState?.trigger instanceof HTMLElement) {
      transportWorkbenchSectionHelpState.trigger.setAttribute("aria-expanded", "false");
      if (restoreFocus && typeof transportWorkbenchSectionHelpState.trigger.focus === "function") {
        transportWorkbenchSectionHelpState.trigger.focus({ preventScroll: true });
      }
    }
    transportWorkbenchSectionHelpState = null;
  };

  const positionTransportWorkbenchSectionHelpPopover = (trigger) => {
    if (!(trigger instanceof HTMLElement) || !(transportWorkbenchSectionHelpPopover instanceof HTMLElement) || !(transportWorkbenchPanel instanceof HTMLElement)) {
      return;
    }
    const panelRect = transportWorkbenchPanel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const popoverWidth = transportWorkbenchSectionHelpPopover.offsetWidth || 280;
    const popoverHeight = transportWorkbenchSectionHelpPopover.offsetHeight || 140;
    let left = triggerRect.right + 10;
    let top = triggerRect.top - 4;
    const minInset = 18;
    if (left + popoverWidth > panelRect.right - minInset) {
      left = triggerRect.left - popoverWidth - 10;
    }
    left = Math.min(Math.max(left, panelRect.left + minInset), Math.max(panelRect.left + minInset, panelRect.right - popoverWidth - minInset));
    top = Math.min(Math.max(top, panelRect.top + minInset), Math.max(panelRect.top + minInset, panelRect.bottom - popoverHeight - minInset));
    transportWorkbenchSectionHelpPopover.style.left = `${left}px`;
    transportWorkbenchSectionHelpPopover.style.top = `${top}px`;
  };

  const renderTransportWorkbenchSectionHelpPopover = (familyId, sectionKey) => {
    if (!transportWorkbenchSectionHelpTitle || !transportWorkbenchSectionHelpBody) return;
    const helpCopy = TRANSPORT_WORKBENCH_INLINE_HELP_COPY[familyId]?.[sectionKey];
    if (!helpCopy) return;
    transportWorkbenchSectionHelpTitle.textContent = t(helpCopy.title, "ui");
    transportWorkbenchSectionHelpBody.replaceChildren();
    const body = document.createElement("p");
    body.className = "transport-workbench-info-text";
    body.textContent = t(helpCopy.body, "ui");
    transportWorkbenchSectionHelpBody.appendChild(body);
  };

  const toggleTransportWorkbenchSectionHelpPopover = (trigger, familyId, sectionKey) => {
    if (!transportWorkbenchSectionHelpPopover) return;
    const isSameTarget = transportWorkbenchSectionHelpState
      && transportWorkbenchSectionHelpState.familyId === familyId
      && transportWorkbenchSectionHelpState.sectionKey === sectionKey
      && transportWorkbenchSectionHelpState.trigger === trigger
      && !transportWorkbenchSectionHelpPopover.classList.contains("hidden");
    if (isSameTarget) {
      closeTransportWorkbenchSectionHelpPopover({ restoreFocus: true });
      return;
    }
    closeTransportWorkbenchInfoPopover({ restoreFocus: false });
    closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
    renderTransportWorkbenchSectionHelpPopover(familyId, sectionKey);
    transportWorkbenchSectionHelpState = { familyId, sectionKey, trigger };
    transportWorkbenchSectionHelpPopover.classList.remove("hidden");
    transportWorkbenchSectionHelpPopover.setAttribute("aria-hidden", "false");
    if (trigger instanceof HTMLElement) {
      trigger.setAttribute("aria-expanded", "true");
    }
    positionTransportWorkbenchSectionHelpPopover(trigger);
  };

  const getTransportWorkbenchDataContract = (familyId) => TRANSPORT_WORKBENCH_DATA_CONTRACTS[familyId] || null;
  const pickUiCopy = (zh, en) => (runtimeState.currentLanguage === "zh" ? zh : en);

  const renderTransportWorkbenchInfoContent = (family) => {
    if (!transportWorkbenchInfoBody) return;
    transportWorkbenchInfoBody.replaceChildren();
    const dataContract = getTransportWorkbenchDataContract(family.id);
    const defaultBlocks = [
      {
        title: "Current lens",
        body: family.lensBody,
      },
      {
        title: "Baseline",
        body: family.lensNext,
      },
      family.supportsDetailedControls
        ? {
          title: "Compare action",
          body: `Compare baseline temporarily swaps the preview to the locked ${family.label.toLowerCase()} baseline while the control is held. It never overwrites the working values in the left column.`,
        }
        : {
          title: "Availability",
          body: `${family.label} is still a reserved shell. Detailed controls stay closed until the live Japan schema and packs are wired.`,
        },
      {
        title: "Preview controls",
        body: "Use mouse wheel or the + / - controls to zoom. The 90° button swaps between the default north-up view and the quarter-turn inspection view. Reset View restores the framed default preview.",
      },
      dataContract
        ? {
          title: "Data path",
          body: `${dataContract.adapterId} stays on ${dataContract.packs.join(" + ")} using ${dataContract.geometrySource} with ${dataContract.hardeningSource}. Keep the pack build reproducible and diagnostics-friendly so rule changes can be traced later.`,
        }
        : null,
    ];
    const blocks = family.id === "layers"
      ? [
        {
          title: pickUiCopy("当前用途", "Current use"),
          body: pickUiCopy(
            "Layers 用来调整 transport families 的当前本地绘制顺序。中间排序板负责拖拽重排，Inspect 会同步回显当前顺序。",
            "Layers controls the current local draw order for transport families. Use the center board to drag and reorder families, and use Inspect to review the active order."
          ),
        },
        {
          title: pickUiCopy("排序板行为", "Board behavior"),
          body: pickUiCopy(
            "Layers 使用排序板模式。这里没有缩放、旋转或基线对比，重点是确认绘制顺序和 family 状态。",
            "Layers uses board mode. Zoom, rotate, and baseline compare are hidden here, and the main task is confirming draw order and family status."
          ),
        },
        {
          title: pickUiCopy("Inspector 分工", "Inspector role"),
          body: pickUiCopy(
            "左侧只保留上下文说明，真正的顺序确认在中间排序板和右侧 Inspect。其余页签继续保留统一结构，方便以后接入更多帮助内容。",
            "The left column keeps context only, while the center board and right-side Inspect confirm the active order. The remaining tabs stay in place so later help and controls can land without changing the shell."
          ),
        },
      ]
      : defaultBlocks;

    blocks.filter(Boolean).forEach((block) => {
      const node = document.createElement("section");
      node.className = "transport-workbench-info-block";
      const title = document.createElement("div");
      title.className = "transport-workbench-info-subtitle";
      title.textContent = t(block.title, "ui");
      const body = document.createElement("p");
      body.className = "transport-workbench-info-text";
      body.textContent = t(block.body, "ui");
      node.append(title, body);
      transportWorkbenchInfoBody.appendChild(node);
    });
  };

  const toggleTransportWorkbenchInfoPopover = () => {
    if (!transportWorkbenchInfoPopover) return;
    const willOpen = transportWorkbenchInfoPopover.classList.contains("hidden");
    if (!willOpen) {
      closeTransportWorkbenchInfoPopover({ restoreFocus: true });
      return;
    }
    closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
    renderTransportWorkbenchInfoContent(getTransportWorkbenchFamilyMeta());
    rememberOverlayTrigger(transportWorkbenchInfoPopover, transportWorkbenchInfoBtn);
    transportWorkbenchInfoPopover.classList.remove("hidden");
    transportWorkbenchInfoPopover.setAttribute("aria-hidden", "false");
    transportWorkbenchInfoBtn?.setAttribute("aria-expanded", "true");
    focusOverlaySurface(transportWorkbenchInfoPopover);
  };

  const getTransportWorkbenchFamilyMeta = () => {
    ensureTransportWorkbenchUiState();
    const activeFamily = normalizeTransportWorkbenchFamily(runtimeState.transportWorkbenchUi.activeFamily);
    return TRANSPORT_WORKBENCH_FAMILIES.find((family) => family.id === activeFamily) || TRANSPORT_WORKBENCH_FAMILIES[0];
  };

  const getTransportWorkbenchWorkingConfig = (familyId, { baseline = false } = {}) => {
    ensureTransportWorkbenchUiState();
    if (baseline) {
      return TRANSPORT_WORKBENCH_BASELINE_CONFIGS[familyId]
        ? JSON.parse(JSON.stringify(TRANSPORT_WORKBENCH_BASELINE_CONFIGS[familyId]))
        : null;
    }
    if (familyId === "road") return runtimeState.transportWorkbenchUi.familyConfigs.road;
    if (familyId === "rail") return runtimeState.transportWorkbenchUi.familyConfigs.rail;
    if (familyId === "airport") return runtimeState.transportWorkbenchUi.familyConfigs.airport;
    if (familyId === "port") return runtimeState.transportWorkbenchUi.familyConfigs.port;
    if (familyId === "mineral_resources") return runtimeState.transportWorkbenchUi.familyConfigs.mineral_resources;
    if (familyId === "energy_facilities") return runtimeState.transportWorkbenchUi.familyConfigs.energy_facilities;
    if (familyId === "industrial_zones") return runtimeState.transportWorkbenchUi.familyConfigs.industrial_zones;
    if (familyId === "logistics_hubs") return runtimeState.transportWorkbenchUi.familyConfigs.logistics_hubs;
    return null;
  };

  const getTransportWorkbenchDisplayConfig = (familyId, { baseline = false } = {}) => {
    ensureTransportWorkbenchUiState();
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId)) {
      return createDefaultTransportWorkbenchDisplayConfig(familyId);
    }
    if (baseline) {
      return createDefaultTransportWorkbenchDisplayConfig(familyId);
    }
    return normalizeTransportWorkbenchDisplayConfig(
      runtimeState.transportWorkbenchUi.displayConfigs?.[familyId],
      familyId
    );
  };

  const buildTransportWorkbenchResolvedConfig = (familyId, familyConfig, displayConfig) => {
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId)) {
      return familyConfig;
    }
    const resolvedDisplayConfig = normalizeTransportWorkbenchDisplayConfig(displayConfig, familyId);
    return {
      ...(familyConfig || {}),
      displayConfig: resolvedDisplayConfig,
      displayMode: resolvedDisplayConfig.mode,
      displayPreset: resolvedDisplayConfig.preset,
      aggregationAlgorithm: resolvedDisplayConfig.aggregation.algorithm,
      aggregationAutoSwitch: !!resolvedDisplayConfig.aggregation.autoSwitch,
      aggregationCellSizePx: Number(resolvedDisplayConfig.aggregation.thresholds?.cellSizePx || 44),
      aggregationClusterRadiusPx: Number(resolvedDisplayConfig.aggregation.thresholds?.clusterRadiusPx || 48),
      labelBudget: Number(resolvedDisplayConfig.labels?.budget || 8),
      labelSeparation: Number(resolvedDisplayConfig.labels?.separationStrength || 0.65),
      labelLevel: mapTransportWorkbenchMaxLevelToLabelLevel(resolvedDisplayConfig.labels?.maxLevel),
      labelAllowAggregation: !!resolvedDisplayConfig.labels?.allowAggregation,
      dominantCategoryThreshold: Number(resolvedDisplayConfig.labels?.dominantCategoryThreshold || 0.62),
      mixedCategoryMode: resolvedDisplayConfig.labels?.mixedCategoryMode || "summary",
      coverageTier: resolvedDisplayConfig.coverage || "default",
    };
  };

  const formatTransportWorkbenchOptionLabels = (values, options) => {
    const labelByValue = new Map((options || []).map((option) => [option.value, option.label]));
    return (values || []).map((value) => labelByValue.get(value) || value).join(", ");
  };

  const getTransportWorkbenchConfigSignature = (config) => JSON.stringify(config || {});

  const formatTransportWorkbenchManifestTimestamp = (value) => {
    const text = String(value || "").trim();
    if (!text) return "unknown";
    return text.replace("T", " ").replace("Z", " UTC");
  };

  const buildManifestOnlyInspectorRows = (family, previewSnapshot, dataContract) => {
    if (previewSnapshot?.status === "error") {
      return [
        ["Pack status", `${family.label} pack failed to load`],
        ["Error", previewSnapshot.error || "Unknown error"],
        ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ];
    }
    if (previewSnapshot?.status !== "ready") {
      return [
        ["Adapter", dataContract?.adapterId || `japan_${family.id}_v1`],
        ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || `Waiting for ${family.label} Japan pack`) : `Loading ${family.label} Japan pack`],
      ];
    }

    const manifest = previewSnapshot.manifest || {};
    const audit = previewSnapshot.audit || {};
    const previewCounts = manifest?.feature_counts?.preview || {};
    const fullCounts = manifest?.feature_counts?.full || {};
    const variantEntries = listTransportWorkbenchManifestVariantEntries(manifest);
    const rows = [
      ["Pack version", manifest.adapter_id || dataContract?.adapterId || `japan_${family.id}_v1`],
      ["Recipe version", manifest.recipe_version || audit.recipe_version || "unknown"],
      ["Distribution tier", manifest.distribution_tier || "unknown"],
      ["License tier", manifest.license_tier || "unknown"],
      ["Coverage scope", manifest.coverage_scope || "unknown"],
      ["Source policy", manifest.source_policy || "unknown"],
      ["Last build", formatTransportWorkbenchManifestTimestamp(manifest.generated_at)],
      ["Preview features", JSON.stringify(previewCounts || {})],
      ["Full features", JSON.stringify(fullCounts || {})],
    ];

    if (variantEntries.length > 0) {
      const variantSummaries = variantEntries.map(([variantId, variantMeta]) => {
        const count = variantMeta?.feature_counts?.full?.industrial_zones
          ?? variantMeta?.feature_counts?.full?.logistics_hubs
          ?? variantMeta?.feature_counts?.full
          ?? 0;
        return `${variantId} (${typeof count === "number" ? count : JSON.stringify(count)})`;
      });
      rows.push(
        ["Default variant", getTransportWorkbenchManifestDefaultVariantId(manifest, family.id)],
        ["Variants", variantSummaries.join(", ") || "none"],
      );
    }

    if (Array.isArray(previewSnapshot?.subtypeCatalog) && family.id === "energy_facilities") {
      const localSubtypes = previewSnapshot.subtypeCatalog
        .filter((entry) => entry.availability === "local")
        .map((entry) => `${entry.subtype_id} (${entry.feature_count || 0})`);
      const referenceOnlySubtypes = previewSnapshot.subtypeCatalog
        .filter((entry) => entry.availability === "reference_only")
        .map((entry) => entry.subtype_id);
      rows.push(
        ["Local subtypes", localSubtypes.length ? localSubtypes.join(", ") : "none"],
        ["Reference-only subtypes", referenceOnlySubtypes.length ? referenceOnlySubtypes.join(", ") : "none"],
      );
    }
    return rows;
  };

  const setTransportWorkbenchCompareHeld = (nextHeld) => {
    ensureTransportWorkbenchUiState();
    const family = getTransportWorkbenchFamilyMeta();
    if (!family.supportsDetailedControls) return;
    const normalized = !!nextHeld;
    if (runtimeState.transportWorkbenchUi.compareHeld === normalized) return;
    runtimeState.transportWorkbenchUi.compareHeld = normalized;
    renderTransportWorkbenchUi();
  };

  const updateTransportWorkbenchFamilyConfig = (familyId, key, nextValue, { appendValue = null } = {}) => {
    ensureTransportWorkbenchUiState();
    const family = TRANSPORT_WORKBENCH_FAMILIES.find((entry) => entry.id === familyId);
    if (!family?.supportsDetailedControls || runtimeState.transportWorkbenchUi.compareHeld) return;
    const current = JSON.parse(JSON.stringify(getTransportWorkbenchWorkingConfig(familyId) || {}));
    if (appendValue !== null) {
      const currentValues = Array.isArray(current[key]) ? [...current[key]] : [];
      const index = currentValues.indexOf(appendValue);
      if (nextValue) {
        if (index === -1) currentValues.push(appendValue);
      } else if (index !== -1) {
        currentValues.splice(index, 1);
      }
      current[key] = currentValues;
    } else {
      current[key] = nextValue;
    }
    if (familyId === "road") {
      runtimeState.transportWorkbenchUi.familyConfigs.road = normalizeRoadTransportWorkbenchConfig(current);
    } else if (familyId === "rail") {
      runtimeState.transportWorkbenchUi.familyConfigs.rail = normalizeRailTransportWorkbenchConfig(current);
    } else if (familyId === "airport") {
      runtimeState.transportWorkbenchUi.familyConfigs.airport = normalizeAirportTransportWorkbenchConfig(current);
    } else if (familyId === "port") {
      runtimeState.transportWorkbenchUi.familyConfigs.port = normalizePortTransportWorkbenchConfig(current);
    } else if (familyId === "mineral_resources") {
      runtimeState.transportWorkbenchUi.familyConfigs.mineral_resources = normalizeMineralResourceTransportWorkbenchConfig(current);
    } else if (familyId === "energy_facilities") {
      runtimeState.transportWorkbenchUi.familyConfigs.energy_facilities = normalizeEnergyFacilityTransportWorkbenchConfig(current);
    } else if (familyId === "industrial_zones") {
      runtimeState.transportWorkbenchUi.familyConfigs.industrial_zones = normalizeIndustrialTransportWorkbenchConfig(current);
    } else if (familyId === "logistics_hubs") {
      runtimeState.transportWorkbenchUi.familyConfigs.logistics_hubs = normalizeLogisticsHubTransportWorkbenchConfig(current);
    }
    markDirty("transport-workbench-config");
    const nextContext = getTransportWorkbenchRenderContext();
    renderTransportWorkbenchLensSections(nextContext.family, nextContext.config, nextContext.compareHeld);
    renderTransportWorkbenchInspectorTabs(nextContext.family, nextContext.config, nextContext.compareHeld);
    renderTransportWorkbenchInspector(nextContext.family, nextContext.config, nextContext.compareHeld);
    refreshTransportWorkbenchPreview(nextContext, { allowCarrierPrep: false });
  };

  const updateTransportWorkbenchDisplayConfig = (familyId, updateFn) => {
    ensureTransportWorkbenchUiState();
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(familyId) || typeof updateFn !== "function") return;
    const current = getTransportWorkbenchDisplayConfig(familyId);
    const draft = JSON.parse(JSON.stringify(current));
    updateFn(draft);
    runtimeState.transportWorkbenchUi.displayConfigs[familyId] = normalizeTransportWorkbenchDisplayConfig(draft, familyId);
    markDirty("transport-workbench-display-config");
    const nextContext = getTransportWorkbenchRenderContext();
    renderTransportWorkbenchLensSections(nextContext.family, nextContext.config, nextContext.compareHeld);
    renderTransportWorkbenchInspectorTabs(nextContext.family, nextContext.config, nextContext.compareHeld);
    renderTransportWorkbenchInspector(nextContext.family, nextContext.config, nextContext.compareHeld);
    refreshTransportWorkbenchPreview(nextContext, { allowCarrierPrep: false });
  };

  const toggleTransportWorkbenchSection = (familyId, sectionKey, nextOpen) => {
    ensureTransportWorkbenchUiState();
    if (!runtimeState.transportWorkbenchUi.sectionOpen[familyId]) {
      runtimeState.transportWorkbenchUi.sectionOpen[familyId] = {};
    }
    runtimeState.transportWorkbenchUi.sectionOpen[familyId][sectionKey] = !!nextOpen;
  };

  const createTransportWorkbenchInspectorRow = (label, value) => {
    const row = document.createElement("div");
    row.className = "transport-workbench-inspector-row";
    const labelNode = document.createElement("span");
    labelNode.className = "transport-workbench-inspector-key";
    labelNode.textContent = label;
    const valueNode = document.createElement("span");
    valueNode.className = "transport-workbench-inspector-value";
    valueNode.textContent = value;
    row.appendChild(labelNode);
    row.appendChild(valueNode);
    return row;
  };

  const createTransportWorkbenchInspectorStateCard = (titleText, bodyText, tone = "soft") => {
    const card = document.createElement("div");
    card.className = "transport-workbench-note-card transport-workbench-inspector-state-card";
    if (tone === "emphasis") {
      card.classList.add("transport-workbench-note-card-emphasis");
    } else {
      card.classList.add("transport-workbench-note-card-soft");
    }
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = titleText;
    const body = document.createElement("p");
    body.className = "transport-workbench-note-text";
    body.textContent = bodyText;
    card.append(title, body);
    return card;
  };

  const formatTransportWorkbenchRoadHiddenReason = (reason) => {
    const map = {
      class_filtered: "Filtered by class",
      link_filtered: "Filtered by link rule",
      short_projected_segment: "Dropped by min projected length",
      short_primary: "Dropped as short primary",
      dense_metro_guard: "Dropped by dense metro guard",
      zoom_gate: "Hidden by zoom gate",
    };
    return map[String(reason || "").trim()] || "Visible";
  };

  const buildTransportWorkbenchDiagnosticRows = (familyId, config) => {
    if (familyId === "road") {
      return [
        ["Data intake", `${formatTransportWorkbenchOptionLabels(config.roadClass, ROAD_CLASS_OPTIONS)} only`],
        ["Source recipe", config.motorwayIdentitySource === "osm_only" ? "OSM only" : "OSM + N06 hardening"],
        ["Label scope", config.showRefs ? `${formatTransportWorkbenchOptionLabels(config.refClasses, ROAD_CLASS_OPTIONS)} refs` : "Refs hidden"],
        ["Noise gate", `${config.denseMetroGuard} metro guard / ${config.minProjectedSegmentPx}px min segment`],
        ["Line widths", `M ${config.motorwayWidth}px / T ${config.trunkWidth}px / P ${config.primaryWidth}px`],
      ];
    }
    if (familyId === "rail") {
      return [
        ["Network scope", formatTransportWorkbenchOptionLabels(config.class, RAIL_CLASS_OPTIONS)],
        ["Status scope", formatTransportWorkbenchOptionLabels(config.status, RAIL_STATUS_OPTIONS)],
        ["Reconciliation", config.allowOsmActiveGapFill ? "Official active + OSM gap fill" : "Official active locked"],
        ["Station policy", config.showMajorStations ? `${config.importanceThreshold} threshold` : "Major stations hidden"],
      ];
    }
    if (familyId === "airport") {
      return [
        ["Airport types", formatTransportWorkbenchOptionLabels(config.airportTypes, AIRPORT_TYPE_OPTIONS)],
        ["Status scope", formatTransportWorkbenchOptionLabels(config.statuses, AIRPORT_STATUS_OPTIONS)],
        ["Importance", config.importanceThreshold],
        ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ];
    }
    if (familyId === "port") {
      return [
        ["Display mode", `${config.displayMode} / ${config.displayPreset}`],
        ["Aggregation", config.aggregationAlgorithm],
        ["Coverage tier", config.coverageTier || "core"],
        ["Legal designations", formatTransportWorkbenchOptionLabels(config.legalDesignations, PORT_DESIGNATION_OPTIONS)],
        ["Manager types", formatTransportWorkbenchOptionLabels(config.managerTypes, PORT_MANAGER_TYPE_OPTIONS)],
        ["Labels", config.showLabels ? `Enabled (${config.labelLevel}, budget ${config.labelBudget})` : "Hidden"],
      ];
    }
    if (familyId === "mineral_resources") {
      return [
        ["Display mode", `${config.displayMode} / ${config.displayPreset}`],
        ["Aggregation", config.aggregationAlgorithm],
        ["Labels", config.showLabels ? `Enabled (${config.labelLevel}, budget ${config.labelBudget})` : "Hidden"],
        ["Point size", `${config.pointSize}%`],
      ];
    }
    if (familyId === "energy_facilities") {
      return [
        ["Display mode", `${config.displayMode} / ${config.displayPreset}`],
        ["Aggregation", config.aggregationAlgorithm],
        ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, ENERGY_STATUS_OPTIONS)],
        ["Labels", config.showLabels ? `Enabled (${config.labelLevel}, budget ${config.labelBudget})` : "Hidden"],
      ];
    }
    if (familyId === "industrial_zones") {
      return [
        ["Display mode", `${config.displayMode} / ${config.displayPreset}`],
        ["Aggregation", config.aggregationAlgorithm],
        ["Source track", normalizeTransportWorkbenchEnum(config.variant, INDUSTRIAL_VARIANT_OPTIONS.map((option) => option.value), "internal")],
        ["Land type", formatTransportWorkbenchOptionLabels(config.siteClasses, INDUSTRIAL_SITE_CLASS_OPTIONS)],
        ["Location context", String(config.variant || "internal") === "internal" ? formatTransportWorkbenchOptionLabels(config.coastalModes, INDUSTRIAL_COASTAL_OPTIONS) : "Not used on open track"],
        ["Labels", config.showLabels ? `Enabled (${config.labelLevel}, budget ${config.labelBudget})` : "Hidden"],
      ];
    }
    if (familyId === "logistics_hubs") {
      return [
        ["Display mode", `${config.displayMode} / ${config.displayPreset}`],
        ["Aggregation", config.aggregationAlgorithm],
        ["Hub category", formatTransportWorkbenchOptionLabels(config.hubTypes, LOGISTICS_HUB_TYPE_OPTIONS)],
        ["Operator type", formatTransportWorkbenchOptionLabels(config.operatorClassifications, LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS)],
        ["Labels", config.showLabels ? `Enabled (${config.labelLevel}, budget ${config.labelBudget})` : "Hidden"],
        ["Point size", `${config.pointSize}%`],
      ];
    }
    return [];
  };

  const renderTransportWorkbenchDiagnosticsBody = (familyId, config) => {
    const body = document.createElement("div");
    body.className = "transport-workbench-section-body transport-workbench-section-body-diagnostics";
    buildTransportWorkbenchDiagnosticRows(familyId, config).forEach(([label, value]) => {
      body.appendChild(createTransportWorkbenchInspectorRow(label, value));
    });
    return body;
  };

  const createTransportWorkbenchSectionHelpButton = (familyId, section) => {
    if (!TRANSPORT_WORKBENCH_INLINE_HELP_SECTIONS[familyId]?.has(section.key)) {
      return null;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "transport-workbench-section-help-btn";
    button.textContent = "?";
    const helpLabel = t("Open section help", "ui");
    button.setAttribute("aria-label", helpLabel);
    button.setAttribute("title", helpLabel);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTransportWorkbenchSectionHelpPopover(button, familyId, section.key);
    });
    return button;
  };

  const getTransportWorkbenchLayerFamilyMeta = (familyId) => (
    TRANSPORT_WORKBENCH_FAMILIES.find((family) => family.id === familyId)
    || TRANSPORT_WORKBENCH_FAMILIES[0]
  );

  const renderTransportWorkbenchLayerOrderPanel = () => {
    if (!transportWorkbenchLayerOrderPanel || !transportWorkbenchLayerOrderList) return;
    ensureTransportWorkbenchUiState();
    transportWorkbenchLayerOrderList.replaceChildren();
    runtimeState.transportWorkbenchUi.layerOrder.forEach((familyId) => {
      const family = getTransportWorkbenchLayerFamilyMeta(familyId);
      const item = document.createElement("div");
      item.className = "transport-workbench-layer-order-item";
      item.draggable = true;
      item.dataset.layerFamily = family.id;

      item.addEventListener("dragstart", () => {
        transportWorkbenchDraggedLayerId = family.id;
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        transportWorkbenchDraggedLayerId = "";
        item.classList.remove("is-dragging");
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!transportWorkbenchDraggedLayerId || transportWorkbenchDraggedLayerId === family.id) return;
        const nextOrder = [...runtimeState.transportWorkbenchUi.layerOrder];
        const draggedIndex = nextOrder.indexOf(transportWorkbenchDraggedLayerId);
        const targetIndex = nextOrder.indexOf(family.id);
        if (draggedIndex === -1 || targetIndex === -1) return;
        nextOrder.splice(draggedIndex, 1);
        nextOrder.splice(targetIndex, 0, transportWorkbenchDraggedLayerId);
        runtimeState.transportWorkbenchUi.layerOrder = nextOrder;
        markDirty("transport-workbench-layer-order");
        const context = getTransportWorkbenchRenderContext();
        renderTransportWorkbenchLayerOrderPanel();
        renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
      });

      const handle = document.createElement("span");
      handle.className = "transport-workbench-layer-order-handle";
      handle.textContent = ":::";

      const meta = document.createElement("div");
      meta.className = "transport-workbench-layer-order-meta";
      const name = document.createElement("div");
      name.className = "transport-workbench-layer-order-name";
      name.textContent = t(family.label, "ui");
      const caption = document.createElement("div");
      caption.className = "transport-workbench-layer-order-caption";
      caption.textContent = t(
        isTransportWorkbenchLivePreviewFamily(family.id)
          ? "Live preview is already wired into the Japan carrier."
          : isTransportWorkbenchManifestOnlyRuntimeFamily(family.id)
            ? "Inspector now reads the live manifest and build audit."
            : "Reserved family shell. Real renderer attaches later.",
        "ui"
      );
      meta.append(name, caption);

      const status = document.createElement("span");
      status.className = "transport-workbench-layer-order-state";
      status.textContent = t(
        isTransportWorkbenchLivePreviewFamily(family.id)
          ? "Live now"
          : isTransportWorkbenchManifestOnlyRuntimeFamily(family.id)
            ? "Metadata live"
            : "Reserved",
        "ui"
      );
      if (isTransportWorkbenchLivePreviewFamily(family.id)) {
        status.classList.add("is-live");
      }

      item.append(handle, meta, status);
      transportWorkbenchLayerOrderList.appendChild(item);
    });
  };

  const renderTransportWorkbenchControl = (familyId, control, config, compareHeld) => {
    const previewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot(familyId, config);
    const resolvedOptions = typeof control.options === "function"
      ? (control.options({ familyId, config, previewSnapshot }) || [])
      : (control.options || []);
    const field = document.createElement("div");
    field.className = "transport-workbench-field";
    const title = document.createElement("div");
    title.className = "transport-workbench-field-title";
    title.textContent = t(control.label, "ui");
    field.appendChild(title);

    if (control.type === "toggle") {
      const label = document.createElement("label");
      label.className = "transport-workbench-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!config[control.key];
      input.disabled = compareHeld;
      input.addEventListener("change", () => updateTransportWorkbenchFamilyConfig(familyId, control.key, input.checked));
      const text = document.createElement("span");
      text.textContent = t(input.checked ? "Enabled" : "Disabled", "ui");
      input.addEventListener("change", () => {
        text.textContent = t(input.checked ? "Enabled" : "Disabled", "ui");
      });
      label.appendChild(input);
      label.appendChild(text);
      field.appendChild(label);
      return field;
    }

    if (control.type === "select") {
      const select = document.createElement("select");
      select.className = "select-input transport-workbench-select";
      select.disabled = compareHeld;
      resolvedOptions.forEach((option) => {
        const optionNode = document.createElement("option");
        optionNode.value = option.value;
        optionNode.textContent = t(option.label, "ui");
        optionNode.selected = option.value === config[control.key];
        select.appendChild(optionNode);
      });
      select.addEventListener("change", () => updateTransportWorkbenchFamilyConfig(familyId, control.key, select.value));
      field.appendChild(select);
      return field;
    }

    if (control.type === "range") {
      const rangeRow = document.createElement("div");
      rangeRow.className = "transport-workbench-range-row";
      const range = document.createElement("input");
      range.type = "range";
      range.className = "transport-workbench-range";
      range.min = String(control.min);
      range.max = String(control.max);
      range.step = String(control.step || 1);
      range.value = String(config[control.key]);
      range.disabled = compareHeld;
      const value = document.createElement("span");
      value.className = "transport-workbench-range-value";
      const formatRangeValue = (rawValue) => {
        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue)) return `${rawValue}${control.unit || ""}`;
        if (String(control.step || "").includes(".")) {
          return `${numericValue.toFixed(2).replace(/\.?0+$/, "")}${control.unit || ""}`;
        }
        return `${numericValue}${control.unit || ""}`;
      };
      value.textContent = formatRangeValue(config[control.key]);
      range.addEventListener("input", () => {
        value.textContent = formatRangeValue(range.value);
      });
      range.addEventListener("change", () => {
        updateTransportWorkbenchFamilyConfig(familyId, control.key, Number(range.value));
      });
      rangeRow.appendChild(range);
      rangeRow.appendChild(value);
      field.appendChild(rangeRow);
      return field;
    }

    if (control.type === "multi") {
      const optionGrid = document.createElement("div");
      optionGrid.className = "transport-workbench-option-grid";
      const defaultValuesWhenEmpty = control.defaultAllWhenEmpty
        ? resolvedOptions.filter((option) => !option.disabled).map((option) => option.value)
        : [];
      resolvedOptions.forEach((option) => {
        const label = document.createElement("label");
        label.className = "transport-workbench-option-pill";
        if (option.disabled) {
          label.classList.add("is-disabled");
        }
        const input = document.createElement("input");
        input.type = "checkbox";
        const configuredValues = Array.isArray(config[control.key]) ? config[control.key] : [];
        const effectiveValues = configuredValues.length === 0 && control.defaultAllWhenEmpty
          ? defaultValuesWhenEmpty
          : configuredValues;
        input.checked = effectiveValues.includes(option.value);
        input.disabled = compareHeld || !!option.disabled;
        input.addEventListener("change", () => {
          if (control.defaultAllWhenEmpty) {
            const nextValues = [...effectiveValues];
            const valueIndex = nextValues.indexOf(option.value);
            if (input.checked) {
              if (valueIndex === -1) nextValues.push(option.value);
            } else if (valueIndex !== -1) {
              nextValues.splice(valueIndex, 1);
            }
            updateTransportWorkbenchFamilyConfig(familyId, control.key, nextValues);
            return;
          }
          updateTransportWorkbenchFamilyConfig(familyId, control.key, input.checked, { appendValue: option.value });
        });
        const text = document.createElement("span");
        text.textContent = t(option.label, "ui");
        label.appendChild(input);
        label.appendChild(text);
        optionGrid.appendChild(label);
      });
      field.appendChild(optionGrid);
      return field;
    }

    return field;
  };

  const createTransportWorkbenchSectionNode = (family, section, config, compareHeld) => {
    const visibleControls = (section.controls || []).filter((control) => (
      typeof control.showWhen !== "function" || control.showWhen(config)
    ));
    if (section.kind !== "diagnostics" && visibleControls.length === 0) {
      return null;
    }
    const details = document.createElement("details");
    details.className = "transport-workbench-section";
    details.open = !!runtimeState.transportWorkbenchUi.sectionOpen?.[family.id]?.[section.key];
    details.addEventListener("toggle", () => {
      toggleTransportWorkbenchSection(family.id, section.key, details.open);
    });
    const summary = document.createElement("summary");
    summary.className = "transport-workbench-section-summary";
    const heading = document.createElement("div");
    heading.className = "transport-workbench-section-heading";
    const title = document.createElement("div");
    title.className = "transport-workbench-section-title";
    title.textContent = t(section.title, "ui");
    const actions = document.createElement("div");
    actions.className = "transport-workbench-section-actions";
    const helpButton = createTransportWorkbenchSectionHelpButton(family.id, section);
    if (helpButton) {
      actions.appendChild(helpButton);
    }
    const chevron = document.createElement("span");
    chevron.className = "transport-workbench-section-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    actions.appendChild(chevron);
    heading.appendChild(title);
    summary.appendChild(heading);
    summary.appendChild(actions);
    details.appendChild(summary);
    const body = section.kind === "diagnostics"
      ? renderTransportWorkbenchDiagnosticsBody(family.id, config)
      : document.createElement("div");
    if (section.kind !== "diagnostics") {
      body.className = "transport-workbench-section-body";
      if (section.description) {
        const description = document.createElement("p");
        description.className = "transport-workbench-section-description";
        description.textContent = t(section.description, "ui");
        body.appendChild(description);
      }
      visibleControls.forEach((control) => {
        body.appendChild(renderTransportWorkbenchControl(family.id, control, config, compareHeld));
      });
    } else if (section.description) {
      const description = document.createElement("p");
      description.className = "transport-workbench-section-description transport-workbench-section-description-diagnostics";
      description.textContent = t(section.description, "ui");
      body.prepend(description);
    }
    details.appendChild(body);
    return details;
  };

  const createTransportWorkbenchShellCard = (family, tabId, config) => {
    if (!TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)) {
      return null;
    }
    const displayConfig = getTransportWorkbenchDisplayConfig(family.id);
    const card = document.createElement("div");
    card.className = "transport-workbench-note-card transport-workbench-note-card-soft transport-workbench-shell-card";
    const heading = document.createElement("div");
    heading.className = "transport-workbench-shell-heading";
    const title = document.createElement("div");
    title.className = "transport-workbench-note-title";
    title.textContent = t(
      tabId === "display"
        ? "Display settings"
        : tabId === "aggregation"
          ? "Aggregation settings"
          : tabId === "labels"
            ? "Label settings"
            : "Coverage settings",
      "ui"
    );
    const kicker = document.createElement("span");
    kicker.className = "transport-workbench-shell-kicker";
    kicker.textContent = t("Current settings", "ui");
    heading.append(title, kicker);
    card.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "transport-workbench-shell-grid";
    const addShellSelect = (labelText, value, options, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = t(labelText, "ui");
      const select = document.createElement("select");
      select.className = "select-input transport-workbench-select";
      options.forEach((option) => {
        const optionNode = document.createElement("option");
        optionNode.value = option.value;
        optionNode.textContent = t(option.label, "ui");
        optionNode.selected = option.value === value;
        select.appendChild(optionNode);
      });
      select.addEventListener("change", () => onChange(select.value));
      control.append(label, select);
      mountTarget.appendChild(control);
    };
    const addShellRange = (labelText, value, min, max, step, unit, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = t(labelText, "ui");
      const row = document.createElement("div");
      row.className = "transport-workbench-range-row";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "transport-workbench-range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const valueNode = document.createElement("span");
      valueNode.className = "transport-workbench-range-value";
      valueNode.textContent = `${value}${unit}`;
      input.addEventListener("input", () => {
        valueNode.textContent = `${input.value}${unit}`;
      });
      input.addEventListener("change", () => onChange(Number(input.value)));
      row.append(input, valueNode);
      control.append(label, row);
      mountTarget.appendChild(control);
    };
    const addShellToggle = (labelText, checked, onChange, mountTarget = grid) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = t(labelText, "ui");
      const toggle = document.createElement("label");
      toggle.className = "transport-workbench-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!checked;
      const text = document.createElement("span");
      text.textContent = input.checked ? t("Enabled", "ui") : t("Disabled", "ui");
      input.addEventListener("change", () => {
        text.textContent = input.checked ? t("Enabled", "ui") : t("Disabled", "ui");
        onChange(input.checked);
      });
      toggle.append(input, text);
      control.append(label, toggle);
      mountTarget.appendChild(control);
    };
    if (tabId === "display") {
      addShellSelect("Mode", displayConfig.mode, [
        { value: "inspect", label: "Inspect" },
        { value: "aggregate", label: "Aggregate" },
        { value: "density", label: "Density" },
      ], (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
        draft.mode = nextValue;
      }));
      addShellSelect("Preset", displayConfig.preset, [
        { value: "review_first", label: "Review first" },
        { value: "balanced", label: "Balanced" },
        { value: "pattern_first", label: "Pattern first" },
        { value: "extreme_density", label: "Extreme density" },
      ], (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
        draft.preset = nextValue;
      }));
    } else if (tabId === "aggregation") {
      const algorithmOptions = family.id === "mineral_resources"
        ? [
          { value: "hex", label: "Hex grid" },
          { value: "square", label: "Square grid" },
          { value: "density_surface", label: "Density surface" },
        ]
        : family.id === "industrial_zones"
          ? [
            { value: "square", label: "Square grid" },
            { value: "density_surface", label: "Density surface" },
          ]
          : [
            { value: "cluster", label: "Cluster" },
            { value: "square", label: "Grid" },
            { value: "density_surface", label: "Density surface" },
          ];
      addShellSelect("Algorithm", displayConfig.aggregation.algorithm, algorithmOptions, (nextValue) => {
        updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
          draft.aggregation.algorithm = nextValue;
        });
      });
      addShellRange(
        "Cell size",
        Number(displayConfig.aggregation.thresholds?.cellSizePx || config?.aggregationCellSizePx || 44),
        24,
        96,
        2,
        "px",
        (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
          draft.aggregation.thresholds.cellSizePx = nextValue;
        })
      );
    } else if (tabId === "labels") {
      addShellSelect("Geographic level", mapTransportWorkbenchMaxLevelToLabelLevel(displayConfig.labels.maxLevel), [
        { value: "region", label: "Level 1 region" },
        { value: "anchor", label: "Level 2 anchor" },
        { value: "category", label: "Level 3 category" },
      ], (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
        draft.labels.maxLevel = mapTransportWorkbenchLabelLevelToMaxLevel(nextValue);
      }));
      addShellRange(
        "Label budget",
        Number(displayConfig.labels.budget || config?.labelBudget || 8),
        3,
        18,
        1,
        "",
        (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
          draft.labels.budget = nextValue;
        })
      );
      addShellToggle("Allow label aggregation", !!displayConfig.labels.allowAggregation, (nextValue) => {
        updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
          draft.labels.allowAggregation = nextValue;
        });
      });
    } else if (tabId === "coverage") {
      if (family.id === "port") {
        addShellSelect("Coverage tier", displayConfig.coverage || "core", [
          { value: "core", label: "Core" },
          { value: "expanded", label: "Expanded" },
          { value: "full_official", label: "Full official" },
        ], (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
          draft.coverage = nextValue;
        }));
      }
    }
    const note = document.createElement("p");
    note.className = "transport-workbench-shell-note";
    note.textContent = tabId === "data"
      ? t("Manifest and audit stay read-only here so control tuning and source truth do not get mixed.", "ui")
      : t("Use this panel to adjust the current family without changing the lens column context.", "ui");
    card.append(grid, note);
    return card;
  };

  const getTransportWorkbenchSectionsForTab = (familyId, tabId) => {
    const sectionMap = TRANSPORT_WORKBENCH_TAB_SECTION_MAP[familyId] || {};
    const allowedSectionKeys = new Set(sectionMap[tabId] || []);
    return (TRANSPORT_WORKBENCH_CONTROL_SCHEMAS[familyId] || []).filter((section) => allowedSectionKeys.has(section.key));
  };

  const renderTransportWorkbenchTabSections = (family, config, compareHeld, tabId, mountNode) => {
    if (!(mountNode instanceof HTMLElement)) return;
    const displayConfig = getTransportWorkbenchDisplayConfig(family.id);
    const appendShellRange = (labelText, value, min, max, step, unit, onChange, mountTarget) => {
      const control = document.createElement("div");
      control.className = "transport-workbench-shell-control";
      const label = document.createElement("div");
      label.className = "transport-workbench-shell-label";
      label.textContent = t(labelText, "ui");
      const row = document.createElement("div");
      row.className = "transport-workbench-range-row";
      const input = document.createElement("input");
      input.type = "range";
      input.className = "transport-workbench-range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const valueText = document.createElement("span");
      valueText.className = "transport-workbench-range-value";
      const formatValue = (nextValue) => `${nextValue}${unit || ""}`;
      valueText.textContent = formatValue(value);
      input.addEventListener("input", () => {
        const nextValue = Number(input.value);
        valueText.textContent = formatValue(nextValue);
        onChange(nextValue);
      });
      row.append(input, valueText);
      control.append(label, row);
      mountTarget.appendChild(control);
    };
    mountNode.replaceChildren();
    const shellCard = createTransportWorkbenchShellCard(family, tabId, config);
    if (shellCard) {
      mountNode.appendChild(shellCard);
    }
    const skipDefaultSections = TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)
      && (tabId === "aggregation" || tabId === "labels");
    if (!skipDefaultSections) {
      getTransportWorkbenchSectionsForTab(family.id, tabId).forEach((section) => {
        const node = createTransportWorkbenchSectionNode(family, section, config, compareHeld);
        if (node) {
          mountNode.appendChild(node);
        }
      });
    }
    if (tabId === "aggregation" || tabId === "labels") {
      const advanced = document.createElement("details");
      advanced.className = "transport-workbench-advanced";
      const summary = document.createElement("summary");
      summary.textContent = t("Advanced", "ui");
      advanced.appendChild(summary);
      const body = document.createElement("div");
      body.className = "transport-workbench-section-body transport-workbench-section-body-advanced";
      const copy = document.createElement("p");
      copy.className = "transport-workbench-section-description";
      copy.textContent = tabId === "aggregation"
        ? pickUiCopy(
          "这里放当前聚合精调项，例如 cluster radius、cell size 和密度触发阈值。默认折叠，便于先完成主设置，再做细调。",
          "This section contains active aggregation fine-tuning controls such as cluster radius, cell size, and density thresholds. It stays collapsed by default so the main setup remains easy to scan."
        )
        : pickUiCopy(
          "这里放当前标签精调项，例如 label separation 和聚合阈值。默认折叠，便于先完成主设置，再做细调。",
          "This section contains active label fine-tuning controls such as label separation and aggregation thresholds. It stays collapsed by default so the main setup remains easy to scan."
        );
      if (tabId === "aggregation") {
        appendShellRange(
          "Cluster radius",
          Number(displayConfig.aggregation.thresholds?.clusterRadiusPx || config?.aggregationClusterRadiusPx || 48),
          24,
          120,
          2,
          "px",
          (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
            draft.aggregation.thresholds.clusterRadiusPx = nextValue;
          }),
          body
        );
      } else {
        appendShellRange(
          "Label separation",
          Number(displayConfig.labels.separationStrength || config?.labelSeparation || 1),
          0.7,
          1.8,
          0.05,
          "",
          (nextValue) => updateTransportWorkbenchDisplayConfig(family.id, (draft) => {
            draft.labels.separationStrength = nextValue;
          }),
          body
        );
      }
      body.appendChild(copy);
      advanced.appendChild(body);
      mountNode.appendChild(advanced);
    }
    if (mountNode.childElementCount === 0) {
      const empty = document.createElement("div");
      empty.className = "transport-workbench-empty-card";
      const title = document.createElement("div");
      title.className = "transport-workbench-empty-title";
      title.textContent = tabId === "data" ? t("No audit payload yet", "ui") : t("No controls in this tab", "ui");
      const body = document.createElement("p");
      body.className = "transport-workbench-empty-text";
      body.textContent = tabId === "data"
        ? t("This family has not exposed extra manifest or audit cards in the current shell.", "ui")
        : family.id === "layers"
          ? pickUiCopy(
            "Layers 的主要操作在中间排序板完成。Inspect 用来确认当前顺序，其余页签保留统一结构。",
            "Layers is operated from the center reorder board. Inspect confirms the active order, and the remaining tabs keep the shared workbench structure."
          )
          : pickUiCopy(
            "这个 family 当前没有单独的页签控件。请在有内容的页签中调整真实规则，Inspect 会继续显示当前状态。",
            "This family does not expose separate controls in this tab yet. Use the populated tabs for active tuning, and use Inspect to confirm the current runtimeState."
          );
      empty.append(title, body);
      mountNode.appendChild(empty);
    }
  };

  const renderTransportWorkbenchInspectorTabs = (family, config, compareHeld) => {
    ensureTransportWorkbenchUiState();
    const activeTab = normalizeTransportWorkbenchInspectorTab(runtimeState.transportWorkbenchUi.activeInspectorTab);
    runtimeState.transportWorkbenchUi.activeInspectorTab = activeTab;
    transportWorkbenchInspectorTabButtons.forEach((button) => {
      const isActive = String(button.dataset.transportInspectorTab || "") === activeTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    Object.entries(transportWorkbenchInspectorPanels).forEach(([tabId, panel]) => {
      if (!(panel instanceof HTMLElement)) return;
      panel.classList.toggle("hidden", tabId !== activeTab);
      panel.classList.toggle("is-active", tabId === activeTab);
    });
    renderTransportWorkbenchTabSections(family, config, compareHeld, "display", transportWorkbenchDisplaySections);
    renderTransportWorkbenchTabSections(family, config, compareHeld, "aggregation", transportWorkbenchAggregationSections);
    renderTransportWorkbenchTabSections(family, config, compareHeld, "labels", transportWorkbenchLabelSections);
    renderTransportWorkbenchTabSections(family, config, compareHeld, "coverage", transportWorkbenchCoverageSections);
    renderTransportWorkbenchTabSections(family, config, compareHeld, "data", transportWorkbenchDataSections);
  };

  const renderTransportWorkbenchLensSections = (family, config, compareHeld) => {
    if (!transportWorkbenchLensSections) return;
    closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
    transportWorkbenchLensSections.replaceChildren();
    if (family.id === "layers") {
      const card = document.createElement("div");
      card.className = "transport-workbench-empty-card";
      const title = document.createElement("div");
      title.className = "transport-workbench-empty-title";
      title.textContent = t("Future draw stack", "ui");
      const body = document.createElement("p");
      body.className = "transport-workbench-empty-text";
      body.textContent = pickUiCopy(
        "使用中间排序板调整 8 个 transport families 的绘制顺序。左侧负责上下文，右侧负责状态查看。",
        "Use the center board to reorder the 8 transport families. The left column provides context, and the right column mirrors the current runtimeState."
      );
      card.append(title, body);
      transportWorkbenchLensSections.appendChild(card);
      return;
    }
    const previewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot(family.id, config);
    const dataContract = getTransportWorkbenchDataContract(family.id);
    const overview = document.createElement("div");
    overview.className = "transport-workbench-note-card transport-workbench-note-card-emphasis";
    const overviewTitle = document.createElement("div");
    overviewTitle.className = "transport-workbench-note-title";
    overviewTitle.textContent = t("Review focus", "ui");
    const overviewBody = document.createElement("p");
    overviewBody.className = "transport-workbench-note-text";
    overviewBody.textContent = `${family.lensBody} ${family.lensNext}`;
    overview.append(overviewTitle, overviewBody);
    transportWorkbenchLensSections.appendChild(overview);
    const summaryCard = document.createElement("div");
    summaryCard.className = "transport-workbench-note-card transport-workbench-note-card-soft transport-workbench-lens-summary";
    const summaryTitle = document.createElement("div");
    summaryTitle.className = "transport-workbench-note-title";
    summaryTitle.textContent = t("Current context", "ui");
    summaryCard.appendChild(summaryTitle);
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Preview", family.previewTitle || family.label));
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Data packs", Array.isArray(dataContract?.packs) && dataContract.packs.length ? dataContract.packs.join(", ") : "Deferred"));
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Geometry", dataContract?.geometryKind || "reserved"));
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Pack status", previewSnapshot?.status || "pending"));
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Right deck", t("Display / Aggregation / Labels / Coverage / Data", "ui")));
    summaryCard.appendChild(createTransportWorkbenchInspectorRow("Compare", compareHeld ? "Holding baseline" : "Working state"));
    transportWorkbenchLensSections.appendChild(summaryCard);
  };

  const renderTransportWorkbenchInspector = (family, config, compareHeld) => {
    if (transportWorkbenchInspectorDetails) {
      transportWorkbenchInspectorDetails.replaceChildren();
      const inspectorEmptyCard = transportWorkbenchInspectorEmptyTitle?.parentElement || null;
      const dataContract = getTransportWorkbenchDataContract(family.id);
      const previewSnapshot = getTransportWorkbenchFamilyPreviewSnapshot(family.id, config);
      const inspectorNodes = [];
      let rows;
      if (family.id === "road" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_road_v1"],
          ["Recipe version", previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["N06 member", previewSnapshot.manifest?.n06_source_member || previewSnapshot.audit?.n06_source_member || "unknown"],
          ["N06 encoding", previewSnapshot.manifest?.n06_encoding || previewSnapshot.audit?.n06_encoding || "unknown"],
          ["Last build", String(previewSnapshot.manifest?.generated_at || "unknown").replace("T", " ").replace("Z", " UTC")],
          ["Loaded roads", String(previewSnapshot.stats?.totalRoads || 0)],
          ["Visible labels", String(previewSnapshot.stats?.visibleLabels || 0)],
          ["Filtered roads", String(previewSnapshot.stats?.filteredRoads || 0)],
          ["N06 matched", String(previewSnapshot.audit?.n06_matched_count || 0)],
          ["Name conflicts", String(previewSnapshot.audit?.name_conflict_count || 0)],
          ["Compare mode", compareHeld ? "Holding baseline" : "Working state"],
        ];
        if (selected?.type === "road") {
          rows.push(
            ["Selected road", selected.name || "Unnamed segment"],
            ["Ref", selected.ref || "--"],
            ["Official name", selected.officialName || "--"],
            ["Official ref", selected.officialRef || "--"],
            ["Road class", selected.roadClass || "--"],
            ["Source", selected.source || "--"],
            ["Flags", Array.isArray(selected.sourceFlags) && selected.sourceFlags.length ? selected.sourceFlags.join(", ") : "--"],
            ["Visibility", selected.visible ? "Visible" : formatTransportWorkbenchRoadHiddenReason(selected.hiddenReason)],
          );
          if (selected.n06MatchDistanceMeters !== null && selected.n06MatchDistanceMeters !== undefined) {
            rows.push(["N06 match distance", `${Math.round(selected.n06MatchDistanceMeters)}m`]);
          }
        } else if (selected?.type === "label") {
          rows.push(
            ["Selected label", selected.ref || "--"],
            ["Road class", selected.roadClass || "--"],
            ["Source", selected.source || "--"],
            ["Priority", String(selected.priority ?? "--")],
            ["Visibility", selected.visible ? "Visible" : formatTransportWorkbenchRoadHiddenReason(selected.hiddenReason)],
          );
        }
      } else if (family.id === "road" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Road pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "road") {
        rows = [
          ["Pack status", "Loading Japan road pack"],
          ["Adapter", config.motorwayIdentitySource === "osm_only" ? "OSM only" : "OSM + N06 hardening"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "rail" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_rail_v1"],
          ["Recipe version", previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Last build", String(previewSnapshot.manifest?.generated_at || "unknown").replace("T", " ").replace("Z", " UTC")],
          ["Loaded lines", String(previewSnapshot.stats?.totalLines || 0)],
          ["Visible lines", String(previewSnapshot.stats?.visibleLines || 0)],
          ["Loaded stations", String(previewSnapshot.stats?.totalStations || 0)],
          ["Visible stations", String(previewSnapshot.stats?.visibleStations || 0)],
          ["Adapter", config.allowOsmActiveGapFill ? "Official active + OSM gap fill" : "Official active locked"],
          ["Statuses", formatTransportWorkbenchOptionLabels(config.status, RAIL_STATUS_OPTIONS)],
          ["Classes", formatTransportWorkbenchOptionLabels(config.class, RAIL_CLASS_OPTIONS)],
        ];
        if (selected?.type === "line") {
          rows.push(
            ["Selected line", selected.name || "Unnamed line"],
            ["Operator", selected.operator || "--"],
            ["Rail type code", selected.railTypeCode || "--"],
            ["Operator type code", selected.operatorTypeCode || "--"],
            ["Status", selected.status || "--"],
            ["Class", selected.lineClass || "--"],
            ["Source", selected.source || "--"],
            ["Flags", Array.isArray(selected.sourceFlags) && selected.sourceFlags.length ? selected.sourceFlags.join(", ") : "--"],
            ["Visibility", selected.visible ? "Visible" : formatJapanRailVisibilityReason(selected.hiddenReason)],
          );
        } else if (selected?.type === "station") {
          rows.push(
            ["Selected station", selected.name || "Unnamed station"],
            ["City key", selected.cityKey || "--"],
            ["Station code", selected.stationCode || "--"],
            ["Group code", selected.groupCode || "--"],
            ["Importance", selected.importance || "--"],
            ["Source", selected.source || "--"],
            ["Visibility", selected.visible ? "Visible" : "Hidden by threshold"],
          );
        }
      } else if (family.id === "rail" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Rail pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "rail") {
        rows = [
          ["Adapter", config.allowOsmActiveGapFill ? "Official active + OSM gap fill" : "Official active locked"],
          ["Statuses", formatTransportWorkbenchOptionLabels(config.status, RAIL_STATUS_OPTIONS)],
          ["Classes", formatTransportWorkbenchOptionLabels(config.class, RAIL_CLASS_OPTIONS)],
          ["Stations", config.showMajorStations ? `${config.importanceThreshold} threshold` : "Hidden"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
          ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for railways + rail_stations_major Japan packs") : "Loading Japan rail pack"],
        ];
      } else if (family.id === "airport" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_airport_v1"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
          ["Loaded airports", String(previewSnapshot.stats?.totalFeatures || 0)],
          ["Visible airports", String(previewSnapshot.stats?.visibleFeatures || 0)],
          ["Visible labels", String(previewSnapshot.stats?.visibleLabels || 0)],
          ["Airport types", formatTransportWorkbenchOptionLabels(config.airportTypes, AIRPORT_TYPE_OPTIONS)],
          ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, AIRPORT_STATUS_OPTIONS)],
          ["Pack mode", previewSnapshot.packMode || "preview"],
        ];
        if (selected) {
          rows.push(
            ["Selected airport", selected.name || "Unnamed airport"],
            ["Airport type", selectedProps.airport_type_label || selectedProps.airport_type || "—"],
            ["Status", selectedProps.status || "—"],
            ["Owner", selectedProps.owner || "—"],
            ["Manager", selectedProps.manager || "—"],
            ["Scheduled service", selectedProps.scheduled_service_code || "—"],
            ["Runway max", selectedProps.runway_length_m_max ? `${selectedProps.runway_length_m_max}m` : "—"],
            ["Passengers / day", selectedProps.passengers_per_day_latest ?? "—"],
            ["Survey year", selectedProps.survey_year_latest ?? "—"],
            ["IATA", selectedProps.iata || "—"],
            ["ICAO", selectedProps.icao || "—"],
          );
        }
      } else if (family.id === "airport" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Airport pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "airport") {
        rows = [
          ["Airport types", formatTransportWorkbenchOptionLabels(config.airportTypes, AIRPORT_TYPE_OPTIONS)],
          ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, AIRPORT_STATUS_OPTIONS)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
          ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for airport Japan pack") : "Loading Japan airport pack"],
        ];
      } else if (family.id === "port" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_port_v1"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Release policy", previewSnapshot.manifest?.release_policy || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
          ["Loaded ports", String(previewSnapshot.stats?.totalFeatures || 0)],
          ["Visible ports", String(previewSnapshot.stats?.visibleFeatures || 0)],
          ["Visible labels", String(previewSnapshot.stats?.visibleLabels || 0)],
          ["Coverage tier", previewSnapshot.activeVariant || config.coverageTier || getTransportWorkbenchManifestDefaultVariantId(previewSnapshot.manifest, "port")],
          ["Legal designations", formatTransportWorkbenchOptionLabels(config.legalDesignations, PORT_DESIGNATION_OPTIONS)],
          ["Manager types", formatTransportWorkbenchOptionLabels(config.managerTypes, PORT_MANAGER_TYPE_OPTIONS)],
          ["Pack mode", previewSnapshot.packMode || "preview"],
        ];
        if (selected) {
          rows.push(
            ["Selected port", selected.name || "Unnamed port"],
            ["Designation", selectedProps.legal_designation_label || selectedProps.legal_designation || "—"],
            ["Manager", selectedProps.manager || "—"],
            ["Manager type", selectedProps.manager_type || selectedProps.manager_type_code || "—"],
            ["Outer facility", selectedProps.outer_facility_length_m ? `${selectedProps.outer_facility_length_m}m` : "—"],
            ["Mooring facility", selectedProps.mooring_facility_length_m ? `${selectedProps.mooring_facility_length_m}m` : "—"],
            ["Ferry service", selectedProps.ferry_service === true ? "Yes" : selectedProps.ferry_service === false ? "No" : "—"],
            ["Agencies", selectedProps.agency_labels || "—"],
          );
        }
      } else if (family.id === "port" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Port pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "port") {
        rows = [
          ["Coverage tier", config.coverageTier || "core"],
          ["Legal designations", formatTransportWorkbenchOptionLabels(config.legalDesignations, PORT_DESIGNATION_OPTIONS)],
          ["Manager types", formatTransportWorkbenchOptionLabels(config.managerTypes, PORT_MANAGER_TYPE_OPTIONS)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
          ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for port Japan pack") : "Loading Japan port pack"],
        ];
      } else if (family.id === "mineral_resources" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_mineral_resources_v1"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Source encoding", previewSnapshot.manifest?.source_encoding || previewSnapshot.audit?.source_encoding || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
          ["Loaded sites", String(previewSnapshot.stats?.totalFeatures || 0)],
          ["Visible sites", String(previewSnapshot.stats?.visibleFeatures || 0)],
          ["Visible labels", String(previewSnapshot.stats?.visibleLabels || 0)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Pack mode", previewSnapshot.packMode || "preview"],
        ];
        if (selected) {
          rows.push(
            ["Selected site", selected.name || "Unnamed mineral site"],
            ["Resource type", selectedProps.resource_type || "--"],
            ["Resource code", selectedProps.resource_type_code || "--"],
            ["Resource class", selectedProps.resource_class || "--"],
            ["Work status", selectedProps.work_status || "--"],
            ["Map name", selectedProps.map_name || "--"],
            ["Map year", selectedProps.map_pub_year || "--"],
            ["Publisher", selectedProps.map_publisher || "--"],
            ["Source", selectedProps.source || "--"],
          );
        }
      } else if (family.id === "mineral_resources" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Mineral resource pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "mineral_resources") {
        rows = [
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
          ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for mineral_resources Japan pack manifest") : "Loading Japan mineral resource pack"],
        ];
      } else if (family.id === "energy_facilities" && previewSnapshot?.status === "ready") {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        const subtypeOptions = buildEnergyFacilitySubtypeControlOptions(previewSnapshot);
        const selectedSubtypeValues = Array.isArray(config.facilitySubtypes) && config.facilitySubtypes.length > 0
          ? config.facilitySubtypes
          : subtypeOptions.map((option) => option.value);
        const referenceOnlySubtypes = (Array.isArray(previewSnapshot.subtypeCatalog) ? previewSnapshot.subtypeCatalog : [])
          .filter((entry) => entry?.availability === "reference_only")
          .map((entry) => String(entry.subtype_id || "").trim())
          .filter(Boolean);
        rows = [
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_energy_facilities_v1"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Distribution tier", previewSnapshot.manifest?.distribution_tier || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
          ["Loaded facilities", String(previewSnapshot.stats?.totalFeatures || 0)],
          ["Visible facilities", String(previewSnapshot.stats?.visibleFeatures || 0)],
          ["Visible labels", String(previewSnapshot.stats?.visibleLabels || 0)],
          ["Local subtypes", formatTransportWorkbenchOptionLabels(selectedSubtypeValues, subtypeOptions)],
          ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, ENERGY_STATUS_OPTIONS)],
          ["Reference-only subtypes", referenceOnlySubtypes.length ? referenceOnlySubtypes.join(", ") : "none"],
          ["Pack mode", previewSnapshot.packMode || "preview"],
        ];
        if (selected) {
          rows.push(
            ["Selected facility", selected.name || "Unnamed energy facility"],
            ["Subtype", selectedProps.facility_label || selectedProps.facility_subtype || "--"],
            ["Operator", selectedProps.operator || "--"],
            ["Status", selectedProps.status || "--"],
            ["Start date", selectedProps.start_date || "--"],
            ["Address", selectedProps.address || "--"],
            ["Source", selectedProps.source || "--"],
          );
        }
      } else if (family.id === "energy_facilities" && previewSnapshot?.status === "error") {
        rows = [
          ["Pack status", "Energy facility pack failed to load"],
          ["Error", previewSnapshot.error || "Unknown error"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (family.id === "energy_facilities") {
        rows = [
          ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, ENERGY_STATUS_OPTIONS)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data path", dataContract?.governance || "Deferred pack governance pending"],
          ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for energy_facilities Japan pack manifest") : "Loading Japan energy facility pack"],
        ];
      } else if (
        family.id === "industrial_zones"
        && previewSnapshot?.status === "ready"
      ) {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        const activeVariant = previewSnapshot.activeVariant
          || config.variant
          || getTransportWorkbenchManifestDefaultVariantId(previewSnapshot.manifest, "industrial_zones");
        const variantMeta = getTransportWorkbenchManifestVariantMeta(previewSnapshot.manifest, activeVariant, "industrial_zones");
        const totalFeatures = Number(previewSnapshot.stats?.totalFeatures || 0);
        const visibleFeatures = Number(previewSnapshot.stats?.visibleFeatures || 0);
        const filteredFeatures = Number(previewSnapshot.stats?.filteredFeatures || 0);
        const visibleLabels = Number(previewSnapshot.stats?.visibleLabels || 0);
        if (totalFeatures > 0 && visibleFeatures === 0) {
          inspectorNodes.push(
            createTransportWorkbenchInspectorStateCard(
              "No features match the current filters",
              "Switch the source track or relax the active land filters to bring industrial land back into view.",
              "soft",
            ),
          );
        }
        rows = [
          ["Source track", activeVariant],
          ["Visible polygons", String(visibleFeatures)],
          ["Filtered out", String(filteredFeatures)],
          ["Visible labels", String(visibleLabels)],
        ];
        if (selected) {
          rows.push(
            ["Selected polygon", selected.name || "Unnamed industrial polygon"],
            ["Land type", selectedProps.site_class || "--"],
          );
          if (activeVariant === "internal") {
            rows.push(
              ["Municipality", selectedProps.municipality_name || "--"],
              ["Location context", selectedProps.coastal_inland_label || "--"],
              ["Operator", selectedProps.operator || "--"],
              ["Completion year", selectedProps.completion_year ?? "--"],
              ["Industry category", selectedProps.industry_category || "--"],
            );
          } else {
            rows.push(
              ["OSM id", selectedProps.osm_id || "--"],
              ["Landuse", selectedProps.landuse || "--"],
              ["Man made", selectedProps.man_made || "--"],
            );
          }
        }
        rows.push(
          ["Loaded polygons", String(totalFeatures)],
          ["Pack mode", previewSnapshot.packMode || "preview"],
          ["Variant tier", variantMeta?.distribution_tier || "unknown"],
          ["License tier", variantMeta?.license_tier || "unknown"],
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_industrial_zones_v2"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
        );
        if (selected) {
          rows.push(
            ["Source dataset", selectedProps.source_dataset || "--"],
            ["Source member", selectedProps.source_member || "--"],
          );
        }
      } else if (family.id === "industrial_zones" && previewSnapshot?.status === "error") {
        inspectorNodes.push(
          createTransportWorkbenchInspectorStateCard(
            "Industrial land preview failed",
            previewSnapshot.error || "The industrial polygon pack could not be loaded.",
            "emphasis",
          ),
        );
        rows = [["Data path", dataContract?.governance || "Deferred pack governance pending"]];
      } else if (family.id === "industrial_zones") {
        inspectorNodes.push(
          createTransportWorkbenchInspectorStateCard(
            "Preparing industrial land preview",
            "The current source track is still loading into the Japan carrier.",
            "soft",
          ),
        );
        rows = [
          ["Source track", config.variant || (previewSnapshot?.manifest ? getTransportWorkbenchManifestDefaultVariantId(previewSnapshot.manifest, "industrial_zones") : "internal")],
          ["Land type", formatTransportWorkbenchOptionLabels(config.siteClasses, INDUSTRIAL_SITE_CLASS_OPTIONS)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data check", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (
        family.id === "logistics_hubs"
        && previewSnapshot?.status === "ready"
      ) {
        const selected = previewSnapshot.selected;
        const selectedProps = selected?.properties || {};
        const totalFeatures = Number(previewSnapshot.stats?.totalFeatures || 0);
        const visibleFeatures = Number(previewSnapshot.stats?.visibleFeatures || 0);
        const filteredFeatures = Number(previewSnapshot.stats?.filteredFeatures || 0);
        if (totalFeatures > 0 && visibleFeatures === 0) {
          inspectorNodes.push(
            createTransportWorkbenchInspectorStateCard(
              "No features match the current filters",
              "Relax the active hub category or operator type filters to bring logistics hubs back into view.",
              "soft",
            ),
          );
        }
        rows = [
          ["Hub category", formatTransportWorkbenchOptionLabels(config.hubTypes, LOGISTICS_HUB_TYPE_OPTIONS)],
          ["Visible hubs", String(visibleFeatures)],
          ["Filtered out", String(filteredFeatures)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
        ];
        if (selected) {
          rows.push(
            ["Selected hub", selected.name || "Unnamed logistics hub"],
            ["Hub category", selectedProps.hub_type || "--"],
            ["Classification", selectedProps.classification_label || "--"],
            ["Operator type", selectedProps.operator_classification || "--"],
            ["Address", selectedProps.address || "--"],
            ["Maintenance year", selectedProps.maintenance_year ?? "--"],
            ["Size value", selectedProps.size_value ?? "--"],
            ["Remarks", selectedProps.remarks || "--"],
          );
        }
        rows.push(
          ["Loaded hubs", String(totalFeatures)],
          ["Pack mode", previewSnapshot.packMode || "preview"],
          ["Distribution tier", previewSnapshot.manifest?.distribution_tier || "unknown"],
          ["Source policy", previewSnapshot.manifest?.source_policy || "unknown"],
          ["Pack version", previewSnapshot.manifest?.adapter_id || "japan_logistics_hubs_v1"],
          ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
          ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
        );
        if (selected) {
          rows.push(["Source member", selectedProps.source_member || "--"]);
        }
      } else if (family.id === "logistics_hubs" && previewSnapshot?.status === "error") {
        inspectorNodes.push(
          createTransportWorkbenchInspectorStateCard(
            "Logistics hub preview failed",
            previewSnapshot.error || "The logistics hub pack could not be loaded.",
            "emphasis",
          ),
        );
        rows = [["Data path", dataContract?.governance || "Deferred pack governance pending"]];
      } else if (family.id === "logistics_hubs") {
        inspectorNodes.push(
          createTransportWorkbenchInspectorStateCard(
            "Preparing logistics hub preview",
            "The current hub scope is still loading into the Japan carrier.",
            "soft",
          ),
        );
        rows = [
          ["Hub category", formatTransportWorkbenchOptionLabels(config.hubTypes, LOGISTICS_HUB_TYPE_OPTIONS)],
          ["Operator type", formatTransportWorkbenchOptionLabels(config.operatorClassifications, LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS)],
          ["Labels", config.showLabels ? "Enabled" : "Hidden"],
          ["Data check", dataContract?.governance || "Deferred pack governance pending"],
        ];
      } else if (isTransportWorkbenchManifestOnlyRuntimeFamily(family.id)) {
        rows = buildManifestOnlyInspectorRows(family, previewSnapshot, dataContract);
      } else if (family.id === "layers") {
        rows = runtimeState.transportWorkbenchUi.layerOrder.map((layerId, index) => {
          const entry = getTransportWorkbenchLayerFamilyMeta(layerId);
          if (isTransportWorkbenchLivePreviewFamily(layerId)) {
            return [`${index + 1}`, `${entry.label} (live)`];
          }
          if (isTransportWorkbenchManifestOnlyRuntimeFamily(layerId)) {
            return [`${index + 1}`, `${entry.label} (metadata)`];
          }
          return [`${index + 1}`, `${entry.label} (reserved)`];
        });
      } else {
        rows = [
          ["Adapter", "Reserved shell only"],
          ["Compare mode", "No baseline yet"],
          ["Pack status", `Waiting for ${family.label} Japan adapter`],
        ];
      }
      inspectorNodes.forEach((node) => {
        transportWorkbenchInspectorDetails.appendChild(node);
      });
      rows.forEach((entry, index) => {
        if (Array.isArray(entry)) {
          const row = createTransportWorkbenchInspectorRow(entry[0], entry[1]);
          if (family.id === "industrial_zones" || family.id === "logistics_hubs") {
            if (index < 4) row.classList.add("is-summary");
            if (String(entry[0] || "").startsWith("Selected ")) row.classList.add("is-selected");
            if (["Pack version", "Recipe version", "Last build", "License tier", "Variant tier", "Distribution tier", "Source policy", "Source member", "Source dataset", "Data path", "Data check", "Pack mode"].includes(String(entry[0] || ""))) {
              row.classList.add("is-governance");
            }
          }
          transportWorkbenchInspectorDetails.appendChild(row);
          return;
        }
        transportWorkbenchInspectorDetails.appendChild(entry);
      });
      if (inspectorEmptyCard) {
        inspectorEmptyCard.classList.toggle("hidden", transportWorkbenchInspectorDetails.childElementCount > 0);
      }
    }
    renderTransportWorkbenchInspectorTabs(family, config, compareHeld);
  };

  const syncTransportWorkbenchPreviewControls = () => {
    const carrierViewState = getTransportWorkbenchCarrierViewState();
    const isAlternateTurn = carrierViewState.quarterTurns !== 0;
    if (transportWorkbenchZoomOutBtn) transportWorkbenchZoomOutBtn.textContent = "-";
    if (transportWorkbenchZoomInBtn) transportWorkbenchZoomInBtn.textContent = "+";
    if (transportWorkbenchRotateBtn) transportWorkbenchRotateBtn.textContent = "90°";
    transportWorkbenchRotateBtn?.classList.toggle("is-active", isAlternateTurn);
    transportWorkbenchRotateBtn?.setAttribute("aria-pressed", isAlternateTurn ? "true" : "false");
  };

  const scheduleTransportWorkbenchFamilyPreviewWarmup = () => {
    if (transportWorkbenchPreviewWarmupScheduled) return;
    transportWorkbenchPreviewWarmupScheduled = true;
    const runWarmup = () => {
      const warmupPlans = listTransportWorkbenchWarmupPlans();
      Promise.allSettled(
        warmupPlans.map((plan) => warmTransportWorkbenchFamilyPreview(plan.familyId, { includeFull: !!plan.includeFull }))
      ).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "fulfilled") return;
          const familyId = warmupPlans[index]?.familyId || "unknown";
          console.warn(`[transport-workbench] Failed to warm ${familyId} preview pack.`, result.reason);
        });
      });
    };
    window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => runWarmup(), { timeout: 2_000 });
        return;
      }
      runWarmup();
    }, 10_000);
  };

  const getTransportWorkbenchRenderContext = () => {
    ensureTransportWorkbenchUiState();
    const uiState = runtimeState.transportWorkbenchUi;
    const family = getTransportWorkbenchFamilyMeta();
    const isOpen = !!uiState.open;
    const compareHeld = !!uiState.compareHeld && !!family.supportsDetailedControls;
    const familyConfig = getTransportWorkbenchWorkingConfig(family.id, { baseline: compareHeld });
    const displayConfig = getTransportWorkbenchDisplayConfig(family.id, { baseline: compareHeld });
    const config = buildTransportWorkbenchResolvedConfig(family.id, familyConfig, displayConfig);
    return {
      uiState,
      family,
      isOpen,
      compareHeld,
      displayConfig,
      config,
    };
  };

  const refreshTransportWorkbenchPreview = (context, { allowCarrierPrep = true } = {}) => {
    if (!context.isOpen) {
      clearAllTransportWorkbenchFamilyPreviews();
      return Promise.resolve(null);
    }
    if (context.family.id === "layers") {
      clearAllTransportWorkbenchFamilyPreviews();
      renderTransportWorkbenchLayerOrderPanel();
      return Promise.resolve(null);
    }
    if (!transportWorkbenchCarrierMount) {
      return Promise.resolve(null);
    }
    const prepareCarrier = allowCarrierPrep
      ? ensureTransportWorkbenchCarrier(transportWorkbenchCarrierMount)
      : Promise.resolve();
    return prepareCarrier
      .then(() => {
        resizeTransportWorkbenchCarrier();
        syncTransportWorkbenchPreviewControls();
        if (isTransportWorkbenchFamilyLivePreviewCapable(context.family.id)) {
          return renderTransportWorkbenchFamilyPreview(context.family.id, context.config).then(() => {
            const viewState = getTransportWorkbenchCarrierViewState() || {};
            transportWorkbenchPreviewLastViewKey = [
              Number(viewState.scale || 1).toFixed(4),
              Number(viewState.translateX || 0).toFixed(2),
              Number(viewState.translateY || 0).toFixed(2),
              String(viewState.quarterTurns || 0),
            ].join(":");
            renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
            return null;
          });
        }
        clearAllTransportWorkbenchFamilyPreviews();
        renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
        return null;
      })
      .catch((error) => {
        console.error("[transport-workbench] Failed to prepare Japan carrier preview.", error);
        if (!isTransportWorkbenchFamilyLivePreviewCapable(context.family.id)) {
          clearAllTransportWorkbenchFamilyPreviews();
        }
        renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
        return null;
      });
  };

  const renderTransportWorkbenchShell = (context) => {
    const { uiState, family, isOpen, compareHeld } = context;
    document.body.classList.toggle("transport-workbench-open", isOpen);
    transportWorkbenchOverlay?.classList.toggle("hidden", !isOpen);
    transportWorkbenchOverlay?.setAttribute("aria-hidden", isOpen ? "false" : "true");
    scenarioTransportWorkbenchBtn?.setAttribute("aria-expanded", isOpen ? "true" : "false");
    scenarioTransportWorkbenchBtn?.setAttribute("title", isOpen ? t("Close transport workbench", "ui") : t("Open transport workbench", "ui"));
    transportWorkbenchTitle.textContent = t(family.title, "ui");
    transportWorkbenchLensTitle.textContent = t(family.lensTitle, "ui");
    transportWorkbenchFamilyStatus.textContent = t(family.label, "ui");
    transportWorkbenchCountryStatus.textContent = uiState.sampleCountry;
    transportWorkbenchPreviewMode.textContent = family.id === "layers"
      ? t("Layer order", "ui")
      : TRANSPORT_WORKBENCH_DENSITY_FAMILY_IDS.has(family.id)
        ? `${String(context.config?.displayMode || "inspect").replace(/_/g, " ")} · ${String(context.config?.displayPreset || "balanced").replace(/_/g, " ")}`
        : uiState.previewMode === "bounded_zoom_pan"
          ? t("Zoom / pan / quarter-turn", "ui")
          : uiState.previewMode;
    transportWorkbenchPreviewTitle.textContent = family.id === "layers"
      ? t(family.previewTitle, "ui")
      : t("Japan preview", "ui");
    if (transportWorkbenchCompareBtn) {
      transportWorkbenchCompareBtn.disabled = !family.supportsDetailedControls;
      transportWorkbenchCompareBtn.setAttribute("aria-disabled", family.supportsDetailedControls ? "false" : "true");
      transportWorkbenchCompareBtn.classList.toggle("is-held", compareHeld);
      transportWorkbenchCompareBtn.textContent = family.supportsDetailedControls
        ? t("Compare baseline", "ui")
        : t("Baseline unavailable", "ui");
    }
    if (transportWorkbenchCompareStatus) {
      transportWorkbenchCompareStatus.textContent = !family.supportsDetailedControls
        ? t("Baseline unavailable for this family", "ui")
        : compareHeld
          ? t("Baseline preview", "ui")
          : t("Live working state", "ui");
    }
    if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden")) {
      renderTransportWorkbenchInfoContent(family);
    }
    transportWorkbenchInspectorTitle.textContent = `${t(family.label, "ui")} ${t("inspector", "ui")}`;
    transportWorkbenchInspectorEmptyTitle.textContent = t(family.inspectorEmptyTitle, "ui");
    transportWorkbenchInspectorEmptyBody.textContent = t(family.inspectorEmptyBody, "ui");
    transportWorkbenchPreviewCanvas?.classList.toggle("is-layer-order-mode", family.id === "layers");
    transportWorkbenchPreviewActions?.classList.toggle("hidden", family.id === "layers");
    transportWorkbenchPreviewControls?.classList.toggle("hidden", family.id === "layers");
    transportWorkbenchCarrierMount?.classList.toggle("hidden", family.id === "layers");
    transportWorkbenchLayerOrderPanel?.classList.toggle("hidden", family.id !== "layers");
    setTransportWorkbenchCarrierFamily(family.id);
    syncTransportWorkbenchPreviewControls();
    transportWorkbenchFamilyTabs.forEach((button) => {
      const isActive = String(button.dataset.transportFamily || "") === family.id;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    renderTransportWorkbenchInspectorTabs(family, context.config || uiState.familyConfigs?.[family.id] || {}, compareHeld);
    if (transportWorkbenchApplyBtn) {
      transportWorkbenchApplyBtn.disabled = true;
      transportWorkbenchApplyBtn.setAttribute("aria-disabled", "true");
    }
  };

  const scheduleTransportWorkbenchPreviewViewSync = () => {
    ensureTransportWorkbenchUiState();
    const activeFamily = normalizeTransportWorkbenchFamily(runtimeState.transportWorkbenchUi.activeFamily);
    if (!runtimeState.transportWorkbenchUi?.open || !isTransportWorkbenchFamilyLivePreviewCapable(activeFamily)) {
      return;
    }
    const viewState = getTransportWorkbenchCarrierViewState() || {};
    const nextViewKey = [
      Number(viewState.scale || 1).toFixed(4),
      Number(viewState.translateX || 0).toFixed(2),
      Number(viewState.translateY || 0).toFixed(2),
      String(viewState.quarterTurns || 0),
    ].join(":");
    if (transportWorkbenchPreviewLastViewKey === nextViewKey) {
      return;
    }
    transportWorkbenchPreviewLastViewKey = nextViewKey;
    if (transportWorkbenchPreviewViewSyncRaf) {
      cancelAnimationFrame(transportWorkbenchPreviewViewSyncRaf);
    }
    transportWorkbenchPreviewViewSyncRaf = requestAnimationFrame(() => {
      transportWorkbenchPreviewViewSyncRaf = 0;
      const context = getTransportWorkbenchRenderContext();
      if (!context.isOpen || context.family.id !== activeFamily) return;
      refreshTransportWorkbenchPreview(context, { allowCarrierPrep: false });
    });
  };

  const renderTransportWorkbenchUi = () => {
    if (
      !transportWorkbenchOverlay
      || !transportWorkbenchPanel
      || !transportWorkbenchTitle
      || !transportWorkbenchLensTitle
      || !transportWorkbenchPreviewTitle
      || !transportWorkbenchInspectorTitle
    ) {
      return;
    }
    const context = getTransportWorkbenchRenderContext();
    renderTransportWorkbenchShell(context);
    renderTransportWorkbenchLensSections(context.family, context.config, context.compareHeld);
    renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
    refreshTransportWorkbenchPreview(context);
  };

  const setTransportWorkbenchState = (nextOpen, { trigger = null, restoreFocus = true } = {}) => {
    if (!transportWorkbenchOverlay || !transportWorkbenchPanel) {
      return;
    }
    ensureTransportWorkbenchUiState();
    const uiState = runtimeState.transportWorkbenchUi;
    const wasOpen = !!uiState.open;
    const willOpen = !!nextOpen;
    if (willOpen === wasOpen && !willOpen) {
      renderTransportWorkbenchUi();
      if (typeof runtimeState.syncFacilityInfoCardVisibilityFn === "function") {
        runtimeState.syncFacilityInfoCardVisibilityFn();
      }
      return;
    }
    if (willOpen) {
      uiState.restoreLeftDrawer = document.body.classList.contains("left-drawer-open");
      uiState.restoreRightDrawer = document.body.classList.contains("right-drawer-open");
      uiState.compareHeld = false;
      resetTransportWorkbenchSectionState();
      runtimeState.toggleLeftPanelFn?.(false);
      runtimeState.toggleRightPanelFn?.(false);
      runtimeState.closeDockPopoverFn?.({ restoreFocus: false });
      runtimeState.closeExportWorkbenchFn?.({ restoreFocus: false });
      closeTransportWorkbenchInfoPopover({ restoreFocus: false });
      closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
      if (trigger instanceof HTMLElement && transportWorkbenchOverlay instanceof HTMLElement) {
        rememberOverlayTrigger(transportWorkbenchOverlay, trigger);
      }
    }
    uiState.open = willOpen;
    renderTransportWorkbenchUi();
    if (typeof runtimeState.syncFacilityInfoCardVisibilityFn === "function") {
      runtimeState.syncFacilityInfoCardVisibilityFn();
    }
    if (willOpen) {
      focusOverlaySurface(transportWorkbenchPanel);
      return;
    }
    uiState.compareHeld = false;
    if (transportWorkbenchPreviewViewSyncRaf) {
      cancelAnimationFrame(transportWorkbenchPreviewViewSyncRaf);
      transportWorkbenchPreviewViewSyncRaf = 0;
    }
    transportWorkbenchPreviewLastViewKey = "";
    destroyAllTransportWorkbenchFamilyPreviews();
    destroyTransportWorkbenchCarrier();
    closeTransportWorkbenchInfoPopover({ restoreFocus: false });
    closeTransportWorkbenchSectionHelpPopover({ restoreFocus: false });
    runtimeState.toggleLeftPanelFn?.(uiState.restoreLeftDrawer);
    runtimeState.toggleRightPanelFn?.(!uiState.restoreLeftDrawer && uiState.restoreRightDrawer);
    uiState.restoreLeftDrawer = false;
    uiState.restoreRightDrawer = false;
    if (restoreFocus) {
      restoreOverlayTriggerFocus(transportWorkbenchOverlay);
    }
  };

  const resetTransportWorkbenchView = () => {
    ensureTransportWorkbenchUiState();
    resetTransportWorkbenchCarrierView();
    syncTransportWorkbenchPreviewControls();
  };

  const openTransportWorkbench = (trigger = null) => {
    setTransportWorkbenchState(true, { trigger });
    return true;
  };

  const closeTransportWorkbench = ({ restoreFocus = true } = {}) => {
    setTransportWorkbenchState(false, { restoreFocus });
    return false;
  };

  const initializeTransportWorkbenchRuntime = () => {
    scheduleTransportWorkbenchFamilyPreviewWarmup();
    setTransportWorkbenchCarrierViewChangeListener(() => {
      scheduleTransportWorkbenchPreviewViewSync();
    });
    ["road", "rail", "airport", "port", "mineral_resources", "energy_facilities", "industrial_zones", "logistics_hubs"].forEach((familyId) => {
      setTransportWorkbenchFamilyPreviewSelectionListener(familyId, () => {
        const context = getTransportWorkbenchRenderContext();
        if (!context.isOpen || context.family.id !== familyId) {
          return;
        }
        renderTransportWorkbenchLensSections(context.family, context.config, context.compareHeld);
        renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
      });
    });
  };

  const bindTransportWorkbenchEvents = () => {
      if (scenarioTransportWorkbenchBtn && !scenarioTransportWorkbenchBtn.dataset.bound) {
        scenarioTransportWorkbenchBtn.addEventListener("click", () => {
          if (runtimeState.transportWorkbenchUi?.open) {
            setTransportWorkbenchState(false);
            return;
          }
          setTransportWorkbenchState(true, { trigger: scenarioTransportWorkbenchBtn });
        });
        scenarioTransportWorkbenchBtn.dataset.bound = "true";
      }

      if (transportAppearanceWorkbenchBtn && !transportAppearanceWorkbenchBtn.dataset.bound) {
        transportAppearanceWorkbenchBtn.addEventListener("click", () => {
          setTransportWorkbenchState(true, { trigger: transportAppearanceWorkbenchBtn });
        });
        transportAppearanceWorkbenchBtn.dataset.bound = "true";
      }

      if (transportWorkbenchInfoBtn && !transportWorkbenchInfoBtn.dataset.bound) {
        transportWorkbenchInfoBtn.addEventListener("click", () => {
          toggleTransportWorkbenchInfoPopover();
        });
        transportWorkbenchInfoBtn.dataset.bound = "true";
      }

      if (transportWorkbenchCloseBtn && !transportWorkbenchCloseBtn.dataset.bound) {
        transportWorkbenchCloseBtn.addEventListener("click", () => {
          setTransportWorkbenchState(false);
        });
        transportWorkbenchCloseBtn.dataset.bound = "true";
      }

      if (transportWorkbenchResetBtn && !transportWorkbenchResetBtn.dataset.bound) {
        transportWorkbenchResetBtn.addEventListener("click", () => {
          resetTransportWorkbenchView();
        });
        transportWorkbenchResetBtn.dataset.bound = "true";
      }

      if (transportWorkbenchCompareBtn && !transportWorkbenchCompareBtn.dataset.bound) {
        transportWorkbenchCompareBtn.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          setTransportWorkbenchCompareHeld(true);
        });
        ["pointerup", "pointercancel", "pointerleave", "blur"].forEach((eventName) => {
          transportWorkbenchCompareBtn.addEventListener(eventName, () => {
            setTransportWorkbenchCompareHeld(false);
          });
        });
        transportWorkbenchCompareBtn.addEventListener("keydown", (event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          setTransportWorkbenchCompareHeld(true);
        });
        transportWorkbenchCompareBtn.addEventListener("keyup", (event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          setTransportWorkbenchCompareHeld(false);
        });
        transportWorkbenchCompareBtn.dataset.bound = "true";
      }

      if (transportWorkbenchZoomOutBtn && !transportWorkbenchZoomOutBtn.dataset.bound) {
        transportWorkbenchZoomOutBtn.addEventListener("click", () => {
          stepTransportWorkbenchCarrierZoom(-1);
          syncTransportWorkbenchPreviewControls();
        });
        transportWorkbenchZoomOutBtn.dataset.bound = "true";
      }

      if (transportWorkbenchZoomInBtn && !transportWorkbenchZoomInBtn.dataset.bound) {
        transportWorkbenchZoomInBtn.addEventListener("click", () => {
          stepTransportWorkbenchCarrierZoom(1);
          syncTransportWorkbenchPreviewControls();
        });
        transportWorkbenchZoomInBtn.dataset.bound = "true";
      }

      if (transportWorkbenchRotateBtn && !transportWorkbenchRotateBtn.dataset.bound) {
        transportWorkbenchRotateBtn.addEventListener("click", () => {
          toggleTransportWorkbenchCarrierQuarterTurn();
          syncTransportWorkbenchPreviewControls();
        });
        transportWorkbenchRotateBtn.dataset.bound = "true";
      }

      transportWorkbenchFamilyTabs.forEach((button) => {
        if (!button || button.dataset.bound === "true") return;
        button.addEventListener("click", () => {
          ensureTransportWorkbenchUiState();
          runtimeState.transportWorkbenchUi.activeFamily = normalizeTransportWorkbenchFamily(button.dataset.transportFamily || "road");
          runtimeState.transportWorkbenchUi.compareHeld = false;
          renderTransportWorkbenchUi();
        });
        button.dataset.bound = "true";
      });

      transportWorkbenchInspectorTabButtons.forEach((button) => {
        if (!button || button.dataset.bound === "true") return;
        button.addEventListener("click", () => {
          ensureTransportWorkbenchUiState();
          runtimeState.transportWorkbenchUi.activeInspectorTab = normalizeTransportWorkbenchInspectorTab(button.dataset.transportInspectorTab || "inspect");
          const context = getTransportWorkbenchRenderContext();
          renderTransportWorkbenchShell(context);
          renderTransportWorkbenchInspector(context.family, context.config, context.compareHeld);
        });
        button.dataset.bound = "true";
      });

      if (!document.body.dataset.transportWorkbenchEscapeBound) {
        document.addEventListener("keydown", (event) => {
          if (event.key !== "Escape" || !runtimeState.transportWorkbenchUi?.open) return;
          if (transportWorkbenchSectionHelpPopover && !transportWorkbenchSectionHelpPopover.classList.contains("hidden")) {
            event.preventDefault();
            closeTransportWorkbenchSectionHelpPopover({ restoreFocus: true });
            return;
          }
          if (transportWorkbenchInfoPopover && !transportWorkbenchInfoPopover.classList.contains("hidden")) {
            event.preventDefault();
            closeTransportWorkbenchInfoPopover({ restoreFocus: true });
            return;
          }
          event.preventDefault();
          setTransportWorkbenchState(false);
        });
        document.body.dataset.transportWorkbenchEscapeBound = "true";
      }
  };

  return {
    bindTransportWorkbenchEvents,
    closeTransportWorkbenchInfoPopover,
    closeTransportWorkbenchSectionHelpPopover,
    closeTransportWorkbench,
    ensureTransportWorkbenchUiState,
    initializeTransportWorkbenchRuntime,
    openTransportWorkbench,
    renderTransportWorkbenchUi,
  };
}

