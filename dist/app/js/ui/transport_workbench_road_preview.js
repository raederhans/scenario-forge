import { resolveTransportManifestUrl } from "../core/data_loader.js";
import { estimateRoadPackRetentionBytes, ROAD_PACK_LOAD_BYTES } from "./transport_workbench_retention.js";
import {
  ensureTransportWorkbenchCarrierForManifest,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";
import {
  buildTransportWorkbenchProjectedLines as buildProjectedLines,
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
  ROAD_RENDER_PRIORITY,
  getRoadVisibilityReason,
  normalizeRoadSourceFlags,
} from "./transport_workbench_road_preview_runtime.js";
import {
  clearRoadGroups,
  createRoadPreviewGroups,
  destroyRoadGroups,
  ensureRoadGroups,
  filterVisibleRoadLabels,
  renderRoadSelectedHighlight,
  syncRoadLabelNodes,
  syncRoadNodes,
} from "./transport_workbench_road_preview_dom.js";


const MANIFEST_URL = resolveTransportManifestUrl("road");

const groups = createRoadPreviewGroups();

const lineRuntime = createTransportWorkbenchLinePackRuntime({
  familyId: "road",
  familyLabel: "Japan road",
  manifestUrl: MANIFEST_URL,
  ensureClient: ensureTopojsonClient,
  estimatePackBytes: estimateRoadPackRetentionBytes,
  estimatedLoadBytes: ROAD_PACK_LOAD_BYTES,
  initialRenderStats: {
    visibleRoads: 0,
    visibleLabels: 0,
    totalRoads: 0,
    totalLabels: 0,
    filteredRoads: 0,
  },
  prepareCarrier: ensureTransportWorkbenchCarrierForManifest,
  async buildPack({ mode, manifest, getPackPath, loadTransportAsset }) {
    const roadsPath = getPackPath(manifest, mode, "roads");
    const labelsPath = getPackPath(manifest, mode, "road_labels");
    const roadsTopology = await loadTransportAsset(roadsPath, {
      label: `transport-pack:road:${mode}:roads`,
    });
    const labelsCollection = await loadTransportAsset(labelsPath, {
      label: `transport-pack:road:${mode}:road_labels`,
    });
    const roadsObject = roadsTopology?.objects?.roads;
    if (!roadsObject) {
      throw new Error(`Japan road topology (${mode}) is missing the 'roads' object.`);
    }
    const decodedRoads = globalThis.topojson.feature(roadsTopology, roadsObject);
    const roadFeatures = (decodedRoads?.features || []).map(createRoadFeature).filter(Boolean);
    const roadFeatureById = new Map(roadFeatures.map((feature) => [feature.id, feature]));
    const labelFeatures = (labelsCollection?.features || [])
      .map((feature) => createLabelFeature(feature, roadFeatureById))
      .filter(Boolean);
    return {
      mode,
      manifest,
      roadFeatures,
      labelFeatures,
      roadFeatureById,
      labelFeatureById: new Map(labelFeatures.map((feature) => [feature.id, feature])),
    };
  },
});
const runtime = lineRuntime.runtime;


function ensureTopojsonClient() {
  if (!globalThis.topojson || typeof globalThis.topojson.feature !== "function") {
    throw new Error("topojson-client is unavailable for the Japan road workbench preview.");
  }
}

function createRoadFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature.geometry);
  if (!projected?.geometry) return null;
  const projectedLines = buildProjectedLines(projected.geometry);
  return {
    id: String(properties.id || rawFeature.id || ""),
    name: String(properties.name || "").trim(),
    ref: String(properties.ref || "").trim(),
    officialName: String(properties.official_name || "").trim(),
    officialRef: String(properties.official_ref || "").trim(),
    roadClass: String(properties.road_class || "").trim(),
    isLink: !!properties.is_link,
    denseMetro: !!properties.dense_metro,
    priority: normalizeNumber(properties.priority, 0),
    source: String(properties.source || "").trim(),
    sourceFlags: normalizeRoadSourceFlags(properties.source_flags),
    lengthMeters: normalizeNumber(properties.length_m, 0),
    n06MatchDistanceMeters: Number.isFinite(Number(properties.n06_match_distance_m))
      ? Number(properties.n06_match_distance_m)
      : null,
    geometry: rawFeature.geometry,
    projectedGeometry: projected.geometry,
    pathD: createPathD(projected.geometry),
    projectedLength: measureProjectedLength(projected.geometry),
    projectedLines,
  };
}

