// Transport workbench config owner.
// Owns family ids, option normalization, and per-family workbench config shape.

import { listTransportWorkbenchRuntimeFamilyIds } from "./transport_workbench_family_registry.js";
import {
  TRANSPORT_WORKBENCH_FAMILIES,
  ROAD_CLASS_OPTIONS,
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
  TRANSPORT_WORKBENCH_DEFAULT_CONFIGS,
} from "./transport_workbench_descriptor.js";

const TRANSPORT_WORKBENCH_FAMILY_IDS = new Set(TRANSPORT_WORKBENCH_FAMILIES.map((family) => family.id));
const TRANSPORT_WORKBENCH_SORTABLE_LAYER_IDS = TRANSPORT_WORKBENCH_FAMILIES
  .filter((family) => family.id !== "layers")
  .map((family) => family.id);
export const TRANSPORT_WORKBENCH_RUNTIME_FAMILY_IDS = listTransportWorkbenchRuntimeFamilyIds();

const TRANSPORT_WORKBENCH_LABEL_DENSITY_VALUES = TRANSPORT_WORKBENCH_LABEL_DENSITY_OPTIONS.map((option) => option.value);
export { TRANSPORT_WORKBENCH_INSPECTOR_TABS };
export const TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS = TRANSPORT_WORKBENCH_INSPECTOR_TABS.map((tab) => tab.id);
export function normalizeTransportWorkbenchFamily(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TRANSPORT_WORKBENCH_FAMILY_IDS.has(normalized) ? normalized : "road";
}

export function normalizeTransportWorkbenchInspectorTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "aggregation" || normalized === "labels") return "display";
  if (normalized === "coverage") return "data";
  return TRANSPORT_WORKBENCH_INSPECTOR_TAB_IDS.includes(normalized) ? normalized : "inspect";
}

export function mapTransportWorkbenchLabelLevelToMaxLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "region") return 1;
  if (normalized === "category") return 3;
  return 2;
}

export function mapTransportWorkbenchMaxLevelToLabelLevel(value) {
  const numeric = Number(value);
  if (numeric >= 3) return "category";
  if (numeric <= 1) return "region";
  return "anchor";
}

export function normalizeTransportWorkbenchEnum(value, allowedValues, fallback) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : fallback;
}

export function normalizeTransportWorkbenchMulti(value, allowedValues, fallbackValues) {
  const next = Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter((entry) => allowedValues.includes(entry))
    : [];
  return next.length ? Array.from(new Set(next)) : [...fallbackValues];
}

export function normalizeTransportWorkbenchDensityConfig(source, defaults, {
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

export function normalizeTransportWorkbenchLayerOrder(value) {
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

export function normalizeRoadTransportWorkbenchConfig(value) {
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

export function normalizeRailTransportWorkbenchConfig(value) {
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

export function normalizeAirportTransportWorkbenchConfig(value) {
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

export function normalizePortTransportWorkbenchConfig(value) {
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

export function normalizeMineralResourceTransportWorkbenchConfig(value) {
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

export function normalizeEnergyFacilityTransportWorkbenchConfig(value) {
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

export function normalizeIndustrialTransportWorkbenchConfig(value) {
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

export function normalizeLogisticsHubTransportWorkbenchConfig(value) {
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
