import {
  getTransportCapabilityDefaultOverviewConfig,
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
  normalizeTransportOverviewVisualMode,
  resolveLinkedTransportOverviewScopeAndThreshold,
} from "../../core/transport_capability_registry.js";
import {
  buildTransportFamilySummaryText,
} from "./appearance_transport_summary.js";
import {
  THEMATIC_CATALOG_PENDING_SUMMARY,
  THEMATIC_CATALOG_READY_SUMMARY,
  THEMATIC_LAYER_RENDER_DISABLED_REASON,
  THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON,
  THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON,
} from "../../core/thematic_layer_catalog.js";
import {
  getLayerPanelContractById,
  getLayerPanelDisabledReason,
  getLayerPanelUnsupportedReason,
  listBaseLayerStatusContracts,
  listTransportLayerPanelContracts,
} from "./layer_panel_contracts.js";

const STATUS_SEVERITY = Object.freeze({
  ACTIVE: "active",
  MUTED: "muted",
  WARNING: "warning",
});

const STATUS_TONE = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled",
  OFF: "off",
  MUTED: "muted",
  PENDING: "pending",
  WARNING: "warning",
});

function translateUi(translate, key) {
  return typeof translate === "function" ? translate(key, "ui") : key;
}

function normalizeFiniteCount(value) {
  if (value == null || value === "") return null;
  const count = Number(value);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.round(count));
}

function getFeatureCollectionCount(collection) {
  if (!collection || typeof collection !== "object") return null;
  if (!Array.isArray(collection.features)) return null;
  return collection.features.length;
}

function sumFeatureCounts(state, dataKeys = []) {
  let total = 0;
  let found = false;
  dataKeys.forEach((key) => {
    const count = getFeatureCollectionCount(state?.[key]);
    if (count == null) return;
    total += count;
    found = true;
  });
  return found ? total : null;
}

function getMetric(metrics, metricNames = []) {
  const source = metrics && typeof metrics === "object" ? metrics : {};
  const breakdown = source.contextBreakdown && typeof source.contextBreakdown === "object"
    ? source.contextBreakdown
    : {};
  for (const metricName of metricNames) {
    const metric = breakdown[metricName] || source[metricName] || null;
    if (metric && typeof metric === "object") return metric;
  }
  return null;
}

function getCityVisibilityMetric(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {};
  const breakdown = source.contextBreakdown && typeof source.contextBreakdown === "object"
    ? source.contextBreakdown : {};
  const candidates = [source.drawLabelsPass, source.drawCityPointsLayer,
    breakdown.drawLabelsPass, breakdown.drawCityPointsLayer]
    .filter((metric) => metric && typeof metric === "object"
      && metric.visibleFeatureCount != null
      && normalizeFiniteCount(metric.visibleFeatureCount) != null);
  return candidates.reduce((latest, metric) => {
    if (!latest) return metric;
    const sequence = Number(metric.sequence || 0);
    const latestSequence = Number(latest.sequence || 0);
    if (sequence && latestSequence && sequence !== latestSequence) {
      return sequence > latestSequence ? metric : latest;
    }
    return Number(metric.recordedAt || 0) > Number(latest.recordedAt || 0) ? metric : latest;
  }, null);
}

function getLoadStatus(state, loadKeys = []) {
  const statuses = state?.contextLayerLoadStateByName && typeof state.contextLayerLoadStateByName === "object"
    ? state.contextLayerLoadStateByName
    : {};
  const values = loadKeys
    .map((key) => String(statuses[key] || "").trim().toLowerCase())
    .filter(Boolean);
  if (values.some((value) => value === "loading")) return "loading";
  if (values.some((value) => value === "error" || value === "failed")) return "error";
  if (values.some((value) => value === "loaded" || value === "ready")) return "loaded";
  return values[0] || "";
}

function joinStatusParts(...parts) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
}

export function sanitizeLayerStatusText(value) {
  const compactText = String(value ?? "")
    .replace(/\b(?:undefined|null|NaN)\b/gi, "")
    .trim();
  const sanitized = compactText
    .split("·")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
  return sanitized || "Status unavailable";
}

export function resolveLayerStatusTone(diagnostic = {}, severity = "") {
  const normalizedSeverity = String(severity || diagnostic?.severity || "").trim().toLowerCase();
  const loadStatus = String(diagnostic?.loadStatus || diagnostic?.status || "").trim().toLowerCase();
  if (normalizedSeverity === STATUS_SEVERITY.ACTIVE) return STATUS_TONE.ACTIVE;
  if (loadStatus === "loading" || loadStatus === "pending") return STATUS_TONE.PENDING;
  if (normalizedSeverity === STATUS_SEVERITY.WARNING || loadStatus === "error" || loadStatus === "failed") {
    return STATUS_TONE.WARNING;
  }
  if (diagnostic?.supported === false) return STATUS_TONE.DISABLED;
  if (diagnostic?.enabled === false) return STATUS_TONE.OFF;
  return STATUS_TONE.MUTED;
}