function createLabelFeature(rawFeature, roadFeatureById) {
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1]);
  if (!projected) return null;
  const roadId = String(properties.road_id || "").trim();
  const linkedRoad = roadFeatureById?.get(roadId) || null;
  return {
    id: String(properties.id || rawFeature.id || ""),
    roadId,
    ref: String(properties.ref || "").trim(),
    roadClass: String(properties.road_class || "").trim(),
    source: String(properties.source || "").trim(),
    priority: normalizeNumber(properties.priority, 0),
    x: projected.x,
    y: projected.y,
    projectedRoadLength: normalizeNumber(linkedRoad?.projectedLength, 0),
  };
}

async function loadJapanRoadPack(mode = PACK_MODE_PREVIEW, config = {}) {
  if (config?.activePackId) {
    lineRuntime.setActivePack(config.activePackId, resolveTransportManifestUrl(config.activePackId));
  }
  return lineRuntime.loadPack(mode, () => {
    if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
      emitSelectionChange();
    }
  });
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function handleRoadGroupClick(event) {
  const node = findDatasetNode(event.target, "roadId", groups.roadsGroup);
  const roadId = node?.dataset?.roadId;
  if (!roadId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "road", id: roadId };
  const selectedRoad = runtime.activePack?.roadFeatureById?.get(roadId) || null;
  renderRoadSelectedHighlight(groups, selectedRoad);
  emitSelectionChange();
}

function handleLabelGroupClick(event) {
  const node = findDatasetNode(event.target, "labelId", groups.labelsGroup);
  const labelId = node?.dataset?.labelId;
  if (!labelId) return;
  event.stopPropagation();
  const label = runtime.activePack?.labelFeatureById?.get(labelId) || null;
  if (!label) return;
  runtime.selectedFeature = { type: "label", id: label.id, roadId: label.roadId };
  const linkedRoad = runtime.activePack?.roadFeatureById?.get(label.roadId) || null;
  renderRoadSelectedHighlight(groups, linkedRoad);
  emitSelectionChange();
}

function emitSelectionChange() {
  lineRuntime.emitSelectionChange(buildSelectedSnapshot);
}

function buildSelectedSnapshot(config) {
  if (!runtime.selectedFeature || !runtime.activePack) return null;
  if (runtime.selectedFeature.type === "label") {
    const label = runtime.activePack.labelFeatureById.get(runtime.selectedFeature.id);
    if (!label) return null;
    const linkedRoad = runtime.activePack.roadFeatureById.get(label.roadId) || null;
    const hiddenReason = linkedRoad ? getRoadVisibilityReason(linkedRoad, config, getCurrentScale()) : null;
    return {
      type: "label",
      id: label.id,
      ref: label.ref,
      roadClass: label.roadClass,
      source: label.source,
      priority: label.priority,
      linkedRoadId: label.roadId,
      hiddenReason,
      visible: !hiddenReason,
    };
  }
  const road = runtime.activePack.roadFeatureById.get(runtime.selectedFeature.id);
  if (!road) return null;
  const hiddenReason = getRoadVisibilityReason(road, config, getCurrentScale());
  return {
    type: "road",
    id: road.id,
    name: road.name,
    ref: road.ref,
    officialName: road.officialName,
    officialRef: road.officialRef,
    roadClass: road.roadClass,
    source: road.source,
    sourceFlags: [...road.sourceFlags],
    n06MatchDistanceMeters: road.n06MatchDistanceMeters,
    visible: !hiddenReason,
    hiddenReason,
  };
}

