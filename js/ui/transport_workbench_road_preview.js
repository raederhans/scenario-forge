import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierPoint,
  projectTransportWorkbenchCarrierScenePoint,
} from "./transport_workbench_carrier.js";
import {
  createTransportWorkbenchLinePackRuntime,
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
} from "./transport_workbench_line_runtime_shared.js";


const MANIFEST_URL = "data/transport_layers/japan_road/manifest.json";
const ROAD_STYLE_PRESETS = {
  corridor: {
    motorway: { stroke: "#cf5d35", width: 2.8 },
    trunk: { stroke: "#dd854d", width: 2.0 },
    primary: { stroke: "#be9762", width: 1.35 },
  },
  review: {
    motorway: { stroke: "#bf4f32", width: 3.0 },
    trunk: { stroke: "#cf7746", width: 2.15 },
    primary: { stroke: "#ab8348", width: 1.45 },
  },
  quiet: {
    motorway: { stroke: "#ae6a56", width: 2.5 },
    trunk: { stroke: "#bc8b68", width: 1.8 },
    primary: { stroke: "#9a8367", width: 1.25 },
  },
};
const LABEL_GRID_BY_DENSITY = {
  very_sparse: 208,
  sparse: 176,
  balanced: 144,
  dense: 116,
  very_dense: 92,
};
const PRIMARY_REVEAL_SCALE = {
  strict: 1.65,
  balanced: 1.38,
  loose: 1.18,
};
const PRIMARY_LABEL_REVEAL_SCALE = {
  strict: 1.34,
  balanced: 1.16,
  loose: 1.04,
};
const TRUNK_REVEAL_SCALE = {
  strict: 1.08,
  balanced: 1.0,
  loose: 1.0,
};
const TRUNK_LABEL_REVEAL_SCALE = {
  strict: 1.0,
  balanced: 0.96,
  loose: 0.92,
};
const METRO_GUARD_BONUS = {
  light: 0,
  balanced: 4,
  strict: 8,
};
const SELECTED_STROKE = "#12202d";
const CONFLICT_STROKE = "#a22f2a";
const ROAD_RENDER_PRIORITY = {
  primary: 1,
  trunk: 2,
  motorway: 3,
};

let rootGroup = null;
let labelRootGroup = null;
let roadsGroup = null;
let labelsGroup = null;
let selectedGroup = null;
let selectedHighlightNode = null;
let roadNodeById = new Map();
let labelNodeById = new Map();
const lineRuntime = createTransportWorkbenchLinePackRuntime({
  familyId: "road",
  familyLabel: "Japan road",
  manifestUrl: MANIFEST_URL,
  ensureClient: ensureTopojsonClient,
  initialRenderStats: {
    visibleRoads: 0,
    visibleLabels: 0,
    totalRoads: 0,
    totalLabels: 0,
    filteredRoads: 0,
  },
  async buildPack({ mode, manifest, fetchOptions, getPackPath }) {
    const roadsPath = getPackPath(manifest, mode, "roads");
    const labelsPath = getPackPath(manifest, mode, "road_labels");
    const roadsResponse = await fetch(roadsPath, fetchOptions);
    if (!roadsResponse.ok) {
      throw new Error(`Failed to load Japan road topology (${mode}): ${roadsResponse.status}`);
    }
    const labelsResponse = await fetch(labelsPath, fetchOptions);
    if (!labelsResponse.ok) {
      throw new Error(`Failed to load Japan road labels (${mode}): ${labelsResponse.status}`);
    }
    const roadsTopology = await roadsResponse.json();
    const labelsCollection = await labelsResponse.json();
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

function createSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function normalizeFlags(flags) {
  if (Array.isArray(flags)) return flags.filter(Boolean).map((value) => String(value));
  if (typeof flags === "string" && flags.trim()) {
    return flags.split("|").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function createPathD(geometry) {
  if (!geometry || typeof geometry !== "object") return "";
  if (geometry.type === "LineString") {
    const parts = geometry.coordinates || [];
    if (!parts.length) return "";
    return parts.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates || [])
      .map((line) => line.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" "))
      .join(" ");
  }
  return "";
}

function createPathDFromLine(line) {
  if (!Array.isArray(line) || !line.length) return "";
  return line.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
}

function measureProjectedLength(geometry) {
  if (!geometry || typeof geometry !== "object") return 0;
  const lines = geometry.type === "LineString" ? [geometry.coordinates || []] : (geometry.coordinates || []);
  let length = 0;
  lines.forEach((line) => {
    for (let index = 1; index < line.length; index += 1) {
      const [x0, y0] = line[index - 1];
      const [x1, y1] = line[index];
      length += Math.hypot(x1 - x0, y1 - y0);
    }
  });
  return length;
}

function buildProjectedLines(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const rawLines = geometry.type === "LineString"
    ? [geometry.coordinates || []]
    : (geometry.coordinates || []);
  return rawLines
    .filter((line) => Array.isArray(line) && line.length >= 2)
    .map((line) => {
      let length = 0;
      const segments = [];
      for (let index = 1; index < line.length; index += 1) {
        const start = line[index - 1];
        const end = line[index];
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const segmentLength = Math.hypot(dx, dy);
        segments.push({
          start,
          end,
          startDistance: length,
          length: segmentLength,
          angle: Math.atan2(dy, dx) * (180 / Math.PI),
        });
        length += segmentLength;
      }
      return {
        points: line,
        pathD: createPathDFromLine(line),
        length,
        segments,
      };
    })
    .filter((line) => line.length > 0);
}

function createRoadFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature.geometry, "main");
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
    sourceFlags: normalizeFlags(properties.source_flags),
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
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1], "main");
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

