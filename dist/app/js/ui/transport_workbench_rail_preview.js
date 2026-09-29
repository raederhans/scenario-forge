import { resolveTransportManifestUrl } from "../core/data_loader.js";
import {
  ensureTransportWorkbenchCarrierForManifest,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";
import {
  createTransportWorkbenchLinePathD as createPathD,
  createTransportWorkbenchLinePackRuntime,
  findTransportWorkbenchDatasetNode as findDatasetNode,
  measureTransportWorkbenchProjectedLineLength as measureProjectedLength,
  normalizeTransportWorkbenchNumber as normalizeNumber,
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
} from "./transport_workbench_line_runtime_shared.js";
import {
  DATA_ROW_LIMIT,
  LINE_CLASS_PRIORITY,
  formatLineVisibilityReason,
  getLineVisibilityReason,
  normalizeRailImportance,
  normalizeRailLineClass,
  normalizeRailLineStatus,
  normalizeRailSourceFlags,
  shouldShowStation,
} from "./transport_workbench_rail_preview_runtime.js";
import {
  buildVisibleRailStationLabelEntries,
  clearRailGroups,
  createRailPreviewGroups,
  destroyRailGroups,
  ensureRailGroups,
  renderRailSelectedHighlight,
  syncRailLineNodes,
  syncRailStationNodes,
} from "./transport_workbench_rail_preview_dom.js";

const MANIFEST_URL = resolveTransportManifestUrl("rail");

const groups = createRailPreviewGroups();

const lineRuntime = createTransportWorkbenchLinePackRuntime({
  familyId: "rail",
  familyLabel: "Japan rail",
  manifestUrl: MANIFEST_URL,
  ensureClient: ensureTopojsonClient,
  allowPendingManifest: true,
  initialRenderStats: {
    visibleLines: 0,
    visibleStations: 0,
    visibleLineLabels: 0,
    visibleStationLabels: 0,
    totalLines: 0,
    totalStations: 0,
    filteredLines: 0,
  },
  prepareCarrier: ensureTransportWorkbenchCarrierForManifest,
  async buildPack({ mode, manifest, getPackPath, loadTransportAsset }) {
    const railwaysPath = getPackPath(manifest, mode, "railways");
    const stationsPath = getPackPath(manifest, mode, "rail_stations_major");
    const railwaysTopology = await loadTransportAsset(railwaysPath, {
      label: `transport-pack:rail:${mode}:railways`,
    });
    const stationsCollection = await loadTransportAsset(stationsPath, {
      label: `transport-pack:rail:${mode}:rail_stations_major`,
    });
    const railwaysObject = railwaysTopology?.objects?.railways;
    if (!railwaysObject) {
      throw new Error(`Japan rail topology (${mode}) is missing the 'railways' object.`);
    }
    const decodedRailways = globalThis.topojson.feature(railwaysTopology, railwaysObject);
    const lineFeatures = (decodedRailways?.features || []).map(createRailFeature).filter(Boolean);
    const stationFeatures = (stationsCollection?.features || []).map(createStationFeature).filter(Boolean);
    return {
      mode,
      manifest,
      lineFeatures,
      stationFeatures,
      lineFeatureById: new Map(lineFeatures.map((feature) => [feature.id, feature])),
      stationFeatureById: new Map(stationFeatures.map((feature) => [feature.id, feature])),
    };
  },
});
const runtime = lineRuntime.runtime;

function ensureTopojsonClient() {
  if (!globalThis.topojson || typeof globalThis.topojson.feature !== "function") {
    throw new Error("topojson-client is unavailable for the Japan rail workbench preview.");
  }
}

function createRailFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature.geometry);
  if (!projected?.geometry) return null;
  const name = String(properties.name || properties.line_name || "").trim();
  return {
    id: String(properties.id || rawFeature.id || name || ""),
    name,
    operator: String(properties.operator || properties.company || "").trim(),
    railTypeCode: String(properties.rail_type_code || "").trim(),
    operatorTypeCode: String(properties.operator_type_code || "").trim(),
    status: normalizeRailLineStatus(properties.status),
    lineClass: normalizeRailLineClass(properties.class || properties.line_class),
    source: String(properties.source || "").trim(),
    sourceFlags: normalizeRailSourceFlags(properties.source_flags),
    lengthMeters: normalizeNumber(properties.length_m, 0),
    pathD: createPathD(projected.geometry),
    projectedLength: measureProjectedLength(projected.geometry),
  };
}

function createStationFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1]);
  if (!projected) return null;
  return {
    id: String(properties.id || rawFeature.id || properties.name || ""),
    name: String(properties.name || "").trim(),
    cityKey: String(properties.city_key || "").trim(),
    stationCode: String(properties.station_code || "").trim(),
    groupCode: String(properties.group_code || "").trim(),
    importance: normalizeRailImportance(properties.importance),
    source: String(properties.source || "").trim(),
    linkedLineClasses: normalizeRailSourceFlags(properties.linked_line_classes).map((value) => normalizeRailLineClass(value)),
    x: projected.x,
    y: projected.y,
  };
}

async function loadJapanRailPack(mode = PACK_MODE_PREVIEW, config = {}, { emitSelection = true } = {}) {
  if (config?.activePackId) {
    lineRuntime.setActivePack(config.activePackId, resolveTransportManifestUrl(config.activePackId));
  }
  return lineRuntime.loadPack(mode, () => {
    if (emitSelection && (runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
      emitSelectionChange();
    }
  });
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function handleLineGroupClick(event) {
  const node = findDatasetNode(event.target, "railLineId", groups.linesGroup);
  const lineId = node?.dataset?.railLineId;
  if (!lineId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "line", id: lineId };
  renderRailSelectedHighlight(groups, runtime.activePack?.lineFeatureById?.get(lineId) || null, null, runtime.lastRenderedConfig);
  emitSelectionChange();
}

function handleStationGroupClick(event) {
  const node = findDatasetNode(event.target, "railStationId", groups.stationsGroup);
  const stationId = node?.dataset?.railStationId;
  if (!stationId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "station", id: stationId };
  renderRailSelectedHighlight(groups, null, runtime.activePack?.stationFeatureById?.get(stationId) || null, runtime.lastRenderedConfig);
  emitSelectionChange();
}

function emitSelectionChange() {
  lineRuntime.emitSelectionChange(buildSelectedSnapshot);
}

function buildSelectedSnapshot(config) {
  if (!runtime.selectedFeature || !runtime.activePack) return null;
  if (runtime.selectedFeature.type === "station") {
    const station = runtime.activePack.stationFeatureById.get(runtime.selectedFeature.id);
    if (!station) return null;
    return {
      type: "station",
      id: station.id,
      name: station.name,
      cityKey: station.cityKey,
      stationCode: station.stationCode,
      groupCode: station.groupCode,
      importance: station.importance,
      source: station.source,
      visible: shouldShowStation(station, config, getCurrentScale()),
    };
  }
  const line = runtime.activePack.lineFeatureById.get(runtime.selectedFeature.id);
  if (!line) return null;
  const hiddenReason = getLineVisibilityReason(line, config, getCurrentScale());
  return {
    type: "line",
    id: line.id,
    name: line.name,
    operator: line.operator,
    railTypeCode: line.railTypeCode,
    operatorTypeCode: line.operatorTypeCode,
    status: line.status,
    lineClass: line.lineClass,
    source: line.source,
    sourceFlags: [...line.sourceFlags],
    visible: !hiddenReason,
    hiddenReason,
  };
}

function buildLineDataRow(line, config, scale) {
  const hiddenReason = getLineVisibilityReason(line, config || {}, scale);
  return {
    id: line.id,
    family: "rail",
    kind: "line",
    name: line.name || line.operator || line.id,
    source: line.source || "",
    visible: !hiddenReason,
    hiddenReason,
    lengthMeters: line.lengthMeters,
    railTypeCode: line.railTypeCode,
    lineClass: line.lineClass,
    selected: runtime.selectedFeature?.type === "line" && runtime.selectedFeature.id === line.id,
    properties: {
      operator: line.operator,
      rail_type_code: line.railTypeCode,
      operator_type_code: line.operatorTypeCode,
      status: line.status,
      line_class: line.lineClass,
      source_flags: [...(line.sourceFlags || [])],
      length_meters: line.lengthMeters,
    },
  };
}

function buildStationDataRow(station, config, scale) {
  const visible = shouldShowStation(station, config || {}, scale);
  return {
    id: station.id,
    family: "rail",
    kind: "station",
    name: station.name || station.stationCode || station.id,
    source: station.source || "",
    visible,
    hiddenReason: visible ? null : "station_filtered",
    importance: station.importance,
    selected: runtime.selectedFeature?.type === "station" && runtime.selectedFeature.id === station.id,
    properties: {
      city_key: station.cityKey,
      station_code: station.stationCode,
      group_code: station.groupCode,
      importance: station.importance,
      linked_line_classes: [...(station.linkedLineClasses || [])],
    },
  };
}

function buildDataRows(config = runtime.lastRenderedConfig) {
  const pack = runtime.activePack || lineRuntime.pickActivePack();
  if (!pack) return [];
  const scale = getCurrentScale();
  const lines = Array.isArray(pack.lineFeatures)
    ? pack.lineFeatures.map((line) => buildLineDataRow(line, config, scale))
    : [];
  const stations = Array.isArray(pack.stationFeatures)
    ? pack.stationFeatures.map((station) => buildStationDataRow(station, config, scale))
    : [];
  return [...lines, ...stations]
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      if (left.kind !== right.kind) return left.kind === "line" ? -1 : 1;
      return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
    })
    .slice(0, DATA_ROW_LIMIT);
}