function buildDataRows(config = runtime.lastRenderedConfig) {
  const pack = runtime.activePack || lineRuntime.pickActivePack();
  if (!pack?.roadFeatures) return [];
  const scale = getCurrentScale();
  return pack.roadFeatures
    .map((road) => {
      const hiddenReason = getRoadVisibilityReason(road, config || {}, scale);
      return {
        id: road.id,
        family: "road",
        kind: "road",
        name: road.name || road.officialName || road.ref || road.id,
        source: road.source || "",
        visible: !hiddenReason,
        hiddenReason,
        lengthMeters: road.lengthMeters,
        roadClass: road.roadClass,
        ref: road.ref,
        officialRef: road.officialRef,
        selected: runtime.selectedFeature?.type === "road"
          ? runtime.selectedFeature.id === road.id
          : runtime.selectedFeature?.roadId === road.id,
        properties: {
          ref: road.ref,
          official_name: road.officialName,
          official_ref: road.officialRef,
          road_class: road.roadClass,
          is_link: road.isLink,
          dense_metro: road.denseMetro,
          source_flags: [...(road.sourceFlags || [])],
          length_meters: road.lengthMeters,
          n06_match_distance_meters: road.n06MatchDistanceMeters,
        },
      };
    })
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      const classDelta = (ROAD_RENDER_PRIORITY[right.roadClass] || 0) - (ROAD_RENDER_PRIORITY[left.roadClass] || 0);
      if (classDelta !== 0) return classDelta;
      return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
    })
    .slice(0, DATA_ROW_LIMIT);
}

function pickActivePack() {
  return lineRuntime.pickActivePack();
}

function renderRoads(config) {
  const pack = pickActivePack();
  if (!pack || !ensureRoadGroups(groups, { onRoadClick: handleRoadGroupClick, onLabelClick: handleLabelGroupClick })) {
    return getJapanRoadPreviewSnapshot(config);
  }
  runtime.activePack = pack;
  runtime.activePackMode = pack.mode;
  runtime.lastRenderedConfig = config;
  const scale = getCurrentScale();
  const visibleRoads = pack.roadFeatures
    .filter((feature) => !getRoadVisibilityReason(feature, config, scale))
    .sort((left, right) => {
      const classDelta = (ROAD_RENDER_PRIORITY[left.roadClass] || 0) - (ROAD_RENDER_PRIORITY[right.roadClass] || 0);
      if (classDelta !== 0) return classDelta;
      return left.priority - right.priority;
    });
  const visibleRoadIds = new Set(visibleRoads.map((feature) => feature.id));
  const visibleLabels = filterVisibleRoadLabels(pack.labelFeatures, visibleRoadIds, config, scale);
  const selectedRoadId = runtime.selectedFeature?.type === "road"
    ? runtime.selectedFeature.id
    : (runtime.selectedFeature?.type === "label" ? runtime.selectedFeature.roadId : null);
  syncRoadNodes(groups, visibleRoads, config, selectedRoadId);
  syncRoadLabelNodes(groups, visibleLabels, config);
  runtime.renderStats = {
    visibleRoads: visibleRoads.length,
    visibleLabels: visibleLabels.length,
    totalRoads: pack.roadFeatures.length,
    totalLabels: pack.labelFeatures.length,
    filteredRoads: pack.roadFeatures.length - visibleRoads.length,
  };
  const selectedRoad = selectedRoadId
    ? pack.roadFeatureById.get(selectedRoadId) || null
    : null;
  renderRoadSelectedHighlight(groups, selectedRoad);
  return getJapanRoadPreviewSnapshot(config);
}