async function loadJapanRoadPack(mode = PACK_MODE_PREVIEW) {
  return lineRuntime.loadPack(mode, () => {
    if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
      emitSelectionChange();
    }
  });
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function getRoadVisibilityReason(feature, config, scale) {
  if (!config.roadClass?.includes(feature.roadClass)) return "class_filtered";
  if (config.excludeLinks && feature.isLink) return "link_filtered";
  if (feature.projectedLength < normalizeNumber(config.minProjectedSegmentPx, 6)) return "short_projected_segment";
  if (
    feature.roadClass === "primary"
    && config.suppressShortPrimarySegments
    && feature.lengthMeters < 6_500
  ) {
    return "short_primary";
  }
  if (
    feature.denseMetro
    && feature.roadClass === "primary"
    && feature.projectedLength < normalizeNumber(config.minProjectedSegmentPx, 6) + (METRO_GUARD_BONUS[config.denseMetroGuard] || 0)
  ) {
    return "dense_metro_guard";
  }
  if (feature.roadClass === "trunk" && scale < (TRUNK_REVEAL_SCALE[config.zoomGate] || 1)) {
    return "zoom_gate";
  }
  if (feature.roadClass === "primary" && scale < (PRIMARY_REVEAL_SCALE[config.zoomGate] || 1.38)) {
    return "zoom_gate";
  }
  return null;
}

function getRoadStyle(feature, config, selectedRoadId) {
  const preset = ROAD_STYLE_PRESETS[config.strokePreset] || ROAD_STYLE_PRESETS.corridor;
  const base = preset[feature.roadClass] || preset.primary;
  const configuredWidth = feature.roadClass === "motorway"
    ? normalizeNumber(config.motorwayWidth, base.width)
    : feature.roadClass === "trunk"
      ? normalizeNumber(config.trunkWidth, base.width)
      : normalizeNumber(config.primaryWidth, base.width);
  const isSelected = selectedRoadId && selectedRoadId === feature.id;
  const hasConflict = config.showSourceConflicts && feature.sourceFlags.includes("name_conflict");
  return {
    stroke: hasConflict ? CONFLICT_STROKE : base.stroke,
    width: isSelected ? configuredWidth + 1.1 : configuredWidth,
    opacity: isSelected && config.selectedEmphasis === "mute_others"
      ? 1
      : normalizeNumber(config.baseOpacity, 88) / 100,
  };
}