function pickActivePack() {
  return lineRuntime.pickActivePack();
}

function renderRail(config) {
  const pack = pickActivePack();
  if (!pack || !ensureRailGroups(groups, { onLineClick: handleLineGroupClick, onStationClick: handleStationGroupClick })) {
    runtime.activePack = null;
    runtime.activePackMode = null;
    runtime.lastRenderedConfig = config;
    return getJapanRailPreviewSnapshot(config);
  }
  runtime.activePack = pack;
  runtime.activePackMode = pack.mode;
  runtime.lastRenderedConfig = config;
  const scale = getCurrentScale();
  const visibleLines = pack.lineFeatures
    .filter((feature) => !getLineVisibilityReason(feature, config, scale))
    .sort((left, right) => {
      const classDelta = (LINE_CLASS_PRIORITY[left.lineClass] || 0) - (LINE_CLASS_PRIORITY[right.lineClass] || 0);
      if (classDelta !== 0) return classDelta;
      return left.projectedLength - right.projectedLength;
    });
  const visibleStations = pack.stationFeatures.filter((feature) => shouldShowStation(feature, config, scale));
  const visibleStationLabelEntries = buildVisibleRailStationLabelEntries(visibleStations, config, scale);
  const selectedLineId = runtime.selectedFeature?.type === "line" ? runtime.selectedFeature.id : null;
  const selectedStationId = runtime.selectedFeature?.type === "station" ? runtime.selectedFeature.id : null;
  syncRailLineNodes(groups, visibleLines, config, selectedLineId);
  syncRailStationNodes(groups, visibleStations, visibleStationLabelEntries, config, selectedStationId);
  runtime.renderStats = {
    visibleLines: visibleLines.length,
    visibleStations: visibleStations.length,
    visibleLineLabels: 0,
    visibleStationLabels: visibleStationLabelEntries.length,
    totalLines: pack.lineFeatures.length,
    totalStations: pack.stationFeatures.length,
    filteredLines: pack.lineFeatures.length - visibleLines.length,
  };
  renderRailSelectedHighlight(
    groups,
    selectedLineId ? pack.lineFeatureById.get(selectedLineId) || null : null,
    selectedStationId ? pack.stationFeatureById.get(selectedStationId) || null : null,
    config,
  );
  return getJapanRailPreviewSnapshot(config);
}

