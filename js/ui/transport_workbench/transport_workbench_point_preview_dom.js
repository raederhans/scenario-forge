import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierScenePoint,
} from "./transport_workbench_carrier.js";
import { normalizeTransportWorkbenchPointNumber } from "./transport_workbench_point_preview_runtime.js";

const POINT_LABEL_GRID_BY_DENSITY = {
  very_sparse: 192,
  sparse: 164,
  balanced: 136,
  dense: 112,
  very_dense: 90,
};

const normalizeNumber = normalizeTransportWorkbenchPointNumber;

function getCurrentScale() {
  return normalizeNumber(getTransportWorkbenchCarrierViewState()?.scale, 1);
}

export function createTransportWorkbenchPointSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function createDiamondPath(x, y, radius) {
  return `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`;
}

export function ensureTransportWorkbenchPointRootGroups(runtime) {
  const roots = getTransportWorkbenchCarrierOverlayRoots();
  const landRoot = roots?.land?.main;
  const labelRoot = roots?.labels?.main;
  if (!landRoot || !labelRoot) {
    throw new Error(`${runtime.definition.familyId} preview carrier overlays are unavailable.`);
  }
  if (!runtime.rootGroup || runtime.rootGroup.parentNode !== landRoot) {
    runtime.rootGroup = createTransportWorkbenchPointSvgNode("g");
    runtime.rootGroup.setAttribute("class", `transport-workbench-${runtime.definition.familyId}-preview-layer`);
    landRoot.appendChild(runtime.rootGroup);
  }
  if (!runtime.labelsGroup || runtime.labelsGroup.parentNode !== labelRoot) {
    runtime.labelsGroup = createTransportWorkbenchPointSvgNode("g");
    runtime.labelsGroup.setAttribute("class", `transport-workbench-${runtime.definition.familyId}-preview-label-layer`);
    labelRoot.appendChild(runtime.labelsGroup);
  }
}

export function clearTransportWorkbenchPointGroups(runtime) {
  runtime.rootGroup?.replaceChildren();
  runtime.labelsGroup?.replaceChildren();
  runtime.labelDescriptors = [];
}

export function createTransportWorkbenchPointMarkerNode(feature, markerStyle, onSelect) {
  const node = markerStyle.shape === "square"
    ? createTransportWorkbenchPointSvgNode("rect")
    : markerStyle.shape === "circle"
      ? createTransportWorkbenchPointSvgNode("circle")
    : createTransportWorkbenchPointSvgNode("path");
  if (markerStyle.shape === "square") {
    const radius = normalizeNumber(markerStyle.radius, 4.8);
    node.setAttribute("x", String(feature.x - radius));
    node.setAttribute("y", String(feature.y - radius));
    node.setAttribute("width", String(radius * 2));
    node.setAttribute("height", String(radius * 2));
    node.setAttribute("rx", String(normalizeNumber(markerStyle.cornerRadius, 0.9)));
  } else if (markerStyle.shape === "circle") {
    node.setAttribute("cx", String(feature.x));
    node.setAttribute("cy", String(feature.y));
    node.setAttribute("r", String(normalizeNumber(markerStyle.radius, 5.2)));
  } else {
    node.setAttribute("d", createDiamondPath(feature.x, feature.y, normalizeNumber(markerStyle.radius, 5.2)));
  }
  node.setAttribute("fill", markerStyle.fill);
  node.setAttribute("stroke", markerStyle.stroke);
  node.setAttribute("stroke-width", String(normalizeNumber(markerStyle.strokeWidth, 1.2)));
  node.setAttribute("opacity", String(normalizeNumber(markerStyle.opacity, 0.9)));
  node.dataset.featureId = feature.id;
  node.dataset.featureKind = feature.kind;
  node.dataset.baseStroke = String(markerStyle.stroke || "");
  node.dataset.baseStrokeWidth = String(normalizeNumber(markerStyle.strokeWidth, 1.2));
  node.style.cursor = "pointer";
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return node;
}

