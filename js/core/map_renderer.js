// Hybrid canvas + SVG rendering engine.
import { state } from "./state.js";
import { ColorManager } from "./color_manager.js";
import { LegendManager } from "./legend_manager.js";
import { getTooltipText } from "../ui/i18n.js";

let mapContainer = null;
let mapCanvas = null;
let mapSvg = null;
let interactionRect = null;
let textureOverlay = null;
let tooltip = null;
let context = null;

let projection = null;
let pathSVG = null;
let pathCanvas = null;
let zoomBehavior = null;

let viewportGroup = null;
let specialZonesGroup = null;
let hoverGroup = null;
let legendGroup = null;
let legendItemsGroup = null;
let legendBackground = null;
let lastLegendKey = null;

const PROJECTION_PRECISION = 0.1;
const PATH_POINT_RADIUS = 2;
const VIEWPORT_CULL_OVERSCAN_PX = 96;
const MAP_PAN_PADDING_PX = 50;
const MIN_ZOOM_SCALE = 1;
const MAX_ZOOM_SCALE = 50;
const OCEAN_FILL_COLOR = "#aadaff";
const LAND_FILL_COLOR = "#f0f0f0";
const BORDER_FALLBACK_COLOR = "rgba(0, 0, 0, 0.2)";

function getFeatureId(feature) {
  return (
    feature?.properties?.id ||
    feature?.properties?.NUTS_ID ||
    feature?.id ||
    null
  );
}

function getFeatureCountryCode(feature) {
  return (
    feature?.properties?.cntr_code ||
    feature?.properties?.CNTR_CODE ||
    feature?.properties?.iso_a2 ||
    feature?.properties?.ISO_A2 ||
    ""
  );
}

function getFeatureRegionTag(feature) {
  const props = feature?.properties || {};
  return (
    props.subregion ||
    props.SUBREGION ||
    props.mapcolor7 ||
    props.MAPCOLOR7 ||
    props.mapcolor8 ||
    props.MAPCOLOR8 ||
    props.mapcolor9 ||
    props.MAPCOLOR9 ||
    props.region_un ||
    props.REGION_UN ||
    props.region_wb ||
    props.REGION_WB ||
    props.continent ||
    props.CONTINENT ||
    props.cntr_code ||
    props.CNTR_CODE ||
    "Unknown"
  );
}

function getColorsHash() {
  const entries = Object.entries(state.colors).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function pathBoundsInScreen(feature) {
  if (!pathSVG) return false;
  const bounds = pathSVG.bounds(feature);
  const minX = bounds[0][0] * state.zoomTransform.k + state.zoomTransform.x;
  const minY = bounds[0][1] * state.zoomTransform.k + state.zoomTransform.y;
  const maxX = bounds[1][0] * state.zoomTransform.k + state.zoomTransform.x;
  const maxY = bounds[1][1] * state.zoomTransform.k + state.zoomTransform.y;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;

  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(state.width, state.height) * 0.08
  );

  return !(
    maxX < -overscan ||
    maxY < -overscan ||
    minX > state.width + overscan ||
    minY > state.height + overscan
  );
}

function ensureLayerDataFromTopology() {
  if (!state.topology || !state.topology.objects || !globalThis.topojson) return;
  const objects = state.topology.objects;

  if (!state.oceanData && objects.ocean) {
    state.oceanData = globalThis.topojson.feature(state.topology, objects.ocean);
  }
  if (!state.landBgData && objects.land) {
    state.landBgData = globalThis.topojson.feature(state.topology, objects.land);
  }
  if (!state.riversData && objects.rivers) {
    state.riversData = globalThis.topojson.feature(state.topology, objects.rivers);
  }
  if (!state.urbanData && objects.urban) {
    state.urbanData = globalThis.topojson.feature(state.topology, objects.urban);
  }
  if (!state.physicalData && objects.physical) {
    state.physicalData = globalThis.topojson.feature(state.topology, objects.physical);
  }
  if (!state.specialZonesData && objects.special_zones) {
    state.specialZonesData = globalThis.topojson.feature(state.topology, objects.special_zones);
  }
}

