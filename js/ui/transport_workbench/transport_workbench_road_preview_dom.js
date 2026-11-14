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
import { getLabelClassGate, getRoadStyle } from "./transport_workbench_road_preview_runtime.js";

// DOM rendering layer for the Japan road workbench preview. Owns SVG group
// lifecycle, node sync, label projection and the selection highlight. All state
// lives on a `groups` object created by createRoadPreviewGroups() and passed in,
// mirroring the point preview's runtime-parameter pattern. Pure decision logic is
// in transport_workbench_road_preview_runtime.js; orchestration (load/render/select
// wiring, click handlers) stays in transport_workbench_road_preview.js.

const SELECTED_STROKE = "#12202d";
const LABEL_GRID_BY_DENSITY = {
  very_sparse: 208,
  sparse: 176,
  balanced: 144,
  dense: 116,
  very_dense: 92,
};

export function createRoadPreviewGroups() {
  return {
    rootGroup: null,
    labelRootGroup: null,
    roadsGroup: null,
    labelsGroup: null,
    selectedGroup: null,
    selectedHighlightNode: null,
    roadNodeById: new Map(),
    labelNodeById: new Map(),
  };
}

export function ensureRoadGroups(groups, { onRoadClick, onLabelClick }) {
  const landRoot = getTransportWorkbenchCarrierOverlayRoots()?.land?.main;
  const labelRoot = getTransportWorkbenchCarrierOverlayRoots()?.labels?.main;
  if (!landRoot || !labelRoot) return null;
  if (
    groups.rootGroup && groups.rootGroup.parentNode === landRoot
    && groups.labelRootGroup && groups.labelRootGroup.parentNode === labelRoot
  ) return groups.rootGroup;
  groups.rootGroup?.remove();
  groups.labelRootGroup?.remove();
  groups.roadNodeById = new Map();
  groups.labelNodeById = new Map();
  groups.rootGroup = createSvgNode("g");
  groups.rootGroup.classList.add("transport-workbench-road-preview-root");
  groups.labelRootGroup = createSvgNode("g");
  groups.labelRootGroup.classList.add("transport-workbench-road-preview-label-root");
  groups.roadsGroup = createSvgNode("g");
  groups.roadsGroup.classList.add("transport-workbench-road-preview-roads");
  groups.roadsGroup.addEventListener("click", onRoadClick);
  groups.labelsGroup = createSvgNode("g");
  groups.labelsGroup.classList.add("transport-workbench-road-preview-labels");
  groups.labelsGroup.addEventListener("click", onLabelClick);
  groups.selectedGroup = createSvgNode("g");
  groups.selectedGroup.classList.add("transport-workbench-road-preview-selected");
  groups.selectedHighlightNode = createSvgNode("path");
  groups.selectedHighlightNode.setAttribute("fill", "none");
  groups.selectedHighlightNode.setAttribute("stroke", SELECTED_STROKE);
  groups.selectedHighlightNode.setAttribute("stroke-width", "2.2");
  groups.selectedHighlightNode.setAttribute("opacity", "0.9");
  groups.selectedHighlightNode.setAttribute("stroke-linecap", "round");
  groups.selectedHighlightNode.setAttribute("stroke-linejoin", "round");
  groups.selectedHighlightNode.setAttribute("vector-effect", "non-scaling-stroke");
  groups.selectedHighlightNode.classList.add("transport-workbench-road-selected-highlight");
  groups.selectedHighlightNode.style.display = "none";
  groups.selectedGroup.appendChild(groups.selectedHighlightNode);
  groups.rootGroup.append(groups.roadsGroup, groups.selectedGroup);
  groups.labelRootGroup.append(groups.labelsGroup);
  landRoot.appendChild(groups.rootGroup);
  labelRoot.appendChild(groups.labelRootGroup);
  return groups.rootGroup;
}

export function clearRoadGroups(groups) {
  groups.roadNodeById.forEach((node) => node.remove());
  groups.labelNodeById.forEach((node) => node.remove());
  groups.roadNodeById.clear();
  groups.labelNodeById.clear();
  if (groups.selectedHighlightNode) {
    groups.selectedHighlightNode.removeAttribute("d");
    groups.selectedHighlightNode.style.display = "none";
  }
}

export function destroyRoadGroups(groups) {
  groups.rootGroup?.remove();
  groups.labelRootGroup?.remove();
  groups.rootGroup = null;
  groups.labelRootGroup = null;
  groups.roadsGroup = null;
  groups.labelsGroup = null;
  groups.selectedGroup = null;
  groups.selectedHighlightNode = null;
  groups.roadNodeById.clear();
  groups.labelNodeById.clear();
}

export function filterVisibleRoadLabels(labelFeatures, visibleRoadIds, config, scale) {
  const gridSize = LABEL_GRID_BY_DENSITY[config.labelDensityPreset] || LABEL_GRID_BY_DENSITY.balanced;
  const rankedLabels = labelFeatures
    .filter((label) => visibleRoadIds.has(label.roadId))
    .filter((label) => getLabelClassGate(label, config, scale))
    .map((label) => ({
      ...label,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(label.x, label.y),
    }))
    .filter((label) => label.screenPoint)
    .sort((left, right) => right.priority - left.priority);
  return keepFirstPerGridBucket(rankedLabels, {
    gridSize,
    getScreenPoint: (label) => label.screenPoint,
    getBucketParts: (label) => [label.roadClass],
  });
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

export function syncRoadNodes(groups, visibleRoads, config, selectedRoadId) {
  const visibleIds = new Set();
  const orderedNodes = [];
  visibleRoads.forEach((feature) => {
    let path = groups.roadNodeById.get(feature.id);
    if (!path) {
      path = createSvgNode("path");
      groups.roadNodeById.set(feature.id, path);
    }
    updateRoadNode(path, feature, getRoadStyle(feature, config, selectedRoadId));
    orderedNodes.push(path);
    visibleIds.add(feature.id);
  });
  syncGroupOrder(groups.roadsGroup, orderedNodes);
  Array.from(groups.roadNodeById.entries()).forEach(([roadId, node]) => {
    if (visibleIds.has(roadId)) return;
    node.remove();
    groups.roadNodeById.delete(roadId);
  });
}

export function syncRoadLabelNodes(groups, visibleLabels, config) {
  const visibleIds = new Set();
  const orderedTextNodes = [];
  visibleLabels.forEach((label) => {
    let text = groups.labelNodeById.get(label.id);
    if (!text) {
      text = createSvgNode("text");
      groups.labelNodeById.set(label.id, text);
    }
    updateLabelNode(text, label, config);
    orderedTextNodes.push(text);
    visibleIds.add(label.id);
  });
  syncGroupOrder(groups.labelsGroup, orderedTextNodes);
  Array.from(groups.labelNodeById.entries()).forEach(([labelId, node]) => {
    if (visibleIds.has(labelId)) return;
    node.remove();
    groups.labelNodeById.delete(labelId);
  });
}

export function renderRoadSelectedHighlight(groups, selectedRoad) {
  const node = groups.selectedHighlightNode;
  if (!node) return;
  if (!selectedRoad) {
    node.removeAttribute("d");
    node.style.display = "none";
    return;
  }
  node.setAttribute("d", selectedRoad.pathD);
  node.style.display = "";
}
