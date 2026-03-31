import {
  getTransportWorkbenchCarrierOverlayRoots,
  getTransportWorkbenchCarrierViewState,
  projectTransportWorkbenchCarrierGeometry,
  projectTransportWorkbenchCarrierPoint,
} from "./transport_workbench_carrier.js";


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
  sparse: 170,
  balanced: 132,
  dense: 96,
};
const PRIMARY_REVEAL_SCALE = {
  strict: 1.65,
  balanced: 1.38,
  loose: 1.18,
};
const TRUNK_REVEAL_SCALE = {
  strict: 1.08,
  balanced: 1.0,
  loose: 1.0,
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

let packPromise = null;
let projectedPack = null;
let rootGroup = null;
let roadsGroup = null;
let labelsGroup = null;
let selectedGroup = null;
let renderStats = {
  visibleRoads: 0,
  visibleLabels: 0,
  totalRoads: 0,
  totalLabels: 0,
  filteredRoads: 0,
};
let loadState = {
  status: "idle",
  error: null,
  manifest: null,
  audit: null,
};
let selectedFeature = null;
let selectionChangeListener = null;


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

function createRoadFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const projected = projectTransportWorkbenchCarrierGeometry(rawFeature.geometry, "main");
  if (!projected?.geometry) return null;
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
  };
}

function createLabelFeature(rawFeature) {
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectTransportWorkbenchCarrierPoint(coordinates[0], coordinates[1], "main");
  if (!projected) return null;
  return {
    id: String(properties.id || rawFeature.id || ""),
    roadId: String(properties.road_id || "").trim(),
    ref: String(properties.ref || "").trim(),
    roadClass: String(properties.road_class || "").trim(),
    source: String(properties.source || "").trim(),
    priority: normalizeNumber(properties.priority, 0),
    x: projected.x,
    y: projected.y,
  };
}

async function loadJapanRoadPack() {
  if (projectedPack) return projectedPack;
  if (!packPromise) {
    packPromise = (async () => {
      loadState = { status: "loading", error: null, manifest: null, audit: null };
      ensureTopojsonClient();
      const manifestResponse = await fetch(MANIFEST_URL);
      if (!manifestResponse.ok) {
        throw new Error(`Failed to load Japan road manifest: ${manifestResponse.status}`);
      }
      const manifest = await manifestResponse.json();
      const roadsResponse = await fetch(manifest?.paths?.roads || "");
      if (!roadsResponse.ok) {
        throw new Error(`Failed to load Japan road topology: ${roadsResponse.status}`);
      }
      const labelsResponse = await fetch(manifest?.paths?.road_labels || "");
      if (!labelsResponse.ok) {
        throw new Error(`Failed to load Japan road labels: ${labelsResponse.status}`);
      }
      const auditResponse = manifest?.paths?.build_audit ? await fetch(manifest.paths.build_audit) : null;
      const roadsTopology = await roadsResponse.json();
      const labelsCollection = await labelsResponse.json();
      const audit = auditResponse && auditResponse.ok ? await auditResponse.json() : null;
      const roadsObject = roadsTopology?.objects?.roads;
      if (!roadsObject) {
        throw new Error("Japan road topology is missing the 'roads' object.");
      }
      const decodedRoads = globalThis.topojson.feature(roadsTopology, roadsObject);
      const roadFeatures = (decodedRoads?.features || []).map(createRoadFeature).filter(Boolean);
      const labelFeatures = (labelsCollection?.features || []).map(createLabelFeature).filter(Boolean);
      projectedPack = { manifest, audit, roadFeatures, labelFeatures };
      loadState = { status: "ready", error: null, manifest, audit };
      renderStats.totalRoads = roadFeatures.length;
      renderStats.totalLabels = labelFeatures.length;
      return projectedPack;
    })().catch((error) => {
      loadState = {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        manifest: null,
        audit: null,
      };
      throw error;
    });
  }
  return packPromise;
}