function createCanvasElement() {
  const canvas = document.createElement("canvas");
  canvas.id = "map-canvas";
  canvas.className = "map-layer";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.zIndex = "0";
  return canvas;
}

function createSvgElement() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "map-svg");
  svg.classList.add("map-layer", "map-layer-top");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.display = "block";
  svg.style.zIndex = "1";
  svg.style.pointerEvents = "none";
  return svg;
}

function ensureHybridLayers() {
  const legacySpecialZones = document.getElementById("specialZonesSvg");
  if (legacySpecialZones) legacySpecialZones.remove();
  const legacyLegend = document.getElementById("legendSvg");
  if (legacyLegend) legacyLegend.remove();

  const legacyColorCanvas = document.getElementById("colorCanvas");
  const legacyLineCanvas = document.getElementById("lineCanvas");

  mapCanvas = mapContainer.querySelector("#map-canvas");
  if (!mapCanvas) {
    mapCanvas = createCanvasElement();
    const anchor = legacyColorCanvas || legacyLineCanvas || textureOverlay || null;
    if (anchor && mapContainer.contains(anchor)) {
      mapContainer.insertBefore(mapCanvas, anchor);
    } else {
      mapContainer.appendChild(mapCanvas);
    }
  }
  mapCanvas.style.display = "block";
  mapCanvas.style.zIndex = "0";

  if (legacyColorCanvas && legacyColorCanvas !== mapCanvas) {
    legacyColorCanvas.style.display = "none";
    legacyColorCanvas.style.pointerEvents = "none";
  }
  if (legacyLineCanvas) {
    legacyLineCanvas.style.display = "none";
    legacyLineCanvas.style.pointerEvents = "none";
  }

  mapSvg = mapContainer.querySelector("#map-svg");
  if (!mapSvg) {
    mapSvg = createSvgElement();
    if (textureOverlay && mapContainer.contains(textureOverlay)) {
      mapContainer.insertBefore(mapSvg, textureOverlay);
    } else {
      mapContainer.appendChild(mapSvg);
    }
  }
  mapSvg.style.display = "block";
  mapSvg.style.zIndex = "1";

  const svg = globalThis.d3.select(mapSvg);
  svg.style("pointer-events", "none");

  viewportGroup = svg.select("g.viewport-layer");
  if (viewportGroup.empty()) {
    viewportGroup = svg.append("g").attr("class", "viewport-layer");
  }
  viewportGroup.style("pointer-events", "none");

  specialZonesGroup = viewportGroup.select("g.special-zones-layer");
  if (specialZonesGroup.empty()) {
    specialZonesGroup = viewportGroup.append("g").attr("class", "special-zones-layer");
  }
  specialZonesGroup.style("pointer-events", "none");

  hoverGroup = viewportGroup.select("g.hover-layer");
  if (hoverGroup.empty()) {
    hoverGroup = viewportGroup.append("g").attr("class", "hover-layer");
  }
  hoverGroup.style("pointer-events", "none");

  legendGroup = svg.select("g.legend-group");
  if (legendGroup.empty()) {
    legendGroup = svg.append("g").attr("class", "legend-group");
  }
  legendGroup.style("pointer-events", "none");

  legendBackground = legendGroup.select("rect.legend-bg");
  if (legendBackground.empty()) {
    legendBackground = legendGroup
      .append("rect")
      .attr("class", "legend-bg")
      .attr("fill", "rgba(255,255,255,0.85)")
      .attr("stroke", "#d1d5db")
      .attr("stroke-width", 1)
      .attr("rx", 8)
      .attr("ry", 8);
  }

  legendItemsGroup = legendGroup.select("g.legend-items");
  if (legendItemsGroup.empty()) {
    legendItemsGroup = legendGroup.append("g").attr("class", "legend-items");
  }

  interactionRect = svg.select("rect.interaction-layer");
  if (interactionRect.empty()) {
    interactionRect = svg
      .append("rect")
      .attr("class", "interaction-layer")
      .attr("fill", "transparent");
  }
  interactionRect.style("pointer-events", "all");
}