function formatCount(count, noun, translate) {
  const safeCount = normalizeFiniteCount(count);
  if (safeCount == null) return "";
  return `${safeCount.toLocaleString()} ${translateUi(translate, noun)}`;
}

function buildEnabledSummary({
  enabled,
  loadedCount,
  visibleCount,
  loadStatus,
  translate,
}) {
  if (!enabled) return translateUi(translate, "Hidden");
  if (loadStatus === "loading") return translateUi(translate, "Loading/settling");
  if (loadStatus === "error") return translateUi(translate, "Load error");
  const visible = normalizeFiniteCount(visibleCount);
  const loaded = normalizeFiniteCount(loadedCount);
  if (visible && visible > 0) {
    return joinStatusParts(
      translateUi(translate, "Visible"),
      formatCount(visible, "visible", translate),
      loaded != null ? formatCount(loaded, "loaded", translate) : "",
    );
  }
  if (loaded != null && loaded > 0 && visible === 0) {
    return joinStatusParts(
      translateUi(translate, "Loaded · 0 visible"),
      formatCount(loaded, "loaded", translate),
    );
  }
  if (loaded != null && loaded > 0) return joinStatusParts(translateUi(translate, "Loaded"), formatCount(loaded, "loaded", translate));
  return translateUi(translate, "Enabled · waiting for data");
}

function createLayerDiagnostic(definition, state, translate) {
  const enabled = typeof definition.enabled === "function"
    ? !!definition.enabled(state || {})
    : true;
  const metric = definition.id === "city-points"
    ? getCityVisibilityMetric(state?.renderPerfMetrics)
    : getMetric(state?.renderPerfMetrics, definition.metricNames);
  const metricFeatureCount = normalizeFiniteCount(metric?.featureCount);
  const dataFeatureCount = sumFeatureCounts(state || {}, definition.dataKeys);
  const loadedCount = metricFeatureCount ?? dataFeatureCount;
  const visibleCount = normalizeFiniteCount(metric?.visibleFeatureCount);
  const loadStatus = getLoadStatus(state || {}, definition.loadKeys);
  const severity = !enabled
    ? STATUS_SEVERITY.MUTED
    : loadStatus === "error"
      ? STATUS_SEVERITY.WARNING
      : STATUS_SEVERITY.ACTIVE;
  return {
    id: definition.id,
    label: definition.label,
    enabled,
    loadedCount,
    visibleCount,
    loadStatus,
    severity,
    summary: sanitizeLayerStatusText(buildEnabledSummary({
      enabled,
      loadedCount,
      visibleCount,
      loadStatus,
      translate,
    })),
  };
}

export function buildBathymetryDiagnostic(state = {}, { translate } = {}) {
  const contract = getLayerPanelContractById("bathymetry");
  const oceanStyle = state.styleConfig?.ocean || {};
  const enabled = oceanStyle.experimentalAdvancedStyles === true;
  const preset = String(oceanStyle.preset || "flat").trim() || "flat";
  const bandsCount = getFeatureCollectionCount(state.activeBathymetryBandsData) ?? 0;
  const contoursCount = getFeatureCollectionCount(state.activeBathymetryContoursData) ?? 0;
  const source = String(state.activeBathymetrySource || "none").trim() || "none";
  let summary = "";
  let severity = STATUS_SEVERITY.ACTIVE;
  if (!enabled) {
    summary = getLayerPanelDisabledReason(contract, { translate })
      || translateUi(translate, "Off");
    severity = STATUS_SEVERITY.MUTED;
  } else if (preset === "flat") {
    summary = translateUi(translate, "Experimental Bathymetry enabled · flat style selected");
  } else if (bandsCount > 0 || contoursCount > 0) {
    summary = joinStatusParts(
      translateUi(translate, "Bathymetry available"),
      `${translateUi(translate, "source")} ${source}`,
      formatCount(bandsCount, "bands", translate),
      formatCount(contoursCount, "contours", translate),
    );
  } else {
    summary = translateUi(translate, "Bathymetry data pending for selected style");
    severity = STATUS_SEVERITY.WARNING;
  }
  return {
    id: "bathymetry",
    label: contract?.label || "Bathymetry",
    enabled,
    loadedCount: bandsCount + contoursCount,
    visibleCount: null,
    severity,
    summary: sanitizeLayerStatusText(summary),
  };
}

