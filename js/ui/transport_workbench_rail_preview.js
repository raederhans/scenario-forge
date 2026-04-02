import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";
import {
  createTransportWorkbenchLinePackRuntime,
  PACK_MODE_FULL,
  PACK_MODE_PREVIEW,
} from "./transport_workbench_line_runtime_shared.js";

const MANIFEST_URL = "data/transport_layers/japan_rail/manifest.json";
const LINE_CLASS_PRIORITY = {
  service: 1,
  branch: 2,
  trunk: 3,
  high_speed: 4,
};
const LINE_CLASS_STYLE = {
  high_speed: { stroke: "#0f766e", width: 3.2, opacityMultiplier: 1.0 },
  trunk: { stroke: "#1f2937", width: 2.35, opacityMultiplier: 0.96 },
  branch: { stroke: "#85644a", width: 1.45, opacityMultiplier: 0.82 },
  service: { stroke: "#94a3b8", width: 1.05, opacityMultiplier: 0.62 },
};
const STATION_STYLE = {
  dot_ring: { radius: 4.2, fill: "#f8fafc", stroke: "#1f2937", strokeWidth: 1.2 },
  solid_dot: { radius: 4.6, fill: "#1f2937", stroke: "#f8fafc", strokeWidth: 1.0 },
  quiet_square: { radius: 4.0, fill: "#e5e7eb", stroke: "#4b5563", strokeWidth: 1.0, square: true },
};
const IMPORTANCE_ORDER = {
  broad_major: 1,
  regional_core: 2,
  capital_core: 3,
};
const STATION_IMPORTANCE_STYLE = {
  broad_major: { sizeMultiplier: 0.92, labelScale: 0.95, minLabelScale: 1.22 },
  regional_core: { sizeMultiplier: 1.0, labelScale: 1.0, minLabelScale: 1.14 },
  capital_core: { sizeMultiplier: 1.22, labelScale: 1.12, minLabelScale: 1.06 },
};
const INACTIVE_STATUS = new Set(["disused", "abandoned", "construction"]);
const SELECTED_LINE_STROKE = "#0f172a";
const SELECTED_STATION_STROKE = "#0f172a";

let rootGroup = null;
let labelRootGroup = null;
let linesGroup = null;
let lineLabelsGroup = null;
let stationsGroup = null;
let stationLabelsGroup = null;
let selectedGroup = null;
let selectedLineHighlightNode = null;
let selectedStationHighlightNode = null;
let lineNodeById = new Map();
let lineLabelNodeById = new Map();
let stationNodeById = new Map();
let stationLabelNodeById = new Map();
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
  async buildPack({ mode, manifest, fetchOptions, getPackPath }) {
    const railwaysPath = getPackPath(manifest, mode, "railways");
    const stationsPath = getPackPath(manifest, mode, "rail_stations_major");
    const railwaysResponse = await fetch(railwaysPath, fetchOptions);
    if (!railwaysResponse.ok) {
      throw new Error(`Failed to load Japan rail topology (${mode}): ${railwaysResponse.status}`);
    }
    const stationsResponse = await fetch(stationsPath, fetchOptions);
    if (!stationsResponse.ok) {
      throw new Error(`Failed to load Japan rail stations (${mode}): ${stationsResponse.status}`);
    }
    const railwaysTopology = await railwaysResponse.json();
    const stationsCollection = await stationsResponse.json();
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

function normalizeLineClass(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LINE_CLASS_PRIORITY[normalized] ? normalized : "trunk";
}

function normalizeLineStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "active";
}

function normalizeImportance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return IMPORTANCE_ORDER[normalized] ? normalized : "broad_major";
}

function createRailFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature.geometry, "main");
  if (!projected?.geometry) return null;
  const name = String(properties.name || properties.line_name || "").trim();
  return {
    id: String(properties.id || rawFeature.id || name || ""),
    name,
    operator: String(properties.operator || properties.company || "").trim(),
    railTypeCode: String(properties.rail_type_code || "").trim(),
    operatorTypeCode: String(properties.operator_type_code || "").trim(),
    status: normalizeLineStatus(properties.status),
    lineClass: normalizeLineClass(properties.class || properties.line_class),
    source: String(properties.source || "").trim(),
    sourceFlags: normalizeFlags(properties.source_flags),
    lengthMeters: normalizeNumber(properties.length_m, 0),
    pathD: createPathD(projected.geometry),
    projectedLength: measureProjectedLength(projected.geometry),
  };
}

function createStationFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1], "main");
  if (!projected) return null;
  return {
    id: String(properties.id || rawFeature.id || properties.name || ""),
    name: String(properties.name || "").trim(),
    cityKey: String(properties.city_key || "").trim(),
    stationCode: String(properties.station_code || "").trim(),
    groupCode: String(properties.group_code || "").trim(),
    importance: normalizeImportance(properties.importance),
    source: String(properties.source || "").trim(),
    linkedLineClasses: normalizeFlags(properties.linked_line_classes).map((value) => normalizeLineClass(value)),
    x: projected.x,
    y: projected.y,
  };
}

async function loadJapanRailPack(mode = PACK_MODE_PREVIEW) {
  return lineRuntime.loadPack(mode, () => {
    if ((runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
      emitSelectionChange();
    }
  });
}

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

function getLineVisibilityReason(feature, config, scale) {
  if (!config.status?.includes(feature.status)) return "status_filtered";
  if (!config.class?.includes(feature.lineClass)) return "class_filtered";
  if (feature.lineClass === "branch" && !config.showBranchAtCurrentZoom) return "branch_hidden";
  if (feature.lineClass === "branch" && scale < 1.06) return "zoom_gate";
  if (feature.lineClass === "service" && !config.showServiceLines) return "service_hidden";
  if (feature.lineClass === "service" && config.showServiceAtHighZoomOnly && scale < 1.45) return "zoom_gate";
  if (INACTIVE_STATUS.has(feature.status) && scale < 1.3) return "zoom_gate";
  return null;
}

function getImportanceRank(feature) {
  return IMPORTANCE_ORDER[feature?.importance] || 1;
}

function getImportanceThreshold(config) {
  return IMPORTANCE_ORDER[config?.importanceThreshold] || 1;
}

function getLineOpacity(feature, config) {
  const baseOpacity = normalizeNumber(config.lineOpacity, 92) / 100;
  const classMultiplier = (LINE_CLASS_STYLE[feature.lineClass] || LINE_CLASS_STYLE.trunk).opacityMultiplier || 1;
  if (!INACTIVE_STATUS.has(feature.status)) return Math.max(0.2, baseOpacity * classMultiplier);
  const fadeStrength = normalizeNumber(config.inactiveFadeStrength, 72) / 100;
  return Math.max(0.1, baseOpacity * classMultiplier * (1 - fadeStrength));
}

function getLineStyle(feature, config, selectedLineId) {
  const base = LINE_CLASS_STYLE[feature.lineClass] || LINE_CLASS_STYLE.trunk;
  const isSelected = selectedLineId && selectedLineId === feature.id;
  let stroke = base.stroke;
  if (config.statusEncoding === "line_style_plus_hue" && feature.status === "construction") {
    stroke = "#b45309";
  } else if (config.statusEncoding === "line_style_plus_hue" && feature.status === "abandoned") {
    stroke = "#7c3aed";
  }
  return {
    stroke,
    width: isSelected ? base.width + 1.1 : base.width,
    opacity: getLineOpacity(feature, config),
  };
}

function getStationImportanceStyle(feature) {
  return STATION_IMPORTANCE_STYLE[feature?.importance] || STATION_IMPORTANCE_STYLE.broad_major;
}

function shouldShowStation(feature, config, scale) {
  if (!config.showMajorStations) return false;
  if (getImportanceRank(feature) < getImportanceThreshold(config)) return false;
  return scale >= 0.98;
}

function shouldShowStationLabel(feature, config, scale) {
  if (!config.showStationLabels) return false;
  return shouldShowStation(feature, config, scale) && scale >= getStationImportanceStyle(feature).minLabelScale;
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

function handleLineGroupClick(event) {
  const node = findDatasetNode(event.target, "railLineId", linesGroup);
  const lineId = node?.dataset?.railLineId;
  if (!lineId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "line", id: lineId };
  renderSelectedHighlight(runtime.activePack?.lineFeatureById?.get(lineId) || null, null);
  emitSelectionChange();
}

function handleStationGroupClick(event) {
  const node = findDatasetNode(event.target, "railStationId", stationsGroup);
  const stationId = node?.dataset?.railStationId;
  if (!stationId) return;
  event.stopPropagation();
  runtime.selectedFeature = { type: "station", id: stationId };
  renderSelectedHighlight(null, runtime.activePack?.stationFeatureById?.get(stationId) || null);
  emitSelectionChange();
}

function ensureGroups() {
  const landRoot = getTransportWorkbenchCarrierOverlayRoots()?.land?.main;
  const labelRoot = getTransportWorkbenchCarrierOverlayRoots()?.labels?.main;
  if (!landRoot || !labelRoot) return null;
  if (rootGroup && rootGroup.parentNode === landRoot && labelRootGroup && labelRootGroup.parentNode === labelRoot) {
    return rootGroup;
  }
  rootGroup?.remove();
  labelRootGroup?.remove();
  lineNodeById = new Map();
  lineLabelNodeById = new Map();
  stationNodeById = new Map();
  stationLabelNodeById = new Map();

  rootGroup = createSvgNode("g");
  rootGroup.classList.add("transport-workbench-rail-preview-root");
  linesGroup = createSvgNode("g");
  linesGroup.classList.add("transport-workbench-rail-preview-lines");
  linesGroup.addEventListener("click", handleLineGroupClick);
  stationsGroup = createSvgNode("g");
  stationsGroup.classList.add("transport-workbench-rail-preview-stations");
  stationsGroup.addEventListener("click", handleStationGroupClick);
  selectedGroup = createSvgNode("g");
  selectedGroup.classList.add("transport-workbench-rail-preview-selected");

  selectedLineHighlightNode = createSvgNode("path");
  selectedLineHighlightNode.setAttribute("fill", "none");
  selectedLineHighlightNode.setAttribute("stroke", SELECTED_LINE_STROKE);
  selectedLineHighlightNode.setAttribute("stroke-width", "2.5");
  selectedLineHighlightNode.setAttribute("opacity", "0.88");
  selectedLineHighlightNode.setAttribute("stroke-linecap", "round");
  selectedLineHighlightNode.setAttribute("stroke-linejoin", "round");
  selectedLineHighlightNode.setAttribute("vector-effect", "non-scaling-stroke");
  selectedLineHighlightNode.style.display = "none";

  selectedStationHighlightNode = createSvgNode("circle");
  selectedStationHighlightNode.setAttribute("fill", "none");
  selectedStationHighlightNode.setAttribute("stroke", SELECTED_STATION_STROKE);
  selectedStationHighlightNode.setAttribute("stroke-width", "2");
  selectedStationHighlightNode.setAttribute("opacity", "0.88");
  selectedStationHighlightNode.style.display = "none";

  selectedGroup.append(selectedLineHighlightNode, selectedStationHighlightNode);
  rootGroup.append(linesGroup, stationsGroup, selectedGroup);

  labelRootGroup = createSvgNode("g");
  labelRootGroup.classList.add("transport-workbench-rail-preview-label-root");
  lineLabelsGroup = createSvgNode("g");
  lineLabelsGroup.classList.add("transport-workbench-rail-preview-line-labels");
  stationLabelsGroup = createSvgNode("g");
  stationLabelsGroup.classList.add("transport-workbench-rail-preview-station-labels");
  labelRootGroup.append(lineLabelsGroup, stationLabelsGroup);

  landRoot.appendChild(rootGroup);
  labelRoot.appendChild(labelRootGroup);
  return rootGroup;
}

function clearGroups() {
  lineNodeById.forEach((node) => node.remove());
  lineLabelNodeById.forEach((node) => node.remove());
  stationNodeById.forEach((node) => node.remove());
  stationLabelNodeById.forEach((node) => node.remove());
  lineNodeById.clear();
  lineLabelNodeById.clear();
  stationNodeById.clear();
  stationLabelNodeById.clear();
  if (selectedLineHighlightNode) {
    selectedLineHighlightNode.removeAttribute("d");
    selectedLineHighlightNode.style.display = "none";
  }
  if (selectedStationHighlightNode) {
    selectedStationHighlightNode.style.display = "none";
  }
}

function emitSelectionChange() {
  lineRuntime.emitSelectionChange(buildSelectedSnapshot);
}

function formatLineVisibilityReason(reason) {
  const map = {
    status_filtered: "Filtered by status",
    class_filtered: "Filtered by class",
    branch_hidden: "Branch hidden",
    service_hidden: "Service hidden",
    zoom_gate: "Hidden by zoom gate",
  };
  return map[String(reason || "").trim()] || "Visible";
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

function renderSelectedHighlight(selectedLine, selectedStation) {
  if (selectedLineHighlightNode) {
    if (selectedLine) {
      selectedLineHighlightNode.setAttribute("d", selectedLine.pathD);
      selectedLineHighlightNode.style.display = "";
    } else {
      selectedLineHighlightNode.removeAttribute("d");
      selectedLineHighlightNode.style.display = "none";
    }
  }
  if (selectedStationHighlightNode) {
    if (selectedStation) {
      const selectedPreset = STATION_STYLE[runtime.lastRenderedConfig?.stationSymbolPreset] || STATION_STYLE.dot_ring;
      const selectedRadius = selectedPreset.radius * getStationImportanceStyle(selectedStation).sizeMultiplier;
      selectedStationHighlightNode.setAttribute("cx", String(selectedStation.x));
      selectedStationHighlightNode.setAttribute("cy", String(selectedStation.y));
      selectedStationHighlightNode.setAttribute("r", String(selectedRadius + 3));
      selectedStationHighlightNode.style.display = "";
    } else {
      selectedStationHighlightNode.style.display = "none";
    }
  }
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

function syncLineNodes(visibleLines, config, selectedLineId) {
  const visibleIds = new Set();
  const orderedNodes = [];
  visibleLines.forEach((feature) => {
    let path = lineNodeById.get(feature.id);
    if (!path) {
      path = createSvgNode("path");
      lineNodeById.set(feature.id, path);
    }
    const style = getLineStyle(feature, config, selectedLineId);
    path.setAttribute("d", feature.pathD);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", style.stroke);
    path.setAttribute("stroke-width", String(style.width));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.setAttribute("opacity", String(style.opacity));
    path.dataset.railLineId = feature.id;
    path.setAttribute("class", `transport-workbench-rail-line rail-class-${feature.lineClass}`);
    orderedNodes.push(path);
    visibleIds.add(feature.id);
  });
  syncGroupOrder(linesGroup, orderedNodes);
  Array.from(lineNodeById.entries()).forEach(([lineId, node]) => {
    if (visibleIds.has(lineId)) return;
    node.remove();
    lineNodeById.delete(lineId);
  });
}

function updateStationNode(node, feature, config, isSelected) {
  const preset = STATION_STYLE[config.stationSymbolPreset] || STATION_STYLE.dot_ring;
  const importanceStyle = getStationImportanceStyle(feature);
  const baseRadius = preset.radius * importanceStyle.sizeMultiplier;
  const radius = isSelected ? baseRadius + 1.35 : baseRadius;
  if (preset.square) {
    node.setAttribute("x", String(feature.x - radius));
    node.setAttribute("y", String(feature.y - radius));
    node.setAttribute("width", String(radius * 2));
    node.setAttribute("height", String(radius * 2));
    node.setAttribute("rx", "1.2");
    node.setAttribute("ry", "1.2");
  } else {
    node.setAttribute("cx", String(feature.x));
    node.setAttribute("cy", String(feature.y));
    node.setAttribute("r", String(radius));
  }
  node.setAttribute("fill", preset.fill);
  node.setAttribute("stroke", preset.stroke);
  node.setAttribute("stroke-width", String(preset.strokeWidth));
  node.setAttribute("opacity", String(normalizeNumber(config.stationOpacity, 86) / 100));
  node.dataset.railStationId = feature.id;
  node.setAttribute("class", `transport-workbench-rail-station importance-${feature.importance}`);
}

function syncStationNodes(visibleStations, config, selectedStationId, scale) {
  const visibleIds = new Set();
  const visibleLabelIds = new Set();
  const orderedNodes = [];
  const orderedLabels = [];
  visibleStations.forEach((feature) => {
    const preset = STATION_STYLE[config.stationSymbolPreset] || STATION_STYLE.dot_ring;
    let node = stationNodeById.get(feature.id);
    const expectedTagName = preset.square ? "rect" : "circle";
    if (node && node.tagName.toLowerCase() !== expectedTagName) {
      node.remove();
      stationNodeById.delete(feature.id);
      node = null;
    }
    if (!node) {
      node = createSvgNode(expectedTagName);
      stationNodeById.set(feature.id, node);
    }
    updateStationNode(node, feature, config, selectedStationId === feature.id);
    orderedNodes.push(node);
    visibleIds.add(feature.id);

    if (shouldShowStationLabel(feature, config, scale)) {
      const importanceStyle = getStationImportanceStyle(feature);
      const fontSize = 10 * importanceStyle.labelScale;
      const textOffsetX = 7 + Math.max(0, fontSize - 10);
      const textOffsetY = 6 + Math.max(0, fontSize - 10) * 0.35;
      let text = stationLabelNodeById.get(feature.id);
      if (!text) {
        text = createSvgNode("text");
        stationLabelNodeById.set(feature.id, text);
      }
      text.textContent = feature.name || "";
      text.setAttribute("x", String(feature.x + textOffsetX));
      text.setAttribute("y", String(feature.y - textOffsetY));
      text.setAttribute("font-size", String(fontSize));
      text.setAttribute("font-weight", feature.importance === "capital_core" ? "700" : "600");
      text.setAttribute("fill", feature.importance === "capital_core" ? "#111827" : "#1f2937");
      text.setAttribute("stroke", "rgba(248, 250, 252, 0.96)");
      text.setAttribute("stroke-width", String(feature.importance === "capital_core" ? 2.6 : 2.2));
      text.setAttribute("paint-order", "stroke");
      text.setAttribute("opacity", String(normalizeNumber(config.stationOpacity, 86) / 100));
      text.dataset.railStationId = feature.id;
      text.setAttribute("class", "transport-workbench-rail-station-label");
      orderedLabels.push(text);
      visibleLabelIds.add(feature.id);
    }
  });
  syncGroupOrder(stationsGroup, orderedNodes);
  syncGroupOrder(stationLabelsGroup, orderedLabels);
  Array.from(stationNodeById.entries()).forEach(([stationId, node]) => {
    if (visibleIds.has(stationId)) return;
    node.remove();
    stationNodeById.delete(stationId);
  });
  Array.from(stationLabelNodeById.entries()).forEach(([stationId, node]) => {
    if (visibleLabelIds.has(stationId)) return;
    node.remove();
    stationLabelNodeById.delete(stationId);
  });
}

function pickActivePack() {
  return lineRuntime.pickActivePack();
}

function renderRail(config) {
  const pack = pickActivePack();
  if (!pack || !ensureGroups()) {
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
  const selectedLineId = runtime.selectedFeature?.type === "line" ? runtime.selectedFeature.id : null;
  const selectedStationId = runtime.selectedFeature?.type === "station" ? runtime.selectedFeature.id : null;
  syncLineNodes(visibleLines, config, selectedLineId);
  syncStationNodes(visibleStations, config, selectedStationId, scale);
  runtime.renderStats = {
    visibleLines: visibleLines.length,
    visibleStations: visibleStations.length,
    visibleLineLabels: 0,
    visibleStationLabels: stationLabelNodeById.size,
    totalLines: pack.lineFeatures.length,
    totalStations: pack.stationFeatures.length,
    filteredLines: pack.lineFeatures.length - visibleLines.length,
  };
  renderSelectedHighlight(
    selectedLineId ? pack.lineFeatureById.get(selectedLineId) || null : null,
    selectedStationId ? pack.stationFeatureById.get(selectedStationId) || null : null,
  );
  return getJapanRailPreviewSnapshot(config);
}

function startBackgroundFullPackLoad() {
  lineRuntime.startBackgroundFullPackLoad({
    onAuditReady() {
      if ((runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated(pack) {
      if (!pack || !runtime.lastRenderedConfig || !rootGroup) return;
      renderRail(runtime.lastRenderedConfig);
      emitSelectionChange();
    },
  });
}

export function setJapanRailPreviewSelectionListener(listener) {
  lineRuntime.setSelectionListener(listener);
}

export async function renderJapanRailPreview(config) {
  await loadJapanRailPack(PACK_MODE_PREVIEW);
  if (runtime.loadState.status === "ready") {
    startBackgroundFullPackLoad();
  }
  return renderRail(config);
}

export async function warmJapanRailPreviewPack({ includeFull = false } = {}) {
  await lineRuntime.warm({
    includeFull,
    onAuditReady() {
      if ((runtime.loadState.status === "ready" || runtime.loadState.status === "pending") && runtime.lastRenderedConfig) {
        emitSelectionChange();
      }
    },
    onHydrated(pack) {
      if (!pack || !runtime.lastRenderedConfig || !rootGroup) return;
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
  clearGroups();
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
  rootGroup?.remove();
  labelRootGroup?.remove();
  rootGroup = null;
  labelRootGroup = null;
  linesGroup = null;
  lineLabelsGroup = null;
  stationsGroup = null;
  stationLabelsGroup = null;
  selectedGroup = null;
  selectedLineHighlightNode = null;
  selectedStationHighlightNode = null;
  lineNodeById.clear();
  lineLabelNodeById.clear();
  stationNodeById.clear();
  stationLabelNodeById.clear();
}

export function getJapanRailPreviewSnapshot(config = runtime.lastRenderedConfig) {
  return lineRuntime.getSnapshot(config ? buildSelectedSnapshot : null);
}

export function formatJapanRailVisibilityReason(reason) {
  return formatLineVisibilityReason(reason);
}