function setCanvasSize() {
  if (!mapCanvas || !mapSvg) return;

  state.dpr = globalThis.devicePixelRatio || 1;
  const rect = mapContainer?.getBoundingClientRect?.();
  const measuredWidth = rect?.width || mapContainer?.clientWidth || globalThis.innerWidth;
  const measuredHeight = rect?.height || mapContainer?.clientHeight || globalThis.innerHeight;

  state.width = Math.round(measuredWidth);
  state.height = Math.round(measuredHeight);

  if (state.width < 100) state.width = Math.max(100, globalThis.innerWidth - 580);
  if (state.height < 100) state.height = Math.max(100, globalThis.innerHeight);

  const scaledW = Math.floor(state.width * state.dpr);
  const scaledH = Math.floor(state.height * state.dpr);

  mapCanvas.width = scaledW;
  mapCanvas.height = scaledH;
  mapCanvas.style.width = `${state.width}px`;
  mapCanvas.style.height = `${state.height}px`;

  const svg = globalThis.d3.select(mapSvg);
  svg.attr("width", state.width).attr("height", state.height);
  interactionRect.attr("x", 0).attr("y", 0).attr("width", state.width).attr("height", state.height);
}

function rebuildDynamicBorders() {
  if (!state.topology || !state.topology.objects?.political || !globalThis.topojson) {
    state.cachedBorders = null;
    state.cachedColorsHash = null;
    return;
  }

  const currentHash = getColorsHash();
  if (state.cachedBorders && state.cachedColorsHash === currentHash) return;

  state.cachedBorders = globalThis.topojson.mesh(
    state.topology,
    state.topology.objects.political,
    (a, b) => {
      if (!b) return false;
      const idA = getFeatureId(a);
      const idB = getFeatureId(b);
      const colorA = idA ? state.colors[idA] : null;
      const colorB = idB ? state.colors[idB] : null;
      return !colorA || !colorB || colorA !== colorB;
    }
  );
  state.cachedColorsHash = currentHash;
}

function rebuildStaticMeshes() {
  if (!state.topology || !state.topology.objects?.political || !globalThis.topojson) {
    state.cachedCoastlines = null;
    state.cachedGridLines = null;
    return;
  }

  state.cachedCoastlines = globalThis.topojson.mesh(
    state.topology,
    state.topology.objects.political,
    (a, b) => !b
  );

  state.cachedGridLines = globalThis.topojson.mesh(
    state.topology,
    state.topology.objects.political,
    (a, b) => a !== b
  );
}

function invalidateBorderCache() {
  state.cachedBorders = null;
  state.cachedColorsHash = null;
  rebuildDynamicBorders();
}

function buildIndex() {
  state.landIndex.clear();
  state.idToKey.clear();
  state.keyToId.clear();

  if (!state.landData || !state.landData.features) return;
  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    state.landIndex.set(id, feature);
    const key = index + 1;
    state.idToKey.set(id, key);
    state.keyToId.set(key, id);
  });
}

function buildSpatialIndex() {
  state.spatialItems = [];
  state.spatialIndex = null;
  if (!state.landData || !state.landData.features || !pathSVG) return;

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id) continue;
    const bounds = pathSVG.bounds(feature);
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;

    state.spatialItems.push({
      id,
      feature,
      minX,
      minY,
      maxX,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    });
  }

  state.spatialIndex = globalThis.d3
    .quadtree()
    .x((item) => item.cx)
    .y((item) => item.cy)
    .addAll(state.spatialItems);
}

function getFeatureIdFromEvent(event) {
  if (!state.landData || !mapSvg || !projection) return null;

  const [sx, sy] = globalThis.d3.pointer(event, mapSvg);
  const px = (sx - state.zoomTransform.x) / state.zoomTransform.k;
  const py = (sy - state.zoomTransform.y) / state.zoomTransform.k;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  const lonLat = projection.invert([px, py]);
  if (!lonLat) return null;

  const candidates = [];
  if (state.spatialIndex) {
    state.spatialIndex.visit((node, x0, y0, x1, y1) => {
      if (px < x0 || px > x1 || py < y0 || py > y1) return true;
      if (!node.length) {
        let current = node;
        do {
          const item = current.data;
          if (
            item &&
            px >= item.minX && px <= item.maxX &&
            py >= item.minY && py <= item.maxY
          ) {
            candidates.push(item);
          }
          current = current.next;
        } while (current);
      }
      return false;
    });
  }

  for (const candidate of candidates) {
    if (globalThis.d3.geoContains(candidate.feature, lonLat)) {
      return candidate.id;
    }
  }

  return null;
}

