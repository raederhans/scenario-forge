// Rendering engine (Phase 13)
import { state } from "./state.js";
import { LegendManager } from "./legend_manager.js";
import { getTooltipText } from "../ui/i18n.js";

let mapContainer = null;
let colorCanvas = null;
let lineCanvas = null;
let textureOverlay = null;
let tooltip = null;
let colorCtx = null;
let lineCtx = null;
let hitCanvas = null;
let hitCtx = null;
let specialZonesSvg = null;
let specialZonesGroup = null;
let specialZonesPath = null;
let legendSvg = null;
let legendGroup = null;
let legendItemsGroup = null;
let legendBackground = null;
let lastLegendKey = null;

let projection = null;
let boundsPath = null;
let colorPath = null;
let linePath = null;
let hitPath = null;

function pathBoundsInScreen(feature) {
  if (!boundsPath) return false;
  const bounds = boundsPath.bounds(feature);
  const minX = bounds[0][0] * state.zoomTransform.k + state.zoomTransform.x;
  const minY = bounds[0][1] * state.zoomTransform.k + state.zoomTransform.y;
  const maxX = bounds[1][0] * state.zoomTransform.k + state.zoomTransform.x;
  const maxY = bounds[1][1] * state.zoomTransform.k + state.zoomTransform.y;
  return !(maxX < 0 || maxY < 0 || minX > state.width || minY > state.height);
}

function getFeatureId(feature) {
  return (
    feature?.properties?.id ||
    feature?.properties?.NUTS_ID ||
    feature?.id ||
    null
  );
}

function getColorsHash() {
  const entries = Object.entries(state.colors).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
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

function absoluteClear(ctx, canvas) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function applyTransform(ctx) {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.translate(state.zoomTransform.x, state.zoomTransform.y);
  ctx.scale(state.zoomTransform.k, state.zoomTransform.k);
}

function buildSpecialZonePatterns(defs) {
  defs.select("#pattern-disputed").remove();
  defs.select("#pattern-wasteland").remove();
  const disputed = defs
    .append("pattern")
    .attr("id", "pattern-disputed")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternTransform", "rotate(45)");
  disputed
    .append("line")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 0)
    .attr("y2", 6)
    .attr("stroke", "#f97316")
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.7);

  const wasteland = defs
    .append("pattern")
    .attr("id", "pattern-wasteland")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", 6)
    .attr("height", 6);
  wasteland
    .append("path")
    .attr("d", "M0 0 L6 6 M6 0 L0 6")
    .attr("stroke", "#39ff14")
    .attr("stroke-width", 1)
    .attr("stroke-opacity", 0.65);
}

function initSpecialZonesSvg() {
  if (!mapContainer || !globalThis.d3) return;
  let svgNode = document.getElementById("specialZonesSvg");
  if (!svgNode) {
    svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("id", "specialZonesSvg");
    svgNode.classList.add("map-layer", "map-layer-top");
    svgNode.style.pointerEvents = "none";
    if (lineCanvas && mapContainer.contains(lineCanvas)) {
      mapContainer.insertBefore(svgNode, lineCanvas);
    } else {
      mapContainer.appendChild(svgNode);
    }
  }
  specialZonesSvg = globalThis.d3.select(svgNode);
  specialZonesSvg
    .attr("width", state.width)
    .attr("height", state.height)
    .style("position", "absolute")
    .style("inset", "0");

  let defs = specialZonesSvg.select("defs");
  if (defs.empty()) {
    defs = specialZonesSvg.append("defs");
  }
  buildSpecialZonePatterns(defs);

  specialZonesGroup = specialZonesSvg.select("g.special-zones-layer");
  if (specialZonesGroup.empty()) {
    specialZonesGroup = specialZonesSvg.append("g").attr("class", "special-zones-layer");
  }
  specialZonesPath = globalThis.d3.geoPath(projection);
}

function resizeSpecialZonesSvg() {
  if (!specialZonesSvg) return;
  specialZonesSvg.attr("width", state.width).attr("height", state.height);
}

function resizeLegendSvg() {
  if (!legendSvg) return;
  legendSvg.attr("width", state.width).attr("height", state.height);
}

function initLegendSvg() {
  if (!mapContainer || !globalThis.d3) return;
  let svgNode = document.getElementById("legendSvg");
  if (!svgNode) {
    svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgNode.setAttribute("id", "legendSvg");
    svgNode.classList.add("map-layer", "map-layer-top");
    svgNode.style.pointerEvents = "none";
    mapContainer.appendChild(svgNode);
  }
  legendSvg = globalThis.d3.select(svgNode);
  legendSvg
    .attr("width", state.width)
    .attr("height", state.height)
    .style("position", "absolute")
    .style("inset", "0");

  initLegendGroup();
}

