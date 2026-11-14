import {
  getTransportWorkbenchCarrierOverlayRoots,
  projectTransportWorkbenchCarrierScenePoint,
} from "./transport_workbench_carrier.js";
import {
  createTransportWorkbenchSvgNode as createSvgNode,
  keepFirstTransportWorkbenchGridBucket as keepFirstPerGridBucket,
  normalizeTransportWorkbenchNumber as normalizeNumber,
  syncTransportWorkbenchSvgGroupOrder as syncGroupOrder,
} from "./transport_workbench_line_runtime_shared.js";
import {
  getImportanceRank,
  getLineStyle,
  getStationImportanceStyle,
  shouldShowStationLabel,
} from "./transport_workbench_rail_preview_runtime.js";

// DOM rendering layer for the Japan rail workbench preview. Owns SVG group
// lifecycle for both lines and stations, node sync, station-label projection and
// the line/station selection highlights. State lives on a `groups` object created
// by createRailPreviewGroups() and passed in, mirroring the point/road preview
// pattern. Pure decision logic is in transport_workbench_rail_preview_runtime.js.

const STATION_STYLE = {
  dot_ring: { radius: 4.2, fill: "#f8fafc", stroke: "#1f2937", strokeWidth: 1.2 },
  solid_dot: { radius: 4.6, fill: "#1f2937", stroke: "#f8fafc", strokeWidth: 1.0 },
  quiet_square: { radius: 4.0, fill: "#e5e7eb", stroke: "#4b5563", strokeWidth: 1.0, square: true },
};
const STATION_LABEL_GRID_BY_DENSITY = {
  very_sparse: 208,
  sparse: 176,
  balanced: 144,
  dense: 118,
  very_dense: 94,
};
const SELECTED_LINE_STROKE = "#0f172a";
const SELECTED_STATION_STROKE = "#0f172a";

export function createRailPreviewGroups() {
  return {
    rootGroup: null,
    labelRootGroup: null,
    linesGroup: null,
    lineLabelsGroup: null,
    stationsGroup: null,
    stationLabelsGroup: null,
    selectedGroup: null,
    selectedLineHighlightNode: null,
    selectedStationHighlightNode: null,
    lineNodeById: new Map(),
    lineLabelNodeById: new Map(),
    stationNodeById: new Map(),
    stationLabelNodeById: new Map(),
  };
}

export function ensureRailGroups(groups, { onLineClick, onStationClick }) {
  const landRoot = getTransportWorkbenchCarrierOverlayRoots()?.land?.main;
  const labelRoot = getTransportWorkbenchCarrierOverlayRoots()?.labels?.main;
  if (!landRoot || !labelRoot) return null;
  if (
    groups.rootGroup && groups.rootGroup.parentNode === landRoot
    && groups.labelRootGroup && groups.labelRootGroup.parentNode === labelRoot
  ) {
    return groups.rootGroup;
  }
  groups.rootGroup?.remove();
  groups.labelRootGroup?.remove();
  groups.lineNodeById = new Map();
  groups.lineLabelNodeById = new Map();
  groups.stationNodeById = new Map();
  groups.stationLabelNodeById = new Map();

  groups.rootGroup = createSvgNode("g");
  groups.rootGroup.classList.add("transport-workbench-rail-preview-root");
  groups.linesGroup = createSvgNode("g");
  groups.linesGroup.classList.add("transport-workbench-rail-preview-lines");
  groups.linesGroup.addEventListener("click", onLineClick);
  groups.stationsGroup = createSvgNode("g");
  groups.stationsGroup.classList.add("transport-workbench-rail-preview-stations");
  groups.stationsGroup.addEventListener("click", onStationClick);
  groups.selectedGroup = createSvgNode("g");
  groups.selectedGroup.classList.add("transport-workbench-rail-preview-selected");

  groups.selectedLineHighlightNode = createSvgNode("path");
  groups.selectedLineHighlightNode.setAttribute("fill", "none");
  groups.selectedLineHighlightNode.setAttribute("stroke", SELECTED_LINE_STROKE);
  groups.selectedLineHighlightNode.setAttribute("stroke-width", "2.5");
  groups.selectedLineHighlightNode.setAttribute("opacity", "0.88");
  groups.selectedLineHighlightNode.setAttribute("stroke-linecap", "round");
  groups.selectedLineHighlightNode.setAttribute("stroke-linejoin", "round");
  groups.selectedLineHighlightNode.setAttribute("vector-effect", "non-scaling-stroke");
  groups.selectedLineHighlightNode.style.display = "none";

  groups.selectedStationHighlightNode = createSvgNode("circle");
  groups.selectedStationHighlightNode.setAttribute("fill", "none");
  groups.selectedStationHighlightNode.setAttribute("stroke", SELECTED_STATION_STROKE);
  groups.selectedStationHighlightNode.setAttribute("stroke-width", "2");
  groups.selectedStationHighlightNode.setAttribute("opacity", "0.88");
  groups.selectedStationHighlightNode.style.display = "none";

  groups.selectedGroup.append(groups.selectedLineHighlightNode, groups.selectedStationHighlightNode);
  groups.rootGroup.append(groups.linesGroup, groups.stationsGroup, groups.selectedGroup);

  groups.labelRootGroup = createSvgNode("g");
  groups.labelRootGroup.classList.add("transport-workbench-rail-preview-label-root");
  groups.lineLabelsGroup = createSvgNode("g");
  groups.lineLabelsGroup.classList.add("transport-workbench-rail-preview-line-labels");
  groups.stationLabelsGroup = createSvgNode("g");
  groups.stationLabelsGroup.classList.add("transport-workbench-rail-preview-station-labels");
  groups.labelRootGroup.append(groups.lineLabelsGroup, groups.stationLabelsGroup);

  landRoot.appendChild(groups.rootGroup);
  labelRoot.appendChild(groups.labelRootGroup);
  return groups.rootGroup;
}