function drawCanvas() {
  if (!context || !pathCanvas || !state.landData) return;
  ensureLayerDataFromTopology();

  const canvasWidth = context.canvas.width;
  const canvasHeight = context.canvas.height;
  const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, transform.k || 1);

  // Hard reset before every frame to avoid stale composition/clip state.
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1.0;
  context.shadowBlur = 0;
  context.filter = "none";
  context.clearRect(0, 0, canvasWidth, canvasHeight);

  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.translate(transform.x, transform.y);
  context.scale(k, k);

  if (state.oceanData) {
    context.save();
    context.fillStyle = OCEAN_FILL_COLOR;
    context.globalAlpha = 1.0;
    context.beginPath();
    pathCanvas(state.oceanData);
    context.fill();
    context.restore();
  }

  if (state.showPhysical && state.physicalData) {
    context.save();
    context.fillStyle = "rgba(255,255,255,0.18)";
    for (const feature of state.physicalData.features) {
      if (!pathBoundsInScreen(feature)) continue;
      context.beginPath();
      pathCanvas(feature);
      context.fill();
    }
    context.restore();
  }

  state.landData.features.forEach((feature, index) => {
    if (!pathBoundsInScreen(feature)) return;
    const id = getFeatureId(feature) || `feature-${index}`;
    const fill = state.colors[id] || LAND_FILL_COLOR;

    context.beginPath();
    pathCanvas(feature);
    context.fillStyle = fill;
    context.fill();
  });

  if (state.showUrban && state.urbanData) {
    context.save();
    context.fillStyle = "rgba(80,80,80,0.18)";
    for (const feature of state.urbanData.features) {
      if (!pathBoundsInScreen(feature)) continue;
      context.beginPath();
      pathCanvas(feature);
      context.fill();
    }
    context.restore();
  }

  if (state.cachedCoastlines) {
    context.beginPath();
    pathCanvas(state.cachedCoastlines);
    context.strokeStyle = state.styleConfig.coastlines.color || BORDER_FALLBACK_COLOR;
    context.lineWidth = state.styleConfig.coastlines.width / k;
    context.stroke();
  }

  if (state.cachedGridLines) {
    context.save();
    context.globalAlpha = state.styleConfig.internalBorders.opacity;
    context.beginPath();
    pathCanvas(state.cachedGridLines);
    context.strokeStyle = state.styleConfig.internalBorders.color || BORDER_FALLBACK_COLOR;
    context.lineWidth = state.styleConfig.internalBorders.width / k;
    context.stroke();
    context.restore();
  }

  rebuildDynamicBorders();
  if (state.cachedBorders) {
    context.beginPath();
    pathCanvas(state.cachedBorders);
    context.strokeStyle = state.styleConfig.empireBorders.color || BORDER_FALLBACK_COLOR;
    context.lineWidth = state.styleConfig.empireBorders.width / k;
    context.stroke();
  }

  if (state.showRivers && state.riversData) {
    context.beginPath();
    pathCanvas(state.riversData);
    context.strokeStyle = "#3498db";
    context.lineWidth = 0.8 / k;
    context.stroke();
  }

  if (state.isEditingPreset && state.editingPresetIds.size > 0) {
    context.save();
    context.strokeStyle = "#f97316";
    context.lineWidth = 2 / k;
    for (const id of state.editingPresetIds) {
      const feature = state.landIndex.get(id);
      if (!feature || !pathBoundsInScreen(feature)) continue;
      context.beginPath();
      pathCanvas(feature);
      context.stroke();
    }
    context.restore();
  }

}