function initLegendGroup() {
  if (!legendSvg) return;
  legendGroup = legendSvg.select("g.legend-group");
  if (legendGroup.empty()) {
    legendGroup = legendSvg.append("g").attr("class", "legend-group");
    legendGroup.attr("pointer-events", "none");
  }

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
}

export function renderLegend(uniqueColors = null, labels = null) {
  if (!legendSvg) {
    initLegendSvg();
  }
  if (!legendSvg) return;
  initLegendGroup();
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

function getSpecialZoneFill(feature) {
  const zoneType = feature?.properties?.type || "";
  if (zoneType === "disputed") return "url(#pattern-disputed)";
  if (zoneType === "wasteland") return "url(#pattern-wasteland)";
  return "none";
}

function getSpecialZoneStroke(feature) {
  const zoneType = feature?.properties?.type || "";
  if (zoneType === "disputed") return "#f97316";
  if (zoneType === "wasteland") return "#dc2626";
  return "#111827";
}

function updateSpecialZonesPaths() {
  if (!specialZonesGroup || !specialZonesPath) return;
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
    .attr("fill", (d) => getSpecialZoneFill(d))
    .attr("stroke", (d) => getSpecialZoneStroke(d))
    .attr("stroke-width", 1.1)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("opacity", 0.85)
    .merge(selection)
    .attr("d", specialZonesPath)
    .attr("fill", (d) => getSpecialZoneFill(d))
    .attr("stroke", (d) => getSpecialZoneStroke(d));

  selection.exit().remove();
}

function renderSpecialZones() {
  if (!specialZonesGroup) return;
  if (!state.showSpecialZones) {
    specialZonesGroup.attr("display", "none");
    return;
  }
  specialZonesGroup.attr("display", null);
  const t = state.zoomTransform;
  specialZonesGroup.attr("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
}

function renderColorLayer() {
  if (!state.landData || !colorCtx) return;
  const k = state.zoomTransform.k;

  absoluteClear(colorCtx, colorCanvas);
  applyTransform(colorCtx);

  if (state.landBgData) {
    colorCtx.beginPath();
    colorPath(state.landBgData);
    colorCtx.fillStyle = "#e4e4e4";
    colorCtx.fill();
  }

  colorCtx.fillStyle = "#d6d6d6";
  for (const feature of state.landData.features) {
    if ((k < 2 && boundsPath.area(feature) * k * k < state.TINY_AREA) || !pathBoundsInScreen(feature)) {
      continue;
    }
    colorCtx.beginPath();
    colorPath(feature);
    colorCtx.fill();
  }

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id || !state.colors[id]) continue;
    if ((k < 2 && boundsPath.area(feature) * k * k < state.TINY_AREA) || !pathBoundsInScreen(feature)) {
      continue;
    }
    colorCtx.fillStyle = state.colors[id];
    colorCtx.beginPath();
    colorPath(feature);
    colorCtx.fill();
  }
}