function getLabelClassGate(feature, config, scale) {
  if (!config.showRefs) return false;
  if (!config.refClasses?.includes(feature.roadClass)) return false;
  if (feature.roadClass === "primary" && !config.allowPrimaryRefsAtHighZoom) return false;
  if (!feature.ref || feature.projectedRoadLength < Math.max(28, String(feature.ref || "").length * 7)) return false;
  if (feature.roadClass === "primary" && scale < (PRIMARY_LABEL_REVEAL_SCALE[config.zoomGate] || 1.16)) return false;
  if (feature.roadClass === "trunk" && scale < (TRUNK_LABEL_REVEAL_SCALE[config.zoomGate] || 0.96)) return false;
  return true;
}

function filterVisibleLabels(labelFeatures, visibleRoadIds, config, scale) {
  const gridSize = LABEL_GRID_BY_DENSITY[config.labelDensityPreset] || LABEL_GRID_BY_DENSITY.balanced;
  const usedBuckets = new Set();
  return labelFeatures
    .filter((label) => visibleRoadIds.has(label.roadId))
    .filter((label) => getLabelClassGate(label, config, scale))
    .map((label) => ({
      ...label,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(label.x, label.y),
    }))
    .filter((label) => label.screenPoint)
    .sort((left, right) => right.priority - left.priority)
    .filter((label) => {
      const bucketKey = `${Math.round(label.screenPoint.x / gridSize)}:${Math.round(label.screenPoint.y / gridSize)}:${label.roadClass}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    });
}

function findDatasetNode(startNode, datasetKey, boundaryNode) {
  let current = startNode instanceof Element ? startNode : startNode?.parentElement;
  while (current && current !== boundaryNode) {
    if (current.dataset?.[datasetKey]) return current;
    current = current.parentElement;
  }
  if (boundaryNode?.dataset?.[datasetKey]) return boundaryNode;
  return null;
}

function handleRoadGroupClick(event) {
  const node = findDatasetNode(event.target, "roadId", roadsGroup);
  const roadId = node?.dataset?.roadId;
  if (!roadId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "road", id: roadId };
  const selectedRoad = runtime.activePack?.roadFeatureById?.get(roadId) || null;
  renderSelectedHighlight(selectedRoad);
  emitSelectionChange();
}

function handleLabelGroupClick(event) {
  const node = findDatasetNode(event.target, "labelId", labelsGroup);
  const labelId = node?.dataset?.labelId;
  if (!labelId) return;
  event.stopPropagation();
  const label = runtime.activePack?.labelFeatureById?.get(labelId) || null;
  if (!label) return;
  runtime.selectedFeature = { type: "label", id: label.id, roadId: label.roadId };
  const linkedRoad = runtime.activePack?.roadFeatureById?.get(label.roadId) || null;
  renderSelectedHighlight(linkedRoad);
  emitSelectionChange();
}

function ensureGroups() {
  const landRoot = getTransportWorkbenchCarrierOverlayRoots()?.land?.main;
  const labelRoot = getTransportWorkbenchCarrierOverlayRoots()?.labels?.main;
  if (!landRoot || !labelRoot) return null;
  if (rootGroup && rootGroup.parentNode === landRoot && labelRootGroup && labelRootGroup.parentNode === labelRoot) return rootGroup;
  rootGroup?.remove();
  labelRootGroup?.remove();
  roadNodeById = new Map();
  labelNodeById = new Map();
  rootGroup = createSvgNode("g");
  rootGroup.classList.add("transport-workbench-road-preview-root");
  labelRootGroup = createSvgNode("g");
  labelRootGroup.classList.add("transport-workbench-road-preview-label-root");
  roadsGroup = createSvgNode("g");
  roadsGroup.classList.add("transport-workbench-road-preview-roads");
  roadsGroup.addEventListener("click", handleRoadGroupClick);
  labelsGroup = createSvgNode("g");
  labelsGroup.classList.add("transport-workbench-road-preview-labels");
  labelsGroup.addEventListener("click", handleLabelGroupClick);
  selectedGroup = createSvgNode("g");
  selectedGroup.classList.add("transport-workbench-road-preview-selected");
  selectedHighlightNode = createSvgNode("path");
  selectedHighlightNode.setAttribute("fill", "none");
  selectedHighlightNode.setAttribute("stroke", SELECTED_STROKE);
  selectedHighlightNode.setAttribute("stroke-width", "2.2");
  selectedHighlightNode.setAttribute("opacity", "0.9");
  selectedHighlightNode.setAttribute("stroke-linecap", "round");
  selectedHighlightNode.setAttribute("stroke-linejoin", "round");
  selectedHighlightNode.setAttribute("vector-effect", "non-scaling-stroke");
  selectedHighlightNode.classList.add("transport-workbench-road-selected-highlight");
  selectedHighlightNode.style.display = "none";
  selectedGroup.appendChild(selectedHighlightNode);
  rootGroup.append(roadsGroup, selectedGroup);
  labelRootGroup.append(labelsGroup);
  landRoot.appendChild(rootGroup);
  labelRoot.appendChild(labelRootGroup);
  return rootGroup;
}

function clearGroups() {
  roadNodeById.forEach((node) => node.remove());
  labelNodeById.forEach((node) => node.remove());
  roadNodeById.clear();
  labelNodeById.clear();
  if (selectedHighlightNode) {
    selectedHighlightNode.removeAttribute("d");
    selectedHighlightNode.style.display = "none";
  }
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

function renderSelectedHighlight(selectedRoad) {
  if (!selectedHighlightNode) return;
  if (!selectedRoad) {
    selectedHighlightNode.removeAttribute("d");
    selectedHighlightNode.style.display = "none";
    return;
  }
  selectedHighlightNode.setAttribute("d", selectedRoad.pathD);
  selectedHighlightNode.style.display = "";
}

function updateRoadNode(path, feature, style) {
  path.setAttribute("d", feature.pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", style.stroke);
  path.setAttribute("stroke-width", String(style.width));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.setAttribute("opacity", String(style.opacity));
  path.dataset.roadId = feature.id;
  path.setAttribute("class", `transport-workbench-road-path road-class-${feature.roadClass}`);
}

function updateLabelNode(text, label, config) {
  const fontSize = label.roadClass === "motorway" ? 11 : 10;
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("x", String(label.screenPoint.x));
  text.setAttribute("y", String(label.screenPoint.y - 1.5));
  text.setAttribute("font-size", String(fontSize));
  text.setAttribute("font-weight", label.roadClass === "motorway" ? "700" : "600");
  text.setAttribute("fill", "#233141");
  text.setAttribute("stroke", "#f8f5f0");
  text.setAttribute("stroke-width", "2");
  text.setAttribute("paint-order", "stroke");
  text.setAttribute("opacity", String(normalizeNumber(config.refOpacity, 82) / 100));
  text.dataset.labelId = label.id;
  text.dataset.roadId = label.roadId;
  text.dataset.roadClass = label.roadClass;
  text.setAttribute("class", "transport-workbench-road-label");
  text.textContent = label.ref;
}

function syncGroupOrder(group, orderedNodes) {
  let previousNode = null;
  orderedNodes.forEach((node) => {
    if (!node.parentNode) {
      group.appendChild(node);
      previousNode = node;
      return;
    }
    if (!previousNode) {
      if (group.firstChild !== node) {
        group.insertBefore(node, group.firstChild);
      }
    } else if (previousNode.nextSibling !== node) {
      group.insertBefore(node, previousNode.nextSibling);
    }
    previousNode = node;
  });
}

function syncRoadNodes(visibleRoads, config, selectedRoadId) {
  const visibleIds = new Set();
  const orderedNodes = [];
  visibleRoads.forEach((feature) => {
    let path = roadNodeById.get(feature.id);
    if (!path) {
      path = createSvgNode("path");
      roadNodeById.set(feature.id, path);
    }
    updateRoadNode(path, feature, getRoadStyle(feature, config, selectedRoadId));
    orderedNodes.push(path);
    visibleIds.add(feature.id);
  });
  syncGroupOrder(roadsGroup, orderedNodes);
  Array.from(roadNodeById.entries()).forEach(([roadId, node]) => {
    if (visibleIds.has(roadId)) return;
    node.remove();
    roadNodeById.delete(roadId);
  });
}

function syncLabelNodes(visibleLabels, config) {
  const visibleIds = new Set();
  const orderedTextNodes = [];
  visibleLabels.forEach((label) => {
    let text = labelNodeById.get(label.id);
    if (!text) {
      text = createSvgNode("text");
      labelNodeById.set(label.id, text);
    }
    updateLabelNode(text, label, config);
    orderedTextNodes.push(text);
    visibleIds.add(label.id);
  });
  syncGroupOrder(labelsGroup, orderedTextNodes);
  Array.from(labelNodeById.entries()).forEach(([labelId, node]) => {
    if (visibleIds.has(labelId)) return;
    node.remove();
    labelNodeById.delete(labelId);
  });
}

function pickActivePack() {
  return lineRuntime.pickActivePack();
}

function renderRoads(config) {
  const pack = pickActivePack();
  if (!pack || !ensureGroups()) return getJapanRoadPreviewSnapshot(config);
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
  const visibleLabels = filterVisibleLabels(pack.labelFeatures, visibleRoadIds, config, scale);
  const selectedRoadId = runtime.selectedFeature?.type === "road"
    ? runtime.selectedFeature.id
    : (runtime.selectedFeature?.type === "label" ? runtime.selectedFeature.roadId : null);
  syncRoadNodes(visibleRoads, config, selectedRoadId);
  syncLabelNodes(visibleLabels, config);
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
  renderSelectedHighlight(selectedRoad);
  return getJapanRoadPreviewSnapshot(config);
}

function startBackgroundFullPackLoad() {
  lineRuntime.startBackgroundFullPackLoad({
    onAuditReady() {
      if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated() {
      if (!runtime.lastRenderedConfig || !rootGroup) return;
      renderRoads(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
}

export function setJapanRoadPreviewSelectionListener(listener) {
  lineRuntime.setSelectionListener(listener);
}

export async function renderJapanRoadPreview(config) {
  await loadJapanRoadPack(PACK_MODE_PREVIEW);
  startBackgroundFullPackLoad();
  return renderRoads(config);
}

export async function warmJapanRoadPreviewPack({ includeFull = false } = {}) {
  await lineRuntime.warm({
    includeFull,
    onAuditReady() {
      if (runtime.loadState.status === "ready" && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated() {
      if (!runtime.lastRenderedConfig || !rootGroup) return;
      renderRoads(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
  return getJapanRoadPreviewSnapshot(runtime.lastRenderedConfig);
}

export function clearJapanRoadPreview() {
  const totalRoads = runtime.activePack?.roadFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.roadFeatures?.length || 0;
  const totalLabels = runtime.activePack?.labelFeatures?.length || runtime.projectedPacks[PACK_MODE_PREVIEW]?.labelFeatures?.length || 0;
  runtime.lastRenderedConfig = null;
  runtime.activePack = null;
  runtime.activePackMode = null;
  clearGroups();
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
  rootGroup?.remove();
  labelRootGroup?.remove();
  rootGroup = null;
  labelRootGroup = null;
  roadsGroup = null;
  labelsGroup = null;
  selectedGroup = null;
  selectedHighlightNode = null;
  roadNodeById.clear();
  labelNodeById.clear();
}

export function getJapanRoadPreviewSnapshot(config = runtime.lastRenderedConfig) {
  return lineRuntime.getSnapshot(config ? buildSelectedSnapshot : null);
}