export function clearRailGroups(groups) {
  groups.lineNodeById.forEach((node) => node.remove());
  groups.lineLabelNodeById.forEach((node) => node.remove());
  groups.stationNodeById.forEach((node) => node.remove());
  groups.stationLabelNodeById.forEach((node) => node.remove());
  groups.lineNodeById.clear();
  groups.lineLabelNodeById.clear();
  groups.stationNodeById.clear();
  groups.stationLabelNodeById.clear();
  if (groups.selectedLineHighlightNode) {
    groups.selectedLineHighlightNode.removeAttribute("d");
    groups.selectedLineHighlightNode.style.display = "none";
  }
  if (groups.selectedStationHighlightNode) {
    groups.selectedStationHighlightNode.style.display = "none";
  }
}

export function destroyRailGroups(groups) {
  groups.rootGroup?.remove();
  groups.labelRootGroup?.remove();
  groups.rootGroup = null;
  groups.labelRootGroup = null;
  groups.linesGroup = null;
  groups.lineLabelsGroup = null;
  groups.stationsGroup = null;
  groups.stationLabelsGroup = null;
  groups.selectedGroup = null;
  groups.selectedLineHighlightNode = null;
  groups.selectedStationHighlightNode = null;
  groups.lineNodeById.clear();
  groups.lineLabelNodeById.clear();
  groups.stationNodeById.clear();
  groups.stationLabelNodeById.clear();
}

function getStationLabelDensityGridSize(config) {
  return STATION_LABEL_GRID_BY_DENSITY[String(config?.labelDensityPreset || "").trim()] || STATION_LABEL_GRID_BY_DENSITY.balanced;
}

export function buildVisibleRailStationLabelEntries(visibleStations, config, scale) {
  const gridSize = getStationLabelDensityGridSize(config);
  const rankedEntries = visibleStations
    .filter((feature) => shouldShowStationLabel(feature, config, scale))
    .map((feature) => ({
      feature,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(feature.x, feature.y),
    }))
    .filter((entry) => entry.screenPoint)
    .sort((left, right) => {
      const importanceDelta = getImportanceRank(right.feature) - getImportanceRank(left.feature);
      if (importanceDelta !== 0) return importanceDelta;
      return String(left.feature.name || left.feature.id).localeCompare(String(right.feature.name || right.feature.id), "ja");
    });
  return keepFirstPerGridBucket(rankedEntries, {
    gridSize,
    getScreenPoint: (entry) => entry.screenPoint,
  });
}

