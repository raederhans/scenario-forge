// Transport workbench inspector owner.
// Owns inspector row models, diagnostic summaries, manifest-only rows, and small inspector DOM factories.

import {
  ROAD_CLASS_OPTIONS,
  RAIL_CLASS_OPTIONS,
  RAIL_STATUS_OPTIONS,
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
  buildEnergyFacilitySubtypeControlOptions,
} from "./transport_workbench_descriptor.js";
import { normalizeTransportWorkbenchEnum } from "./transport_workbench_config_owner.js";
import {
  getTransportWorkbenchManifestDefaultVariantId,
  getTransportWorkbenchManifestVariantMeta,
  listTransportWorkbenchManifestVariantEntries,
} from "../transport_workbench_manifest_variants.js";
import { formatJapanRailVisibilityReason } from "../transport_workbench_rail_preview.js";

const INSPECTOR_CLASSIFIED_FAMILY_IDS = new Set(["industrial_zones", "logistics_hubs"]);
const INSPECTOR_GOVERNANCE_ROW_LABELS = new Set([
  "Pack version",
  "Recipe version",
  "Last build",
  "License tier",
  "Variant tier",
  "Distribution tier",
  "Source policy",
  "Source member",
  "Source dataset",
  "Data path",
  "Data check",
  "Pack mode",
  "Adapter",
  "Coverage scope",
  "N06 member",
  "N06 encoding",
  "Source encoding",
  "Release policy",
  "Full features",
  "Preview features",
  "Default variant",
  "Variants",
]);

export function buildTransportWorkbenchPackDetailsRows(previewSnapshot = {}, dataContract = null, familyId = "") {
  const manifest = previewSnapshot.manifest || {};
  const audit = previewSnapshot.audit || {};
  const selectedProps = previewSnapshot.selected?.properties || {};
  const variant = previewSnapshot.activeVariant
    ? getTransportWorkbenchManifestVariantMeta(manifest, previewSnapshot.activeVariant, familyId)
    : null;
  const rows = [
    ["Pack version", manifest.adapter_id || dataContract?.adapterId || "—"],
    ["Recipe version", manifest.recipe_version || audit.recipe_version || "—"],
    ["Source policy", manifest.source_policy || "—"],
    ["License tier", variant?.license_tier || manifest.license_tier || "—"],
    ["Distribution tier", variant?.distribution_tier || manifest.distribution_tier || "—"],
    ["Release policy", manifest.release_policy || "—"],
    ["N06 member", manifest.n06_source_member || audit.n06_source_member || "—"],
    ["N06 encoding", manifest.n06_encoding || audit.n06_encoding || "—"],
    ["Source encoding", manifest.source_encoding || audit.source_encoding || "—"],
    ["Data packs", Array.isArray(dataContract?.packs) ? dataContract.packs.join(", ") : "—"],
    ["Geometry source", dataContract?.geometrySource || "—"],
    ["Coverage scope", manifest.coverage_scope || "—"],
    ["Source dataset", selectedProps.source_dataset || "—"],
    ["Source member", selectedProps.source_member || "—"],
    ["Last build", formatTransportWorkbenchManifestTimestamp(manifest.generated_at)],
    ["Source and use", dataContract?.governance || "—"],
  ];
  return rows.filter(([, value]) => value !== "—" && value !== "unknown");
}

export function formatTransportWorkbenchOptionLabels(values, options) {
  const labelByValue = new Map((options || []).map((option) => [option.value, option.label]));
  return (values || []).map((value) => labelByValue.get(value) || value).join(", ");
}

export function getTransportWorkbenchInspectorRowClassNames({
  familyId = "",
  index = -1,
  label = "",
} = {}) {
  if (!INSPECTOR_CLASSIFIED_FAMILY_IDS.has(String(familyId || ""))) {
    return [];
  }
  const classNames = [];
  const rowIndex = Number(index);
  const rowLabel = String(label || "");
  if (Number.isFinite(rowIndex) && rowIndex >= 0 && rowIndex < 4) {
    classNames.push("is-summary");
  }
  if (rowLabel.startsWith("Selected ")) {
    classNames.push("is-selected");
  }
  if (INSPECTOR_GOVERNANCE_ROW_LABELS.has(rowLabel)) {
    classNames.push("is-governance");
  }
  return classNames;
}

export function formatTransportWorkbenchManifestTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return "unknown";
  return text.replace("T", " ").replace("Z", " UTC");
}

export function formatTransportWorkbenchRoadHiddenReason(reason) {
  const map = {
    class_filtered: "Filtered by class",
    link_filtered: "Filtered by link rule",
    short_projected_segment: "Dropped by min projected length",
    short_primary: "Dropped as short primary",
    dense_metro_guard: "Dropped by dense metro guard",
    zoom_gate: "Hidden by zoom gate",
  };
  return map[String(reason || "").trim()] || "Visible";
}