function ensureGroups() {
  const landRoot = getTransportWorkbenchCarrierOverlayRoots()?.land?.main;
  if (!landRoot) return null;
  if (rootGroup && rootGroup.parentNode === landRoot) return rootGroup;
  rootGroup?.remove();
  rootGroup = createSvgNode("g");
  rootGroup.classList.add("transport-workbench-road-preview-root");
  roadsGroup = createSvgNode("g");
  roadsGroup.classList.add("transport-workbench-road-preview-roads");
  labelsGroup = createSvgNode("g");
  labelsGroup.classList.add("transport-workbench-road-preview-labels");
  selectedGroup = createSvgNode("g");
  selectedGroup.classList.add("transport-workbench-road-preview-selected");
  rootGroup.append(roadsGroup, labelsGroup, selectedGroup);
  landRoot.appendChild(rootGroup);
  return rootGroup;
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
  const isSelected = selectedRoadId && selectedRoadId === feature.id;
  const hasConflict = config.showSourceConflicts && feature.sourceFlags.includes("name_conflict");
  return {
    stroke: hasConflict ? CONFLICT_STROKE : base.stroke,
    width: isSelected ? base.width + 1.15 : base.width,
    opacity: isSelected && config.selectedEmphasis === "mute_others"
      ? 1
      : normalizeNumber(config.baseOpacity, 88) / 100,
  };
}

function getLabelClassGate(feature, config, scale) {
  if (!config.showRefs) return false;
  if (!config.refClasses?.includes(feature.roadClass)) return false;
  if (feature.roadClass === "primary" && !config.allowPrimaryRefsAtHighZoom) return false;
  if (feature.roadClass === "primary" && scale < Math.max(1.55, PRIMARY_REVEAL_SCALE[config.zoomGate] || 1.38)) return false;
  if (feature.roadClass === "trunk" && scale < 1.02) return false;
  return true;
}

function filterVisibleLabels(labelFeatures, visibleRoadIds, config, scale) {
  const gridSize = LABEL_GRID_BY_DENSITY[config.labelDensityPreset] || LABEL_GRID_BY_DENSITY.balanced;
  const usedBuckets = new Set();
  return labelFeatures
    .filter((label) => visibleRoadIds.has(label.roadId))
    .filter((label) => getLabelClassGate(label, config, scale))
    .sort((left, right) => right.priority - left.priority)
    .filter((label) => {
      const bucketKey = `${Math.round(label.x / gridSize)}:${Math.round(label.y / gridSize)}:${label.roadClass}`;
      if (usedBuckets.has(bucketKey)) return false;
      usedBuckets.add(bucketKey);
      return true;
    });
}

function clearGroups() {
  roadsGroup?.replaceChildren();
  labelsGroup?.replaceChildren();
  selectedGroup?.replaceChildren();
}

function emitSelectionChange() {
  selectionChangeListener?.(getJapanRoadPreviewSnapshot());
}