export function renderRailSelectedHighlight(groups, selectedLine, selectedStation, config) {
  if (groups.selectedLineHighlightNode) {
    if (selectedLine) {
      groups.selectedLineHighlightNode.setAttribute("d", selectedLine.pathD);
      groups.selectedLineHighlightNode.style.display = "";
    } else {
      groups.selectedLineHighlightNode.removeAttribute("d");
      groups.selectedLineHighlightNode.style.display = "none";
    }
  }
  if (groups.selectedStationHighlightNode) {
    if (selectedStation) {
      const selectedPreset = STATION_STYLE[config?.stationSymbolPreset] || STATION_STYLE.dot_ring;
      const selectedRadius = selectedPreset.radius * getStationImportanceStyle(selectedStation).sizeMultiplier;
      groups.selectedStationHighlightNode.setAttribute("cx", String(selectedStation.x));
      groups.selectedStationHighlightNode.setAttribute("cy", String(selectedStation.y));
      groups.selectedStationHighlightNode.setAttribute("r", String(selectedRadius + 3));
      groups.selectedStationHighlightNode.style.display = "";
    } else {
      groups.selectedStationHighlightNode.style.display = "none";
    }
  }
}

export function syncRailLineNodes(groups, visibleLines, config, selectedLineId) {
  const visibleIds = new Set();
  const orderedNodes = [];
  visibleLines.forEach((feature) => {
    let path = groups.lineNodeById.get(feature.id);
    if (!path) {
      path = createSvgNode("path");
      groups.lineNodeById.set(feature.id, path);
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
  syncGroupOrder(groups.linesGroup, orderedNodes);
  Array.from(groups.lineNodeById.entries()).forEach(([lineId, node]) => {
    if (visibleIds.has(lineId)) return;
    node.remove();
    groups.lineNodeById.delete(lineId);
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

export function syncRailStationNodes(groups, visibleStations, visibleStationLabelEntries, config, selectedStationId) {
  const visibleIds = new Set();
  const visibleLabelIds = new Set(visibleStationLabelEntries.map((entry) => entry.feature.id));
  const stationLabelEntryById = new Map(visibleStationLabelEntries.map((entry) => [entry.feature.id, entry]));
  const orderedNodes = [];
  const orderedLabels = [];
  visibleStations.forEach((feature) => {
    const preset = STATION_STYLE[config.stationSymbolPreset] || STATION_STYLE.dot_ring;
    let node = groups.stationNodeById.get(feature.id);
    const expectedTagName = preset.square ? "rect" : "circle";
    if (node && node.tagName.toLowerCase() !== expectedTagName) {
      node.remove();
      groups.stationNodeById.delete(feature.id);
      node = null;
    }
    if (!node) {
      node = createSvgNode(expectedTagName);
      groups.stationNodeById.set(feature.id, node);
    }
    updateStationNode(node, feature, config, selectedStationId === feature.id);
    orderedNodes.push(node);
    visibleIds.add(feature.id);

    const labelEntry = stationLabelEntryById.get(feature.id);
    if (labelEntry) {
      const importanceStyle = getStationImportanceStyle(feature);
      const fontSize = 10 * importanceStyle.labelScale;
      const textOffsetX = 7 + Math.max(0, fontSize - 10);
      const textOffsetY = 6 + Math.max(0, fontSize - 10) * 0.35;
      let text = groups.stationLabelNodeById.get(feature.id);
      if (!text) {
        text = createSvgNode("text");
        groups.stationLabelNodeById.set(feature.id, text);
      }
      text.textContent = feature.name || "";
      text.setAttribute("x", String(labelEntry.screenPoint.x + textOffsetX));
      text.setAttribute("y", String(labelEntry.screenPoint.y - textOffsetY));
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
    }
  });
  syncGroupOrder(groups.stationsGroup, orderedNodes);
  syncGroupOrder(groups.stationLabelsGroup, orderedLabels);
  Array.from(groups.stationNodeById.entries()).forEach(([stationId, node]) => {
    if (visibleIds.has(stationId)) return;
    node.remove();
    groups.stationNodeById.delete(stationId);
  });
  Array.from(groups.stationLabelNodeById.entries()).forEach(([stationId, node]) => {
    if (visibleLabelIds.has(stationId)) return;
    node.remove();
    groups.stationLabelNodeById.delete(stationId);
  });
}