export function createTransportWorkbenchPointLabelNode(feature, markerStyle, onSelect) {
  const screenPoint = projectTransportWorkbenchCarrierScenePoint(feature.x, feature.y);
  if (!screenPoint) return null;
  const label = createTransportWorkbenchPointSvgNode("text");
  label.setAttribute("x", String(screenPoint.x + normalizeNumber(markerStyle.labelOffsetX, 8)));
  label.setAttribute("y", String(screenPoint.y + normalizeNumber(markerStyle.labelOffsetY, 1.5)));
  label.setAttribute("fill", markerStyle.labelColor || markerStyle.stroke);
  label.setAttribute("font-size", String(normalizeNumber(markerStyle.labelSize, 10.5)));
  label.setAttribute("font-weight", String(normalizeNumber(markerStyle.labelWeight, 600)));
  label.setAttribute("font-family", "\"Segoe UI Variable\", \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei UI\", \"Noto Sans SC\", sans-serif");
  label.textContent = feature.label;
  label.dataset.featureId = feature.id;
  label.dataset.featureKind = feature.kind;
  label.dataset.baseLabelWeight = String(normalizeNumber(markerStyle.labelWeight, 600));
  label.style.cursor = "pointer";
  label.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(feature);
  });
  return label;
}

export function createTransportWorkbenchPointLabelDescriptor(feature, markerStyle, onSelectFeature) {
  return {
    feature: { ...feature },
    markerStyle: { ...markerStyle },
    onSelectFeature,
  };
}

export function renderTransportWorkbenchPointLabelDescriptors(runtime) {
  if (!runtime.labelsGroup) return;
  runtime.labelsGroup.replaceChildren();
  runtime.labelDescriptors.forEach((descriptor) => {
    const labelNode = createTransportWorkbenchPointLabelNode(
      descriptor.feature,
      descriptor.markerStyle,
      () => descriptor.onSelectFeature(descriptor.feature)
    );
    if (labelNode) {
      runtime.labelsGroup.appendChild(labelNode);
    }
  });
  runtime.renderStats.visibleLabels = runtime.labelsGroup.querySelectorAll("[data-feature-id]").length;
  applyTransportWorkbenchPointSelectionHighlight(runtime);
}

function getLabelDensityGridSize(config) {
  return POINT_LABEL_GRID_BY_DENSITY[String(config?.labelDensityPreset || "").trim()] || POINT_LABEL_GRID_BY_DENSITY.balanced;
}

export function selectVisibleTransportWorkbenchPointLabelEntries(visibleEntries, config) {
  const gridSize = getLabelDensityGridSize(config);
  const usedBuckets = new Set();
  return visibleEntries
    .filter((entry) => entry.visibility.showLabel)
    .map((entry) => ({
      ...entry,
      screenPoint: projectTransportWorkbenchCarrierScenePoint(entry.feature.x, entry.feature.y),
    }))
    .filter((entry) => entry.screenPoint)
    .sort((left, right) => {
      const rankDelta = normalizeNumber(right.feature.importanceRank, 1) - normalizeNumber(left.feature.importanceRank, 1);
      if (rankDelta !== 0) return rankDelta;
      return String(left.feature.label || left.feature.id).localeCompare(String(right.feature.label || right.feature.id), "ja");
    })
    .filter((entry) => {
      const bucketKey = `${Math.round(entry.screenPoint.x / gridSize)}:${Math.round(entry.screenPoint.y / gridSize)}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    });
}

export function getTransportWorkbenchPointLabelDensityGridSize(config) {
  return getLabelDensityGridSize(config);
}

export function applyTransportWorkbenchPointSelectionHighlight(runtime) {
  if (!runtime.rootGroup || !runtime.labelsGroup) return;
  const markerStyle = runtime.definition.getMarkerStyle(getCurrentScale(), runtime.lastRenderedConfig || {});
  runtime.rootGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    const isSelected = runtime.selectedFeature?.id === id;
    node.setAttribute("stroke", isSelected ? (markerStyle.selectedStroke || "#111827") : (node.dataset.baseStroke || markerStyle.stroke));
    node.setAttribute("stroke-width", String(isSelected ? normalizeNumber(markerStyle.selectedStrokeWidth, 2.2) : normalizeNumber(node.dataset.baseStrokeWidth, normalizeNumber(markerStyle.strokeWidth, 1.2))));
  });
  runtime.labelsGroup.querySelectorAll("[data-feature-id]").forEach((node) => {
    const id = node.dataset.featureId || "";
    node.setAttribute("font-weight", runtime.selectedFeature?.id === id ? "700" : (node.dataset.baseLabelWeight || String(normalizeNumber(markerStyle.labelWeight, 600))));
  });
}