function updateSpecialZonesPaths() {
  if (!specialZonesGroup || !pathSVG) return;

  const features = state.specialZonesData?.features || [];
  if (!features.length) {
    specialZonesGroup.selectAll("path.special-zone").remove();
    return;
  }

  const selection = specialZonesGroup
    .selectAll("path.special-zone")
    .data(features, (d, i) => d?.properties?.id || `special-zone-${i}`);

  selection
    .enter()
    .append("path")
    .attr("class", "special-zone")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", (d) => {
      const type = d?.properties?.type || "";
      if (type === "disputed") return "rgba(249,115,22,0.15)";
      if (type === "wasteland") return "rgba(220,38,38,0.12)";
      return "none";
    })
    .attr("stroke", (d) => {
      const type = d?.properties?.type || "";
      if (type === "disputed") return "#f97316";
      if (type === "wasteland") return "#dc2626";
      return "#111827";
    })
    .attr("stroke-width", 1.2)
    .attr("opacity", 0.85);

  selection.exit().remove();
}

function renderHoverOverlay() {
  if (!hoverGroup || !pathSVG) return;

  const feature = state.hoveredId ? state.landIndex.get(state.hoveredId) : null;
  const data = feature ? [feature] : [];

  const selection = hoverGroup
    .selectAll("path.hovered-feature")
    .data(data, (d) => getFeatureId(d) || "hover");

  selection
    .enter()
    .append("path")
    .attr("class", "hovered-feature")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", "none")
    .attr("stroke", "#f1c40f")
    .attr("stroke-width", 2.0);

  selection.exit().remove();
}

function renderSpecialZones() {
  if (!specialZonesGroup) return;
  if (!state.showSpecialZones) {
    specialZonesGroup.attr("display", "none");
    return;
  }
  specialZonesGroup.attr("display", null);
}

export function renderLegend(uniqueColors = null, labels = null) {
  if (!legendGroup || !legendItemsGroup || !legendBackground) return;

  const colors = Array.isArray(uniqueColors)
    ? uniqueColors
    : LegendManager.getUniqueColors(state);
  const labelMap = labels || LegendManager.getLabels();
  const colorKey = colors.join("|");
  const normalizedLabels = colors.map((color) => {
    const key = String(color || "").toLowerCase();
    return labelMap?.[key] || "";
  });
  const legendKey = `${colorKey}::${normalizedLabels.join("|")}`;
  const shouldRebuild = legendKey !== lastLegendKey;

  if (!colors.length) {
    legendGroup.attr("display", "none");
    lastLegendKey = legendKey;
    return;
  }

  legendGroup.attr("display", null);

  if (shouldRebuild) {
    legendItemsGroup.selectAll("*").remove();
    const itemHeight = 18;
    const swatchSize = 12;
    const textOffset = swatchSize + 8;

    colors.forEach((color, index) => {
      const y = index * itemHeight;
      const normalized = String(color || "").toLowerCase();
      const label = labelMap?.[normalized] || `Category ${index + 1}`;

      legendItemsGroup
        .append("rect")
        .attr("x", 0)
        .attr("y", y)
        .attr("width", swatchSize)
        .attr("height", swatchSize)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", color)
        .attr("stroke", "#1f2937")
        .attr("stroke-width", 0.4);

      legendItemsGroup
        .append("text")
        .attr("x", textOffset)
        .attr("y", y - 1)
        .attr("dominant-baseline", "hanging")
        .attr("font-size", 11)
        .attr("fill", "#111827")
        .text(label);
    });
  }

  const bbox = legendItemsGroup.node().getBBox();
  const padding = 8;
  const width = bbox.width + padding * 2;
  const height = bbox.height + padding * 2;

  legendBackground
    .attr("x", bbox.x - padding)
    .attr("y", bbox.y - padding)
    .attr("width", width)
    .attr("height", height);

  const margin = 14;
  const x = margin;
  const y = Math.max(margin, state.height - height - margin);
  legendGroup.attr("transform", `translate(${x},${y})`);

  lastLegendKey = legendKey;
}

function render() {
  drawCanvas();
  renderSpecialZones();
  renderHoverOverlay();
  renderLegend();
  if (typeof state.updateLegendUI === "function") {
    state.updateLegendUI();
  }
}