function buildSelectedSnapshot(visibleLookup, config) {
  if (!selectedFeature || !projectedPack) return null;
  if (selectedFeature.type === "label") {
    const label = projectedPack.labelFeatures.find((entry) => entry.id === selectedFeature.id);
    if (!label) return null;
    const linkedRoad = projectedPack.roadFeatures.find((entry) => entry.id === label.roadId) || null;
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
  const road = projectedPack.roadFeatures.find((entry) => entry.id === selectedFeature.id);
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
  selectedGroup?.replaceChildren();
  if (!selectedRoad || !selectedGroup) return;
  const highlight = createSvgNode("path");
  highlight.setAttribute("d", selectedRoad.pathD);
  highlight.setAttribute("fill", "none");
  highlight.setAttribute("stroke", SELECTED_STROKE);
  highlight.setAttribute("stroke-width", "2.2");
  highlight.setAttribute("opacity", "0.9");
  highlight.setAttribute("stroke-linecap", "round");
  highlight.setAttribute("stroke-linejoin", "round");
  highlight.setAttribute("vector-effect", "non-scaling-stroke");
  selectedGroup.appendChild(highlight);
}

function renderRoads(config) {
  if (!projectedPack || !ensureGroups()) return getJapanRoadPreviewSnapshot();
  clearGroups();
  const scale = getCurrentScale();
  const visibleRoads = projectedPack.roadFeatures
    .filter((feature) => !getRoadVisibilityReason(feature, config, scale))
    .sort((left, right) => {
      const classDelta = (ROAD_RENDER_PRIORITY[left.roadClass] || 0) - (ROAD_RENDER_PRIORITY[right.roadClass] || 0);
      if (classDelta !== 0) return classDelta;
      return left.priority - right.priority;
    });
  const visibleRoadIds = new Set(visibleRoads.map((feature) => feature.id));
  const visibleLabels = filterVisibleLabels(projectedPack.labelFeatures, visibleRoadIds, config, scale);
  const selectedRoadId = selectedFeature?.type === "road"
    ? selectedFeature.id
    : (selectedFeature?.type === "label" ? selectedFeature.roadId : null);

  const roadFragment = document.createDocumentFragment();
  visibleRoads.forEach((feature) => {
    const path = createSvgNode("path");
    const style = getRoadStyle(feature, config, selectedRoadId);
    path.setAttribute("d", feature.pathD);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", style.stroke);
    path.setAttribute("stroke-width", String(style.width));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.setAttribute("opacity", String(style.opacity));
    path.dataset.roadId = feature.id;
    path.classList.add("transport-workbench-road-path", `road-class-${feature.roadClass}`);
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedFeature = { type: "road", id: feature.id };
      renderSelectedHighlight(feature);
      emitSelectionChange();
    });
    roadFragment.appendChild(path);
  });
  roadsGroup.appendChild(roadFragment);

  const labelFragment = document.createDocumentFragment();
  visibleLabels.forEach((label) => {
    const text = createSvgNode("text");
    text.textContent = label.ref;
    text.setAttribute("x", String(label.x));
    text.setAttribute("y", String(label.y));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", label.roadClass === "motorway" ? "11" : "10");
    text.setAttribute("font-weight", label.roadClass === "motorway" ? "700" : "600");
    text.setAttribute("fill", "#233141");
    text.setAttribute("stroke", "#f8f5f0");
    text.setAttribute("stroke-width", "2");
    text.setAttribute("paint-order", "stroke");
    text.setAttribute("vector-effect", "non-scaling-stroke");
    text.setAttribute("opacity", String(normalizeNumber(config.refOpacity, 82) / 100));
    text.classList.add("transport-workbench-road-label");
    text.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedFeature = { type: "label", id: label.id, roadId: label.roadId };
      const linkedRoad = projectedPack.roadFeatures.find((feature) => feature.id === label.roadId) || null;
      renderSelectedHighlight(linkedRoad);
      emitSelectionChange();
    });
    labelFragment.appendChild(text);
  });
  labelsGroup.appendChild(labelFragment);

  renderStats = {
    visibleRoads: visibleRoads.length,
    visibleLabels: visibleLabels.length,
    totalRoads: projectedPack.roadFeatures.length,
    totalLabels: projectedPack.labelFeatures.length,
    filteredRoads: projectedPack.roadFeatures.length - visibleRoads.length,
  };
  const selectedRoad = selectedRoadId
    ? projectedPack.roadFeatures.find((feature) => feature.id === selectedRoadId) || null
    : null;
  renderSelectedHighlight(selectedRoad);
  return getJapanRoadPreviewSnapshot(config);
}

export function setJapanRoadPreviewSelectionListener(listener) {
  selectionChangeListener = typeof listener === "function" ? listener : null;
}

export async function renderJapanRoadPreview(config) {
  await loadJapanRoadPack();
  return renderRoads(config);
}

export function clearJapanRoadPreview() {
  clearGroups();
}

export function destroyJapanRoadPreview() {
  selectedFeature = null;
  renderStats = {
    visibleRoads: 0,
    visibleLabels: 0,
    totalRoads: projectedPack?.roadFeatures?.length || 0,
    totalLabels: projectedPack?.labelFeatures?.length || 0,
    filteredRoads: 0,
  };
  rootGroup?.remove();
  rootGroup = null;
  roadsGroup = null;
  labelsGroup = null;
  selectedGroup = null;
}

export function getJapanRoadPreviewSnapshot(config = null) {
  return {
    status: loadState.status,
    error: loadState.error,
    manifest: loadState.manifest,
    audit: loadState.audit,
    stats: { ...renderStats },
    selected: config ? buildSelectedSnapshot(renderStats, config) : selectedFeature,
  };
}