function renderLineLayer() {
  if (!state.landData || !lineCtx) return;
  const k = state.zoomTransform.k;

  absoluteClear(lineCtx, lineCanvas);
  applyTransform(lineCtx);
  lineCtx.lineJoin = "round";
  lineCtx.lineCap = "round";
  const internalOpacityBase = k < 2 ? 0.3 : k < 4 ? 0.6 : 0.85;
  const internalWidth =
    (state.styleConfig.internalBorders.width * (k < 3 ? 0.6 : 1.6)) / k;
  const empireWidth =
    (state.styleConfig.empireBorders.width * (k < 2 ? 1.5 : 1.2)) / k;
  const coastlineWidth =
    (state.styleConfig.coastlines.width * (k < 2 ? 0.9 : 1.1)) / k;

  if (state.showPhysical && state.physicalData) {
    for (const feature of state.physicalData.features) {
      if ((k < 2 && boundsPath.area(feature) * k * k < state.TINY_AREA) || !pathBoundsInScreen(feature)) {
        continue;
      }
      lineCtx.globalAlpha = 0.15;
      lineCtx.fillStyle = "#ffffff";
      lineCtx.beginPath();
      linePath(feature);
      lineCtx.fill();
    }
  }

  if (state.showUrban && state.urbanData) {
    lineCtx.save();
    lineCtx.globalAlpha = 0.2;
    lineCtx.fillStyle = "#999999";
    for (const feature of state.urbanData.features) {
      if ((k < 2 && boundsPath.area(feature) * k * k < state.TINY_AREA) || !pathBoundsInScreen(feature)) {
        continue;
      }
      lineCtx.beginPath();
      linePath(feature);
      lineCtx.fill();
    }
    lineCtx.restore();
  }

  lineCtx.globalAlpha = 1;

  if (state.topology && state.topology.objects?.political) {
    const coastlines = state.cachedCoastlines;
    if (coastlines) {
      lineCtx.globalAlpha = 1;
      lineCtx.beginPath();
      linePath(coastlines);
      lineCtx.strokeStyle = state.styleConfig.coastlines.color;
      lineCtx.lineWidth = coastlineWidth;
      lineCtx.stroke();
    }

    const gridLines = state.cachedGridLines;
    if (gridLines) {
      lineCtx.globalAlpha =
        state.styleConfig.internalBorders.opacity * internalOpacityBase;
      lineCtx.beginPath();
      linePath(gridLines);
      lineCtx.strokeStyle = state.styleConfig.internalBorders.color;
      lineCtx.lineWidth = internalWidth;
      lineCtx.stroke();
    }

    rebuildDynamicBorders();
    const dynamicBorders = state.cachedBorders;
    if (dynamicBorders) {
      lineCtx.globalAlpha = 1;
      lineCtx.beginPath();
      linePath(dynamicBorders);
      lineCtx.strokeStyle = state.styleConfig.empireBorders.color;
      lineCtx.lineWidth = empireWidth;
      lineCtx.stroke();
    }
  }

  if (state.showRivers && state.riversData) {
    lineCtx.beginPath();
    linePath(state.riversData);
    lineCtx.strokeStyle = "#3498db";
    lineCtx.lineWidth = 1 / k;
    lineCtx.stroke();
  }

  if (state.isEditingPreset && state.editingPresetIds.size > 0) {
    lineCtx.save();
    lineCtx.globalAlpha = 0.9;
    lineCtx.strokeStyle = "#f97316";
    lineCtx.lineWidth = 2 / k;
    for (const id of state.editingPresetIds) {
      const feature = state.landIndex.get(id);
      if (!feature) continue;
      if (!pathBoundsInScreen(feature)) continue;
      lineCtx.beginPath();
      linePath(feature);
      lineCtx.stroke();
    }
    lineCtx.restore();
  }

  drawHover();
  markHitDirty();
}

function render() {
  renderColorLayer();
  renderSpecialZones();
  renderLineLayer();
  renderLegend();
  if (typeof state.updateLegendUI === "function") {
    state.updateLegendUI();
  }
}

function drawHover() {
  const k = state.zoomTransform.k;
  if (state.hoveredId && state.landIndex.has(state.hoveredId)) {
    const feature = state.landIndex.get(state.hoveredId);
    if (!((k < 2 && boundsPath.area(feature) * k * k < state.TINY_AREA) || !pathBoundsInScreen(feature))) {
      lineCtx.beginPath();
      linePath(feature);
      lineCtx.strokeStyle = "#f1c40f";
      lineCtx.lineWidth = 2 / k;
      lineCtx.stroke();
    }
  }
}

function markHitDirty() {
  state.hitCanvasDirty = true;
}

function drawHidden() {
  if (!state.landData || !state.hitCanvasDirty) return;
  state.hitCanvasDirty = false;

  absoluteClear(hitCtx, hitCanvas);
  applyTransform(hitCtx);

  for (const feature of state.landData.features) {
    const id = feature.properties?.id || feature.properties?.NUTS_ID;
    const key = state.idToKey.get(id);
    if (!key) continue;
    if (!pathBoundsInScreen(feature)) continue;
    const r = (key >> 16) & 255;
    const g = (key >> 8) & 255;
    const b = key & 255;
    hitCtx.fillStyle = `rgb(${r},${g},${b})`;
    hitCtx.beginPath();
    hitPath(feature);
    hitCtx.fill();
  }
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
  if (!state.landData || !state.landData.features) return;

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id) continue;
    const bounds = boundsPath.bounds(feature);
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
    .x((d) => d.cx)
    .y((d) => d.cy)
    .addAll(state.spatialItems);
}