function autoFillMap(mode = "region") {
  if (!state.landData?.features?.length) {
    console.warn("[autoFillMap] No land features available, aborting.");
    return;
  }

  const nextColors = {};

  if (mode === "political" && state.topology?.objects?.political) {
    const { featureColors, countryColors } =
      ColorManager.computePoliticalColors(state.topology, "political");

    // Broadcast: for every land feature, resolve its color via feature ID → country code chain
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      const countryCode = String(
        getFeatureCountryCode(feature) || ColorManager.getCountryCode(feature, index) || ""
      ).toUpperCase();

      // Priority: direct feature match → country-level computed → user palette → hash fallback
      const color =
        featureColors[id] ||
        (countryCode && countryColors[countryCode]) ||
        (countryCode && state.countryPalette && state.countryPalette[countryCode]) ||
        ColorManager.getPoliticalFallbackColor(countryCode || id, index);

      nextColors[id] = color;
    });

    console.log(
      `[autoFillMap] Political: ${Object.keys(nextColors).length} features colored,`,
      `${Object.keys(countryColors).length} countries resolved,`,
      `${new Set(Object.values(nextColors)).size} unique colors`
    );
  } else {
    // Region mode: color by region tag (cntr_code, subregion, etc.)
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      const tag = getFeatureRegionTag(feature);
      nextColors[id] = ColorManager.getRegionColor(tag);
    });

    console.log(
      `[autoFillMap] Region: ${Object.keys(nextColors).length} features colored,`,
      `${new Set(Object.values(nextColors)).size} unique colors`
    );
  }

  state.colors = nextColors;
  invalidateBorderCache();
  render();
}

function handleMouseMove(event) {
  const now = performance.now();
  if (now - state.lastMouseMoveTime < state.MOUSE_THROTTLE_MS) return;
  state.lastMouseMoveTime = now;
  if (!state.landData || state.isInteracting) return;

  const id = getFeatureIdFromEvent(event);
  if (id !== state.hoveredId) {
    state.hoveredId = id;
    renderHoverOverlay();
  }

  if (!tooltip) return;
  if (id && state.landIndex.has(id)) {
    const feature = state.landIndex.get(id);
    tooltip.textContent = getTooltipText(feature);
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.opacity = "1";
  } else {
    tooltip.style.opacity = "0";
  }
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 5) {
    state.recentColors = state.recentColors.slice(0, 5);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function handleClick(event) {
  if (!state.landData) return;

  const id = getFeatureIdFromEvent(event);
  if (!id) return;
  const feature = state.landIndex.get(id);
  if (!feature) return;

  if (state.isEditingPreset) {
    if (typeof globalThis.togglePresetRegion === "function") {
      globalThis.togglePresetRegion(id);
    }
    return;
  }

  if (state.currentTool === "eraser") {
    delete state.colors[id];
    invalidateBorderCache();
    render();
    return;
  }

  if (state.currentTool === "eyedropper") {
    const picked = state.colors[id];
    if (picked) {
      state.selectedColor = picked;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    }
    return;
  }

  state.colors[id] = state.selectedColor;
  addRecentColor(state.selectedColor);
  invalidateBorderCache();
  render();
}

function calculatePanExtent() {
  const fallback = [
    [-MAP_PAN_PADDING_PX, -MAP_PAN_PADDING_PX],
    [state.width + MAP_PAN_PADDING_PX, state.height + MAP_PAN_PADDING_PX],
  ];

  if (!pathSVG || !state.landData || !state.landData.features?.length) return fallback;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const feature of state.landData.features) {
    const bounds = pathSVG.bounds(feature);
    if (!bounds || bounds.length !== 2) continue;

    const featureMinX = bounds[0][0];
    const featureMinY = bounds[0][1];
    const featureMaxX = bounds[1][0];
    const featureMaxY = bounds[1][1];
    if (![featureMinX, featureMinY, featureMaxX, featureMaxY].every(Number.isFinite)) {
      continue;
    }

    minX = Math.min(minX, featureMinX);
    minY = Math.min(minY, featureMinY);
    maxX = Math.max(maxX, featureMaxX);
    maxY = Math.max(maxY, featureMaxY);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return fallback;

  return [
    [minX - MAP_PAN_PADDING_PX, minY - MAP_PAN_PADDING_PX],
    [maxX + MAP_PAN_PADDING_PX, maxY + MAP_PAN_PADDING_PX],
  ];
}

function updateZoomTranslateExtent() {
  if (!zoomBehavior || state.width <= 0 || state.height <= 0) return;
  zoomBehavior.scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE]);
  zoomBehavior.extent([[0, 0], [state.width, state.height]]);
  zoomBehavior.translateExtent(calculatePanExtent());
}