function startBackgroundFullPackLoad(options = {}) {
  lineRuntime.startBackgroundFullPackLoad({
    onAuditReady() {
      if (typeof options.isCurrent === "function" && !options.isCurrent()) return;
      if ((runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated(pack) {
      if (typeof options.isCurrent === "function" && !options.isCurrent()) return;
      if (!pack || !runtime.lastRenderedConfig || !groups.rootGroup) return;
      renderRail(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
}

export function setJapanRailPreviewSelectionListener(listener) {
  lineRuntime.setSelectionListener(listener);
}

export function selectJapanRailPreviewFeature(selection) {
  const featureId = String(selection?.id || selection || "").trim();
  const kind = String(selection?.kind || selection?.type || "").trim();
  if (!featureId) return false;
  const pack = runtime.activePack || lineRuntime.pickActivePack();
  if (kind === "station" || pack?.stationFeatureById?.has(featureId)) {
    const station = pack?.stationFeatureById?.get(featureId) || null;
    if (!station) return false;
    runtime.selectedFeature = { type: "station", id: station.id };
    renderRailSelectedHighlight(groups, null, station, runtime.lastRenderedConfig);
    emitSelectionChange();
    return true;
  }
  const line = pack?.lineFeatureById?.get(featureId) || null;
  if (!line) return false;
  runtime.selectedFeature = { type: "line", id: line.id };
  renderRailSelectedHighlight(groups, line, null, runtime.lastRenderedConfig);
  emitSelectionChange();
  return true;
}

export async function renderJapanRailPreview(config, options = {}) {
  await loadJapanRailPack(PACK_MODE_PREVIEW, config);
  if (typeof options.isCurrent === "function" && !options.isCurrent()) {
    return null;
  }
  if (runtime.loadState.status === "ready") {
    startBackgroundFullPackLoad(options);
  }
  if (typeof options.isCurrent === "function" && !options.isCurrent()) {
    return null;
  }
  return renderRail(config);
}

export async function prepareJapanRailPreview(config = {}) {
  return loadJapanRailPack(PACK_MODE_PREVIEW, config, { emitSelection: false });
}

export async function warmJapanRailPreviewPack({ includeFull = false } = {}) {
  if (runtime.lastRenderedConfig?.activePackId) {
    lineRuntime.setActivePack(runtime.lastRenderedConfig.activePackId, resolveTransportManifestUrl(runtime.lastRenderedConfig.activePackId));
  }
  await lineRuntime.warm({
    includeFull,
    onAuditReady() {
      if ((runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated(pack) {
      if (!pack || !runtime.lastRenderedConfig || !groups.rootGroup) return;
      renderRail(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
  return getJapanRailPreviewSnapshot(runtime.lastRenderedConfig);
}

export function clearJapanRailPreview() {
  const totalLines = runtime.activePack?.lineFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.lineFeatures?.length || 0;
  const totalStations = runtime.activePack?.stationFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.stationFeatures?.length || 0;
  runtime.lastRenderedConfig = null;
  runtime.activePack = null;
  runtime.activePackMode = null;
  clearRailGroups(groups);
  runtime.renderStats = {
    visibleLines: 0,
    visibleStations: 0,
    visibleLineLabels: 0,
    visibleStationLabels: 0,
    totalLines,
    totalStations,
    filteredLines: 0,
  };
}

export function destroyJapanRailPreview() {
  const totalLines = runtime.activePack?.lineFeatures?.length || runtime.projectedPacks[PACK_MODE_FULL]?.lineFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.lineFeatures?.length || 0;
  const totalStations = runtime.activePack?.stationFeatures?.length || runtime.projectedPacks[PACK_MODE_FULL]?.stationFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.stationFeatures?.length || 0;
  runtime.selectedFeature = null;
  runtime.lastRenderedConfig = null;
  runtime.activePack = null;
  runtime.activePackMode = null;
  runtime.renderStats = {
    visibleLines: 0,
    visibleStations: 0,
    visibleLineLabels: 0,
    visibleStationLabels: 0,
    totalLines,
    totalStations,
    filteredLines: 0,
  };
  destroyRailGroups(groups);
}

export function getJapanRailPreviewSnapshot(config = runtime.lastRenderedConfig) {
  const snapshot = lineRuntime.getSnapshot(config ? buildSelectedSnapshot : null);
  const pack = runtime.activePack || lineRuntime.pickActivePack();
  const totalRows = (pack?.lineFeatures?.length || 0) + (pack?.stationFeatures?.length || 0);
  return {
    ...snapshot,
    dataRows: buildDataRows(config),
    dataRowCount: totalRows,
    dataRowLimit: DATA_ROW_LIMIT,
  };
}

export function formatJapanRailVisibilityReason(reason) {
  return formatLineVisibilityReason(reason);
}