export function buildTextureDiagnostic(state = {}, { translate } = {}) {
  const contract = getLayerPanelContractById("texture");
  const mode = String(state.styleConfig?.texture?.mode || "none").trim().toLowerCase() || "none";
  const enabled = mode !== "none";
  return {
    id: "texture",
    label: contract?.label || "Texture",
    enabled,
    severity: enabled ? STATUS_SEVERITY.ACTIVE : STATUS_SEVERITY.MUTED,
    summary: sanitizeLayerStatusText(enabled
      ? joinStatusParts(translateUi(translate, "Enabled"), translateUi(translate, mode))
      : translateUi(translate, "Hidden")),
  };
}

export function buildDayNightDiagnostic(state = {}, { translate } = {}) {
  const contract = getLayerPanelContractById("day-night");
  const config = state.styleConfig?.dayNight || {};
  const enabled = config.enabled === true;
  const mode = String(config.mode || "manual").trim().toLowerCase() || "manual";
  const modeLabel = {
    manual: "Manual UTC",
    utc: "Live Computer UTC",
    cycle: "Continuous Cycle",
  }[mode] || mode;
  return {
    id: "day-night",
    label: contract?.label || "Day / Night",
    enabled,
    severity: enabled ? STATUS_SEVERITY.ACTIVE : STATUS_SEVERITY.MUTED,
    summary: sanitizeLayerStatusText(enabled
      ? joinStatusParts(translateUi(translate, "Enabled"), translateUi(translate, modeLabel))
      : translateUi(translate, "Hidden")),
  };
}

export function buildThematicCatalogDiagnostic({
  thematicCatalogPreview = null,
} = {}, { translate } = {}) {
  const contract = getLayerPanelContractById("thematic");
  const preview = thematicCatalogPreview && typeof thematicCatalogPreview === "object"
    ? thematicCatalogPreview
    : {};
  const layers = Array.isArray(preview.layers) ? preview.layers : [];
  const status = String(preview.status || "").trim().toLowerCase();
  const error = String(preview.error || "").trim();
  const layerCount = normalizeFiniteCount(preview.layerCount ?? layers.length) ?? layers.length;
  const loadedManifestCount = normalizeFiniteCount(preview.loadedManifestCount) ?? layers.filter((layer) => layer.manifestLoaded).length;
  const fixtureOnlyCount = layers.filter((layer) => layer.fixtureOnly).length;
  const hiddenByDefaultCount = layers.filter((layer) => layer.hiddenByDefault).length;
  const hasRealSourceNotIngested = layers.some((layer) => layer.realSourceStatus === THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON);
  const hasRealSourceDerivedMetadata = layers.some((layer) => layer.realSourceStatus === THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON);
  let summary = THEMATIC_CATALOG_PENDING_SUMMARY;
  let severity = STATUS_SEVERITY.MUTED;
  if (status === "error" || error) {
    summary = joinStatusParts(
      translateUi(translate, "Thematic catalog unavailable"),
      error,
    );
    severity = STATUS_SEVERITY.WARNING;
  } else if (layerCount > 0) {
    summary = joinStatusParts(
      translateUi(translate, THEMATIC_CATALOG_READY_SUMMARY),
      `${layerCount} ${translateUi(translate, "layers")}`,
      `${loadedManifestCount} ${translateUi(translate, "manifests")}`,
      fixtureOnlyCount > 0 ? translateUi(translate, "Fixture only") : "",
      hiddenByDefaultCount > 0 ? translateUi(translate, "Hidden by default") : "",
      translateUi(translate, THEMATIC_LAYER_RENDER_DISABLED_REASON),
      hasRealSourceNotIngested ? translateUi(translate, THEMATIC_REAL_SOURCE_NOT_INGESTED_REASON) : "",
      hasRealSourceDerivedMetadata ? translateUi(translate, THEMATIC_REAL_SOURCE_DERIVED_METADATA_REASON) : "",
    );
    severity = STATUS_SEVERITY.MUTED;
  }
  return {
    id: "thematic",
    label: contract?.label || "Thematic Layers",
    enabled: false,
    loadStatus: status || (layerCount > 0 ? "loaded" : "pending"),
    loadedCount: layerCount,
    visibleCount: 0,
    severity,
    summary: sanitizeLayerStatusText(summary),
  };
}

function getTransportFamilyConfig(transportConfig, familyId) {
  const defaults = getTransportCapabilityDefaultOverviewConfig(familyId) || {};
  const source = transportConfig?.[familyId] && typeof transportConfig[familyId] === "object"
    ? transportConfig[familyId]
    : {};
  return {
    ...defaults,
    ...source,
  };
}