function startBackgroundFullPackLoad(options = {}) {
  lineRuntime.startBackgroundFullPackLoad({
    onAuditReady() {
      if (typeof options.isCurrent === "function" && !options.isCurrent()) return;
      if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated() {
      if (typeof options.isCurrent === "function" && !options.isCurrent()) return;
      if (!runtime.lastRenderedConfig || !groups.rootGroup) return;
      renderRoads(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
}

export function setJapanRoadPreviewSelectionListener(listener) {
  lineRuntime.setSelectionListener(listener);
}

export function selectJapanRoadPreviewFeature(selection) {
  const roadId = String(selection?.roadId || selection?.id || selection || "").trim();
  if (!roadId) return false;
  const pack = runtime.activePack || lineRuntime.pickActivePack();
  const road = pack?.roadFeatureById?.get(roadId) || null;
  if (!road) return false;
  runtime.selectedFeature = { type: "road", id: road.id };
  renderRoadSelectedHighlight(groups, road);
  emitSelectionChange();
  return true;
}

export async function renderJapanRoadPreview(config, options = {}) {
  const pending = loadJapanRoadPack(PACK_MODE_PREVIEW, config);
  const loadGeneration = runtime.loadGeneration;
  const pack = await pending;
  if (!pack || loadGeneration !== runtime.loadGeneration) return null;
  if (typeof options.isCurrent === "function" && !options.isCurrent()) {
    return null;
  }
  startBackgroundFullPackLoad(options);
  if (typeof options.isCurrent === "function" && !options.isCurrent()) {
    return null;
  }
  return renderRoads(config);
}

export async function warmJapanRoadPreviewPack({ includeFull = false } = {}) {
  if (runtime.lastRenderedConfig?.activePackId) {
    lineRuntime.setActivePack(runtime.lastRenderedConfig.activePackId, resolveTransportManifestUrl(runtime.lastRenderedConfig.activePackId));
  }
  await lineRuntime.warm({
    includeFull,
    onAuditReady() {
      if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated() {
      if (!runtime.lastRenderedConfig || !groups.rootGroup) return;
      renderRoads(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
  return getJapanRoadPreviewSnapshot(runtime.lastRenderedConfig);
}

export function clearJapanRoadPreview() {
  const totalRoads = runtime.activePack?.roadFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.roadFeatures?.length || 0;
  const totalLabels = runtime.activePack?.labelFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.labelFeatures?.length || 0;
  lineRuntime.release({ preserveSelection: true });
  runtime.lastRenderedConfig = null;
  runtime.activePack = null;
  runtime.activePackMode = null;
  clearRoadGroups(groups);
  runtime.renderStats = {
    visibleRoads: 0,
    visibleLabels: 0,
    totalRoads,
    totalLabels,
    filteredRoads: 0,
  };
}

export function destroyJapanRoadPreview() {
  const totalRoads = runtime.activePack?.roadFeatures?.length || runtime.projectedPacks[PACK_MODE_FULL]?.roadFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.roadFeatures?.length || 0;
  const totalLabels = runtime.activePack?.labelFeatures?.length || runtime.projectedPacks[PACK_MODE_FULL]?.labelFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.labelFeatures?.length || 0;
  lineRuntime.release();
  runtime.selectedFeature = null;
  runtime.lastRenderedConfig = null;
  runtime.activePack = null;
  runtime.activePackMode = null;
  runtime.renderStats = {
    visibleRoads: 0,
    visibleLabels: 0,
    totalRoads,
    totalLabels,
    filteredRoads: 0,
  };
  destroyRoadGroups(groups);
}

export function getJapanRoadPreviewSnapshot(config = runtime.lastRenderedConfig) {
  const snapshot = lineRuntime.getSnapshot(config ? buildSelectedSnapshot : null);
  const totalRows = (runtime.activePack || lineRuntime.pickActivePack())?.roadFeatures?.length || 0;
  return {
    ...snapshot,
    dataRows: buildDataRows(config),
    dataRowCount: totalRows,
    dataRowLimit: DATA_ROW_LIMIT,
  };
}