function getFeatureIdFromEvent(event) {
  if (!state.landData) return null;
  const [sx, sy] = globalThis.d3.pointer(event, colorCanvas);
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
          const d = current.data;
          if (d && px >= d.minX && px <= d.maxX && py >= d.minY && py <= d.maxY) {
            candidates.push(d);
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

function handleMouseMove(event) {
  const now = performance.now();
  if (now - state.lastMouseMoveTime < state.MOUSE_THROTTLE_MS) return;
  state.lastMouseMoveTime = now;
  if (!state.landData) return;
  if (state.isInteracting) return;
  const id = getFeatureIdFromEvent(event);
  if (id !== state.hoveredId) {
    state.hoveredId = id;
    drawHover();
  }

  if (!tooltip) return;
  if (id && state.landIndex.has(id)) {
    const feature = state.landIndex.get(id);
    const text = getTooltipText(feature);
    tooltip.textContent = text;
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.opacity = "1";
  } else {
    tooltip.style.opacity = "0";
  }
}

function paintSingleRegion(feature, color) {
  colorCtx.save();
  applyTransform(colorCtx);
  colorCtx.fillStyle = color;
  colorCtx.beginPath();
  colorPath(feature);
  colorCtx.fill();
  colorCtx.restore();
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
  } else if (state.currentTool === "eyedropper") {
    const picked = state.colors[id];
    if (picked) {
      state.selectedColor = picked;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    }
  } else {
    state.colors[id] = state.selectedColor;
    addRecentColor(state.selectedColor);
    paintSingleRegion(feature, state.selectedColor);
    invalidateBorderCache();
    renderLineLayer();
  }
}

function setCanvasSize() {
  state.dpr = globalThis.devicePixelRatio || 1;

  const container = mapContainer || colorCanvas.parentElement;
  state.width = colorCanvas.clientWidth || container?.clientWidth || globalThis.innerWidth;
  state.height = colorCanvas.clientHeight || container?.clientHeight || globalThis.innerHeight;

  if (state.width < 100) state.width = globalThis.innerWidth - 580;
  if (state.height < 100) state.height = globalThis.innerHeight;

  const scaledW = Math.floor(state.width * state.dpr);
  const scaledH = Math.floor(state.height * state.dpr);

  colorCanvas.width = scaledW;
  colorCanvas.height = scaledH;
  lineCanvas.width = scaledW;
  lineCanvas.height = scaledH;
  hitCanvas.width = scaledW;
  hitCanvas.height = scaledH;
  resizeSpecialZonesSvg();
}

function fitProjection() {
  if (!state.landData || !state.landData.features || state.landData.features.length === 0) {
    console.warn("fitProjection: No land data available");
    return;
  }
  if (state.width <= 0 || state.height <= 0) {
    console.warn("fitProjection: Invalid dimensions", { width: state.width, height: state.height });
    return;
  }
  projection.fitSize([state.width, state.height], state.landData);
}

function handleResize() {
  setCanvasSize();
  fitProjection();
  buildSpatialIndex();
  updateSpecialZonesPaths();
  resizeLegendSvg();
  render();
}

export function initMap({ containerId = "mapContainer" } = {}) {
  if (!globalThis.d3) {
    console.error("D3 is required for map renderer.");
    return;
  }

  mapContainer = document.getElementById(containerId);
  colorCanvas = document.getElementById("colorCanvas");
  lineCanvas = document.getElementById("lineCanvas");
  textureOverlay = document.getElementById("textureOverlay");
  tooltip = document.getElementById("tooltip");

  if (!colorCanvas || !lineCanvas) {
    console.error("Canvas elements not found.");
    return;
  }

  colorCtx = colorCanvas.getContext("2d");
  lineCtx = lineCanvas.getContext("2d");
  hitCanvas = document.createElement("canvas");
  hitCtx = hitCanvas.getContext("2d", { willReadFrequently: true });

  projection = globalThis.d3.geoMercator();
  boundsPath = globalThis.d3.geoPath(projection);
  colorPath = globalThis.d3.geoPath(projection, colorCtx);
  linePath = globalThis.d3.geoPath(projection, lineCtx);
  hitPath = globalThis.d3.geoPath(projection, hitCtx);

  state.colorCanvas = colorCanvas;
  state.lineCanvas = lineCanvas;
  state.colorCtx = colorCtx;
  state.lineCtx = lineCtx;

  setCanvasSize();
  if (state.landData) {
    fitProjection();
  }

  initSpecialZonesSvg();
  initLegendSvg();
  updateSpecialZonesPaths();

  buildIndex();
  buildSpatialIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();

  const zoom = globalThis.d3
    .zoom()
    .scaleExtent([1, 50])
    .on("start", () => {
      state.isInteracting = true;
    })
    .on("zoom", (event) => {
      state.zoomTransform = event.transform;
      if (!state.zoomRenderScheduled) {
        state.zoomRenderScheduled = true;
        requestAnimationFrame(() => {
          render();
          state.zoomRenderScheduled = false;
        });
      }
    })
    .on("end", (event) => {
      state.zoomTransform = event.transform;
      state.isInteracting = false;
      render();
    });

  globalThis.d3.select(colorCanvas).call(zoom);

  colorCanvas.addEventListener("mousemove", handleMouseMove);
  colorCanvas.addEventListener("click", handleClick);
  window.addEventListener("resize", handleResize);

  colorCanvas.style.pointerEvents = "auto";
  lineCanvas.style.pointerEvents = "none";
  if (textureOverlay) {
    textureOverlay.style.pointerEvents = "none";
  }

  colorCanvas.style.touchAction = "none";
}

export function setMapData() {
  buildIndex();
  buildSpatialIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
  updateSpecialZonesPaths();
}

export { render, rebuildStaticMeshes, invalidateBorderCache };