function getEffectiveTransportScopeState(familyId, familyConfig) {
  const scopeMode = String(familyConfig?.scopeLinkMode || "linked").trim().toLowerCase();
  if (scopeMode === "manual") {
    return {
      scope: String(familyConfig?.scope || "").trim().toLowerCase(),
      importanceThreshold: String(familyConfig?.importanceThreshold || "").trim().toLowerCase(),
    };
  }
  return resolveLinkedTransportOverviewScopeAndThreshold(
    familyId,
    Number(familyConfig?.coverageReach ?? 0.5),
  );
}

export function buildTransportMasterDiagnostic(state = {}, { translate } = {}) {
  const contract = getLayerPanelContractById("transport");
  const masterEnabled = state.showTransport !== false;
  const selectedFamilies = listTransportOverviewCapabilityFamilyIds()
    .filter((familyId) => {
      const field = getTransportOverviewVisibilityField(familyId);
      return !!field && !!state[field];
    });
  let summary = translateUi(translate, "Hidden");
  let severity = STATUS_SEVERITY.MUTED;
  if (masterEnabled && selectedFamilies.length === 0) {
    summary = translateUi(translate, "No overview family selected");
  } else if (masterEnabled) {
    summary = joinStatusParts(
      translateUi(translate, "Enabled"),
      `${selectedFamilies.length} ${translateUi(translate, "overview families selected")}`,
    );
    severity = STATUS_SEVERITY.ACTIVE;
  }
  return {
    id: "transport",
    label: contract?.label || "Transport",
    enabled: masterEnabled,
    selectedFamilies,
    severity,
    summary: sanitizeLayerStatusText(summary),
  };
}

export function buildTransportFamilyDiagnostics(state = {}, { translate } = {}) {
  const transportConfig = state.styleConfig?.transportOverview || {};
  const masterEnabled = state.showTransport !== false;
  const visualMode = normalizeTransportOverviewVisualMode(transportConfig.visualMode, "distribution");
  const overviewFamilies = new Set(listTransportOverviewCapabilityFamilyIds());
  return listTransportLayerPanelContracts().map((contract) => {
    const familyId = contract.familyId || String(contract.id || "").replace(/^transport-/, "");
    const overviewSupported = contract.supportsMainOverview === true;
    if (!overviewSupported) {
      const reason = getLayerPanelUnsupportedReason(contract, { translate })
        || translateUi(translate, "Available in Transport Workbench only");
      return {
        id: `transport-${familyId}`,
        familyId,
        label: contract.label || familyId,
        enabled: false,
        supported: false,
        severity: STATUS_SEVERITY.MUTED,
        disabledReason: reason,
        summary: sanitizeLayerStatusText(reason),
      };
    }
    const visibilityField = getTransportOverviewVisibilityField(familyId);
    const familyEnabled = !!visibilityField && !!state[visibilityField];
    const familyConfig = getTransportFamilyConfig(transportConfig, familyId);
    const effectiveScope = getEffectiveTransportScopeState(familyId, familyConfig);
    return {
      id: `transport-${familyId}`,
      familyId,
      label: contract.label || familyId,
      enabled: masterEnabled && familyEnabled,
      supported: overviewFamilies.has(familyId),
      severity: masterEnabled && familyEnabled ? STATUS_SEVERITY.ACTIVE : STATUS_SEVERITY.MUTED,
      summary: sanitizeLayerStatusText(buildTransportFamilySummaryText({
        familyId,
        masterEnabled,
        familyEnabled,
        familyConfig,
        effectiveScope,
        collections: {
          airport: state.airportsData,
          port: state.portsData,
          rail: state.railwaysData,
          road: state.roadsData,
        },
        metrics: state.renderPerfMetrics,
        zoomScale: state.zoomTransform?.k,
        visualMode,
        translate,
      })),
    };
  });
}

export function buildLayerStatusDiagnostics(state = {}, { translate, thematicCatalogPreview = null } = {}) {
  const layerDiagnostics = listBaseLayerStatusContracts().map((definition) => (
    createLayerDiagnostic(definition, state, translate)
  ));
  return [
    ...layerDiagnostics,
    buildBathymetryDiagnostic(state, { translate }),
    buildDayNightDiagnostic(state, { translate }),
    buildTextureDiagnostic(state, { translate }),
    buildThematicCatalogDiagnostic({ thematicCatalogPreview }, { translate }),
    buildTransportMasterDiagnostic(state, { translate }),
    ...buildTransportFamilyDiagnostics(state, { translate }),
  ];
}

export {
  STATUS_TONE,
  STATUS_SEVERITY,
};