function updateMap(transform) {
  state.zoomTransform = transform;
  if (viewportGroup) {
    viewportGroup.attr("transform", `translate(${transform.x},${transform.y}) scale(${transform.k})`);
  }
  drawCanvas();
}

function resetZoomToFit() {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  const identity = globalThis.d3.zoomIdentity;
  state.zoomTransform = identity;
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.transform, identity);
}

function enforceZoomConstraints() {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.translateBy, 0, 0);
}

function fitProjection() {
  if (!state.landData?.features?.length || state.width <= 0 || state.height <= 0) {
    return;
  }
  projection.fitSize([state.width, state.height], state.landData);
  buildSpatialIndex();
  updateSpecialZonesPaths();
  updateZoomTranslateExtent();
}

function handleResize() {
  setCanvasSize();
  fitProjection();
  resetZoomToFit();
  enforceZoomConstraints();
  render();
}

function initZoom() {
  zoomBehavior = globalThis.d3
    .zoom()
    .scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE])
    .extent([[0, 0], [state.width, state.height]])
    .on("start", () => {
      state.isInteracting = true;
    })
    .on("zoom", (event) => {
      if (!state.zoomRenderScheduled) {
        state.zoomRenderScheduled = true;
        requestAnimationFrame(() => {
          updateMap(event.transform);
          state.zoomRenderScheduled = false;
        });
      }
    })
    .on("end", (event) => {
      state.isInteracting = false;
      updateMap(event.transform);
      renderHoverOverlay();
    });

  updateZoomTranslateExtent();
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior);
  resetZoomToFit();
  enforceZoomConstraints();
}

function bindEvents() {
  if (!interactionRect) return;
  interactionRect.on("mousemove", handleMouseMove);
  interactionRect.on("mouseleave", () => {
    state.hoveredId = null;
    renderHoverOverlay();
    if (tooltip) tooltip.style.opacity = "0";
  });
  interactionRect.on("click", handleClick);
  window.addEventListener("resize", handleResize);
}

function initMap({ containerId = "mapContainer" } = {}) {
  if (!globalThis.d3) {
    console.error("D3 is required for map renderer.");
    return;
  }

  mapContainer = document.getElementById(containerId);
  textureOverlay = document.getElementById("textureOverlay");
  tooltip = document.getElementById("tooltip");

  if (!mapContainer) {
    console.error("Map container not found.");
    return;
  }

  ensureHybridLayers();

  context = mapCanvas.getContext("2d");
  if (!context) {
    console.error("Canvas 2D context unavailable.");
    return;
  }

  projection = globalThis.d3.geoMercator().precision(PROJECTION_PRECISION);
  projection.clipExtent(null);
  pathSVG = globalThis.d3.geoPath(projection).pointRadius(PATH_POINT_RADIUS);
  pathCanvas = globalThis.d3.geoPath(projection, context).pointRadius(PATH_POINT_RADIUS);
  ensureLayerDataFromTopology();

  state.colorCanvas = mapCanvas;
  state.lineCanvas = null;
  state.colorCtx = context;
  state.lineCtx = null;

  mapCanvas.style.pointerEvents = "none";
  mapCanvas.style.touchAction = "none";
  if (textureOverlay) textureOverlay.style.pointerEvents = "none";

  setCanvasSize();
  buildIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
  initZoom();
  bindEvents();

  render();
}

function setMapData() {
  ensureLayerDataFromTopology();
  buildIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
  resetZoomToFit();
  enforceZoomConstraints();
  drawCanvas();
  render();
}

export { initMap, setMapData, render, autoFillMap, rebuildStaticMeshes, invalidateBorderCache };