export function buildManifestOnlyInspectorRows(family, previewSnapshot, dataContract) {
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
}

export function buildTransportWorkbenchDiagnosticRows(familyId, config) {
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
}

export function buildTransportWorkbenchLensSummaryRows({
  family,
  previewSnapshot,
  dataContract,
  rightDeckLabel,
} = {}) {
  return [
    ["Preview", family?.previewTitle || family?.label || ""],
    ["Pack status", previewSnapshot?.status || "pending"],
  ];
}

function createStateCard(title, body, tone = "soft") {
  return { type: "state-card", title, body, tone };
}

export function buildTransportWorkbenchInspectorModel({
  family,
  config = {},
  compareHeld = false,
  previewSnapshot = {},
  dataContract = null,
  layerOrder = [],
  getLayerFamilyMeta = () => ({ label: "Unknown" }),
  isLivePreviewFamily = () => false,
  isManifestOnlyRuntimeFamily = () => false,
} = {}) {
  // 先把家族差异收口成纯 rows/stateCards，后面的 DOM owner 只负责渲染。
  // 这样 family-specific 诊断逻辑可以单测，也方便后续继续拆分大分支。
  const familyId = family?.id || "";
  const stateCards = [];
  let rows;
  if (familyId === "road" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "road" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Road pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "road") {
    rows = [
      ["Pack status", "Loading Japan road pack"],
      ["Adapter", config.motorwayIdentitySource === "osm_only" ? "OSM only" : "OSM + N06 hardening"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "rail" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "rail" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Rail pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "rail") {
    rows = [
      ["Adapter", config.allowOsmActiveGapFill ? "Official active + OSM gap fill" : "Official active locked"],
      ["Statuses", formatTransportWorkbenchOptionLabels(config.status, RAIL_STATUS_OPTIONS)],
      ["Classes", formatTransportWorkbenchOptionLabels(config.class, RAIL_CLASS_OPTIONS)],
      ["Stations", config.showMajorStations ? `${config.importanceThreshold} threshold` : "Hidden"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for the Japan rail lines and major-station packs") : "Loading Japan rail pack"],
    ];
  } else if (familyId === "airport" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "airport" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Airport pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "airport") {
    rows = [
      ["Airport types", formatTransportWorkbenchOptionLabels(config.airportTypes, AIRPORT_TYPE_OPTIONS)],
      ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, AIRPORT_STATUS_OPTIONS)],
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for airport Japan pack") : "Loading Japan airport pack"],
    ];
  } else if (familyId === "port" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "port" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Port pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "port") {
    rows = [
      ["Coverage tier", config.coverageTier || "core"],
      ["Legal designations", formatTransportWorkbenchOptionLabels(config.legalDesignations, PORT_DESIGNATION_OPTIONS)],
      ["Manager types", formatTransportWorkbenchOptionLabels(config.managerTypes, PORT_MANAGER_TYPE_OPTIONS)],
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for port Japan pack") : "Loading Japan port pack"],
    ];
  } else if (familyId === "mineral_resources" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "mineral_resources" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Mineral resource pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "mineral_resources") {
    rows = [
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for the Japan mineral resource pack manifest") : "Loading Japan mineral resource pack"],
    ];
  } else if (familyId === "energy_facilities" && previewSnapshot?.status === "ready") {
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
  } else if (familyId === "energy_facilities" && previewSnapshot?.status === "error") {
    rows = [
      ["Pack status", "Energy facility pack failed to load"],
      ["Error", previewSnapshot.error || "Unknown error"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "energy_facilities") {
    rows = [
      ["Statuses", formatTransportWorkbenchOptionLabels(config.statuses, ENERGY_STATUS_OPTIONS)],
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data path", dataContract?.governance || "Deferred pack governance pending"],
      ["Pack status", previewSnapshot?.status === "pending" ? (dataContract?.pendingStatus || "Waiting for the Japan energy facility pack manifest") : "Loading Japan energy facility pack"],
    ];
  } else if (familyId === "industrial_zones" && previewSnapshot?.status === "ready") {
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
      stateCards.push(createStateCard(
        "No features match the current filters",
        "Switch the source track or relax the active land filters to bring industrial land back into view.",
        "soft",
      ));
    }
    rows = [
      ["Source track", activeVariant],
      ["Visible sites", String(visibleFeatures)],
      ["Filtered out", String(filteredFeatures)],
      ["Visible labels", String(visibleLabels)],
    ];
    if (selected) {
      rows.push(
        ["Selected site", selected.name || "Unnamed industrial site"],
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
      ["Loaded sites", String(totalFeatures)],
      ["Pack mode", previewSnapshot.packMode || "preview"],
      ["Variant tier", variantMeta?.distribution_tier || "unknown"],
      ["License tier", variantMeta?.license_tier || "unknown"],
      ["Pack version", previewSnapshot.manifest?.adapter_id || "active_industrial_zones_manifest"],
      ["Recipe version", previewSnapshot.manifest?.recipe_version || previewSnapshot.audit?.recipe_version || "unknown"],
      ["Last build", formatTransportWorkbenchManifestTimestamp(previewSnapshot.manifest?.generated_at)],
    );
    if (selected) {
      rows.push(
        ["Source dataset", selectedProps.source_dataset || "--"],
        ["Source member", selectedProps.source_member || "--"],
      );
    }
  } else if (familyId === "industrial_zones" && previewSnapshot?.status === "error") {
    stateCards.push(createStateCard(
      "Industrial land preview failed",
      previewSnapshot.error || "The industrial land pack could not be loaded.",
      "emphasis",
    ));
    rows = [["Data path", dataContract?.governance || "Deferred pack governance pending"]];
  } else if (familyId === "industrial_zones") {
    stateCards.push(createStateCard(
      "Preparing industrial land preview",
      "The current source track is still loading into the active carrier.",
      "soft",
    ));
    rows = [
      ["Source track", config.variant || (previewSnapshot?.manifest ? getTransportWorkbenchManifestDefaultVariantId(previewSnapshot.manifest, "industrial_zones") : "internal")],
      ["Land type", formatTransportWorkbenchOptionLabels(config.siteClasses, INDUSTRIAL_SITE_CLASS_OPTIONS)],
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data check", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (familyId === "logistics_hubs" && previewSnapshot?.status === "ready") {
    const selected = previewSnapshot.selected;
    const selectedProps = selected?.properties || {};
    const totalFeatures = Number(previewSnapshot.stats?.totalFeatures || 0);
    const visibleFeatures = Number(previewSnapshot.stats?.visibleFeatures || 0);
    const filteredFeatures = Number(previewSnapshot.stats?.filteredFeatures || 0);
    if (totalFeatures > 0 && visibleFeatures === 0) {
      stateCards.push(createStateCard(
        "No features match the current filters",
        "Relax the active hub category or operator type filters to bring logistics hubs back into view.",
        "soft",
      ));
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
  } else if (familyId === "logistics_hubs" && previewSnapshot?.status === "error") {
    stateCards.push(createStateCard(
      "Logistics hub preview failed",
      previewSnapshot.error || "The logistics hub pack could not be loaded.",
      "emphasis",
    ));
    rows = [["Data path", dataContract?.governance || "Deferred pack governance pending"]];
  } else if (familyId === "logistics_hubs") {
    stateCards.push(createStateCard(
      "Preparing logistics hub preview",
      "The current hub scope is still loading into the Japan carrier.",
      "soft",
    ));
    rows = [
      ["Hub category", formatTransportWorkbenchOptionLabels(config.hubTypes, LOGISTICS_HUB_TYPE_OPTIONS)],
      ["Operator type", formatTransportWorkbenchOptionLabels(config.operatorClassifications, LOGISTICS_OPERATOR_CLASSIFICATION_OPTIONS)],
      ["Labels", config.showLabels ? "Enabled" : "Hidden"],
      ["Data check", dataContract?.governance || "Deferred pack governance pending"],
    ];
  } else if (isManifestOnlyRuntimeFamily(familyId)) {
    rows = buildManifestOnlyInspectorRows(family, previewSnapshot, dataContract);
  } else if (familyId === "layers") {
    rows = (Array.isArray(layerOrder) ? layerOrder : []).map((layerId, index) => {
      const entry = getLayerFamilyMeta(layerId);
      if (isLivePreviewFamily(layerId)) {
        return [`${index + 1}`, `${entry.label} (live)`];
      }
      if (isManifestOnlyRuntimeFamily(layerId)) {
        return [`${index + 1}`, `${entry.label} (metadata)`];
      }
      return [`${index + 1}`, `${entry.label} (reserved)`];
    });
  } else {
    rows = [
      ["Adapter", "Reserved shell only"],
      ["Pack status", `Waiting for ${family?.label || "selected family"} Japan adapter`],
    ];
  }
  return {
    rows: (rows || []).filter(([label]) => !INSPECTOR_GOVERNANCE_ROW_LABELS.has(label)),
    stateCards,
  };
}

function normalizeInspectorRenderEntry(entry) {
  if (Array.isArray(entry)) {
    return [
      "row",
      String(entry[0] ?? ""),
      String(entry[1] ?? ""),
    ];
  }
  return [
    "node",
    String(entry?.className || ""),
    String(entry?.textContent || ""),
  ];
}

export function buildTransportWorkbenchInspectorRenderSignature({
  familyId = "",
  compareHeld = false,
  model = {},
} = {}) {
  // signature 只描述“当前看见的语义内容”，不关心临时节点身份，
  // 这样 preview 轮询时只要内容没变，就可以安全跳过 details DOM 重建。
  return JSON.stringify({
    familyId: String(familyId || ""),
    compareHeld: !!compareHeld,
    stateCards: (model.stateCards || []).map((card) => [
      String(card?.title || ""),
      String(card?.body || ""),
      String(card?.tone || ""),
    ]),
    rows: (model.rows || []).map(normalizeInspectorRenderEntry),
  });
}

export function createTransportWorkbenchInspectorOwner({
  getLayerOrder = () => [],
  getLayerFamilyMeta = () => ({ label: "Unknown" }),
  isLivePreviewFamily = () => false,
  isManifestOnlyRuntimeFamily = () => false,
} = {}) {
  let lastInspectorDetailsRender = null;

  const createRow = (label, value, rowMeta = {}) => {
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
    const classNames = getTransportWorkbenchInspectorRowClassNames({
      ...rowMeta,
      label,
    });
    if (classNames.length > 0) {
      row.classList.add(...classNames);
    }
    return row;
  };

  const createStateCardNode = (titleText, bodyText, tone = "soft") => {
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

  const renderDiagnosticsBody = (familyId, config) => {
    const body = document.createElement("div");
    body.className = "transport-workbench-section-body transport-workbench-section-body-diagnostics";
    buildTransportWorkbenchDiagnosticRows(familyId, config).forEach(([label, value]) => {
      body.appendChild(createRow(label, value));
    });
    return body;
  };

  const buildInspectorModel = (input = {}) => buildTransportWorkbenchInspectorModel({
    ...input,
    layerOrder: getLayerOrder(),
    getLayerFamilyMeta,
    isLivePreviewFamily,
    isManifestOnlyRuntimeFamily,
  });

  const syncInspectorEmptyCard = (detailsNode, emptyCard) => {
    if (emptyCard) {
      emptyCard.classList.toggle("hidden", detailsNode.childElementCount > 0);
    }
  };

  const renderInspectorDetails = ({
    detailsNode = null,
    emptyCard = null,
    family = null,
    config = {},
    compareHeld = false,
    previewSnapshot = {},
    dataContract = null,
  } = {}) => {
    if (!detailsNode) {
      return { reused: false, rowCount: 0, stateCardCount: 0 };
    }
    const inspectorModel = buildInspectorModel({
      family,
      config,
      compareHeld,
      previewSnapshot,
      dataContract,
    });
    const signature = buildTransportWorkbenchInspectorRenderSignature({
      familyId: family?.id,
      compareHeld,
      model: inspectorModel,
    });
    if (
      lastInspectorDetailsRender?.detailsNode === detailsNode
      && lastInspectorDetailsRender.signature === signature
      && lastInspectorDetailsRender.childElementCount === detailsNode.childElementCount
    ) {
      syncInspectorEmptyCard(detailsNode, emptyCard);
      return {
        reused: true,
        rowCount: inspectorModel.rows.length,
        stateCardCount: inspectorModel.stateCards.length,
      };
    }
    detailsNode.replaceChildren();
    inspectorModel.stateCards.forEach((card) => {
      detailsNode.appendChild(createStateCardNode(card.title, card.body, card.tone));
    });
    inspectorModel.rows.forEach((entry, index) => {
      if (Array.isArray(entry)) {
        detailsNode.appendChild(createRow(entry[0], entry[1], {
          familyId: family?.id,
          index,
        }));
        return;
      }
      detailsNode.appendChild(entry);
    });
    syncInspectorEmptyCard(detailsNode, emptyCard);
    lastInspectorDetailsRender = {
      detailsNode,
      signature,
      childElementCount: detailsNode.childElementCount,
    };
    return {
      reused: false,
      rowCount: inspectorModel.rows.length,
      stateCardCount: inspectorModel.stateCards.length,
    };
  };

  return {
    buildDiagnosticRows: buildTransportWorkbenchDiagnosticRows,
    buildInspectorModel,
    buildLensSummaryRows: buildTransportWorkbenchLensSummaryRows,
    buildManifestOnlyInspectorRows,
    createRow,
    createStateCardNode,
    getRowClassNames: getTransportWorkbenchInspectorRowClassNames,
    formatManifestTimestamp: formatTransportWorkbenchManifestTimestamp,
    formatOptionLabels: formatTransportWorkbenchOptionLabels,
    formatRoadHiddenReason: formatTransportWorkbenchRoadHiddenReason,
    renderInspectorDetails,
    renderDiagnosticsBody,
  };
}
