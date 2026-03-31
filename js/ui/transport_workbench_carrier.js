const DEFAULT_ASSET_URL = "data/transport_layers/japan_corridor/carrier.json";

import { t } from "./i18n.js";

const COLOR_TOKENS = {
  sea: "#d8e4ed",
  land: "#f8f5f0",
  coastline: "#6c7b8a",
  shoreGlow: "rgba(255, 255, 255, 0.28)",
  prefecture: "rgba(113, 126, 142, 0.33)",
};

let assetPromise = null;
let mountNode = null;
let svgNode = null;
let cameraNode = null;
let sceneNode = null;
let orientationNode = null;
let resizeObserver = null;
let asset = null;
let activeFamily = "road";
let pointerDrag = null;
let camera = { scale: 1, translateX: 0, translateY: 0, minScale: 1, maxScale: 3 };
let currentLodKey = "overview";
let frameContexts = {};
let rotationQuarterTurns = 0;
let sceneBaseBounds = null;
let viewChangeListener = null;

const overlayRoots = {
  land: { main: null },
  sea: { main: null },
};

function getD3() {
  if (!globalThis.d3 || typeof globalThis.d3.geoConicConformal !== "function") {
    throw new Error("D3 geo projection utilities are unavailable for the transport workbench carrier.");
  }
  return globalThis.d3;
}

function loadAsset() {
  if (!assetPromise) {
    assetPromise = fetch(DEFAULT_ASSET_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load transport workbench carrier asset: ${response.status}`);
      }
      return response.json();
    });
  }
  return assetPromise;
}

function createSvgNode(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getViewBoxSize() {
  return {
    width: Number(asset?.viewBox?.width) || 1600,
    height: Number(asset?.viewBox?.height) || 900,
  };
}

function getSceneBaseBounds() {
  if (sceneBaseBounds) return sceneBaseBounds;
  const extents = Object.values(asset?.frames || {})
    .map((frameDefinition) => frameDefinition?.extent)
    .filter((extent) => extent && Number.isFinite(extent.x) && Number.isFinite(extent.y));
  if (!extents.length) {
    const { width, height } = getViewBoxSize();
    sceneBaseBounds = { x: 0, y: 0, width, height };
    return sceneBaseBounds;
  }
  const minX = Math.min(...extents.map((extent) => extent.x));
  const minY = Math.min(...extents.map((extent) => extent.y));
  const maxX = Math.max(...extents.map((extent) => extent.x + extent.width));
  const maxY = Math.max(...extents.map((extent) => extent.y + extent.height));
  sceneBaseBounds = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
  return sceneBaseBounds;
}

function getOrientationLayout() {
  const baseBounds = getSceneBaseBounds();
  const { width: viewWidth, height: viewHeight } = getViewBoxSize();
  const quarterTurns = ((rotationQuarterTurns % 4) + 4) % 4;
  const rotated = quarterTurns % 2 === 1;
  const rotatedWidth = rotated ? baseBounds.height : baseBounds.width;
  const rotatedHeight = rotated ? baseBounds.width : baseBounds.height;
  const fitScale = Math.min(viewWidth / rotatedWidth, viewHeight / rotatedHeight);
  return {
    quarterTurns,
    fitScale,
    angle: quarterTurns * 90,
    centerX: viewWidth / 2,
    centerY: viewHeight / 2,
    baseCenterX: baseBounds.x + baseBounds.width / 2,
    baseCenterY: baseBounds.y + baseBounds.height / 2,
    bounds: {
      x: (viewWidth - rotatedWidth * fitScale) / 2,
      y: (viewHeight - rotatedHeight * fitScale) / 2,
      width: rotatedWidth * fitScale,
      height: rotatedHeight * fitScale,
    },
  };
}

function getFrameRectPath(frameDefinition) {
  const extent = frameDefinition.extent;
  const x1 = extent.x + extent.width;
  const y1 = extent.y + extent.height;
  return `M ${extent.x} ${extent.y} H ${x1} V ${y1} H ${extent.x} Z`;
}

function createProjection(frameDefinition) {
  const d3 = getD3();
  const projectionConfig = asset.projection || {};
  const projection = d3.geoConicConformal();
  projection.parallels(projectionConfig.parallels || [33, 37]);
  projection.center(projectionConfig.center || [136.5, 35]);
  projection.precision(Number(projectionConfig.precision) || 0.2);

  const extent = frameDefinition.extent;
  projection.fitExtent(
    [
      [extent.x, extent.y],
      [extent.x + extent.width, extent.y + extent.height],
    ],
    frameDefinition.fitGeometry
  );

  return projection;
}

function getLodThresholds() {
  const lodSwitch = asset?.projection?.lodSwitch || {};
  return {
    detailOn: Number(lodSwitch.detailOn) || 1.65,
    overviewOn: Number(lodSwitch.overviewOn) || 1.45,
  };
}

function deriveLodKey(scale) {
  const { detailOn, overviewOn } = getLodThresholds();
  if (currentLodKey === "detail") {
    return scale < overviewOn ? "overview" : "detail";
  }
  return scale > detailOn ? "detail" : "overview";
}

function clampCamera(nextCamera) {
  const { width, height } = getViewBoxSize();
  const orientationBounds = getOrientationLayout().bounds;
  const defaultCamera = asset?.defaultCamera || {};
  const scale = clamp(
    Number(nextCamera.scale) || 1,
    Number(defaultCamera.minScale) || 1,
    Number(defaultCamera.maxScale) || 3
  );
  const scaledWidth = orientationBounds.width * scale;
  const scaledHeight = orientationBounds.height * scale;
  const centeredTranslateX = (width - scaledWidth) / 2 - orientationBounds.x * scale;
  const centeredTranslateY = (height - scaledHeight) / 2 - orientationBounds.y * scale;
  const minTranslateX = scaledWidth <= width
    ? centeredTranslateX
    : width - (orientationBounds.x + orientationBounds.width) * scale;
  const maxTranslateX = scaledWidth <= width
    ? centeredTranslateX
    : -orientationBounds.x * scale;
  const minTranslateY = scaledHeight <= height
    ? centeredTranslateY
    : height - (orientationBounds.y + orientationBounds.height) * scale;
  const maxTranslateY = scaledHeight <= height
    ? centeredTranslateY
    : -orientationBounds.y * scale;
  return {
    scale,
    minScale: Number(defaultCamera.minScale) || 1,
    maxScale: Number(defaultCamera.maxScale) || 3,
    translateX: clamp(Number(nextCamera.translateX) || 0, minTranslateX, maxTranslateX),
    translateY: clamp(Number(nextCamera.translateY) || 0, minTranslateY, maxTranslateY),
  };
}

function syncInteractiveState() {
  if (!mountNode || !svgNode) return;
  const draggable = camera.scale > ((asset?.defaultCamera?.minScale) || 1) + 0.001;
  mountNode.classList.toggle("is-draggable", draggable);
  svgNode.style.cursor = draggable ? (pointerDrag ? "grabbing" : "grab") : "default";
}

function renderFrameLod(frameContext) {
  const frameDefinition = frameContext.definition;
  const lod = frameDefinition.lod[currentLodKey] || frameDefinition.lod.overview;
  const landPath = frameContext.pathGenerator(lod.land) || "";
  const prefecturePath = frameContext.pathGenerator(lod.prefectureLines) || "";
  const seaClipPath = `${frameContext.rectPath} ${landPath}`;

  frameContext.landDefinition.setAttribute("d", landPath);
  frameContext.seaClipPath.setAttribute("d", seaClipPath);
  frameContext.prefectureLines.setAttribute("d", prefecturePath);
}

function renderLodIfNeeded(force = false) {
  const nextLodKey = deriveLodKey(camera.scale);
  if (!force && nextLodKey === currentLodKey) return;
  currentLodKey = nextLodKey;
  Object.values(frameContexts).forEach((frameContext) => {
    renderFrameLod(frameContext);
  });
}

function applyCamera() {
  if (!cameraNode || !orientationNode) return;
  renderLodIfNeeded();
  const orientationLayout = getOrientationLayout();
  cameraNode.setAttribute(
    "transform",
    `translate(${camera.translateX} ${camera.translateY}) scale(${camera.scale})`
  );
  orientationNode.setAttribute(
    "transform",
    `translate(${orientationLayout.centerX} ${orientationLayout.centerY}) rotate(${orientationLayout.angle}) scale(${orientationLayout.fitScale}) translate(${-orientationLayout.baseCenterX} ${-orientationLayout.baseCenterY})`
  );
  syncInteractiveState();
  viewChangeListener?.(getTransportWorkbenchCarrierViewState());
}

function getViewBoxPointerPosition(event) {
  if (!svgNode || !asset) return null;
  const bounds = svgNode.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const { width, height } = getViewBoxSize();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * width,
    y: ((event.clientY - bounds.top) / bounds.height) * height,
  };
}

function zoomAroundPoint(targetScale, point) {
  if (!asset || !point) return;
  const defaultCamera = asset.defaultCamera || {};
  const nextScale = clamp(
    targetScale,
    Number(defaultCamera.minScale) || 1,
    Number(defaultCamera.maxScale) || 3
  );
  const worldX = (point.x - camera.translateX) / camera.scale;
  const worldY = (point.y - camera.translateY) / camera.scale;
  camera = clampCamera({
    scale: nextScale,
    translateX: point.x - worldX * nextScale,
    translateY: point.y - worldY * nextScale,
  });
  applyCamera();
}

function bindInteractions() {
  if (!svgNode || svgNode.dataset.bound === "true") return;

  svgNode.addEventListener(
    "wheel",
    (event) => {
      if (!asset) return;
      event.preventDefault();
      const point = getViewBoxPointerPosition(event);
      if (!point) return;
      const deltaScale = event.deltaY < 0 ? 1.12 : 0.9;
      zoomAroundPoint(camera.scale * deltaScale, point);
    },
    { passive: false }
  );

  svgNode.addEventListener("pointerdown", (event) => {
    if (!asset || event.button !== 0 || camera.scale <= ((asset.defaultCamera?.minScale) || 1) + 0.001) {
      return;
    }
    const point = getViewBoxPointerPosition(event);
    if (!point) return;
    pointerDrag = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      originTranslateX: camera.translateX,
      originTranslateY: camera.translateY,
    };
    svgNode.setPointerCapture?.(event.pointerId);
    syncInteractiveState();
  });

  svgNode.addEventListener("pointermove", (event) => {
    if (!pointerDrag) return;
    const point = getViewBoxPointerPosition(event);
    if (!point) return;
    camera = clampCamera({
      ...camera,
      translateX: pointerDrag.originTranslateX + (point.x - pointerDrag.startX),
      translateY: pointerDrag.originTranslateY + (point.y - pointerDrag.startY),
    });
    applyCamera();
  });

  const releasePointer = (event) => {
    if (!pointerDrag) return;
    if (event && pointerDrag.pointerId !== undefined && event.pointerId !== pointerDrag.pointerId) return;
    pointerDrag = null;
    syncInteractiveState();
  };

  svgNode.addEventListener("pointerup", releasePointer);
  svgNode.addEventListener("pointercancel", releasePointer);
  svgNode.addEventListener("pointerleave", releasePointer);
  svgNode.dataset.bound = "true";
}

function buildFrame(frameId, frameDefinition, defs, scene) {
  const projection = createProjection(frameDefinition);
  const d3 = getD3();
  const pathGenerator = d3.geoPath(projection);
  const rectPath = getFrameRectPath(frameDefinition);

  const frameLayer = createSvgNode("g");
  frameLayer.classList.add("transport-workbench-carrier-frame", `transport-workbench-carrier-frame-${frameId}`);

  const landDefinitionId = `transportWorkbenchCarrierLandDef-${frameId}`;
  const landClipId = `transportWorkbenchCarrierLandClip-${frameId}`;
  const seaClipId = `transportWorkbenchCarrierSeaClip-${frameId}`;

  const landDefinition = createSvgNode("path");
  landDefinition.setAttribute("id", landDefinitionId);
  landDefinition.setAttribute("fill-rule", "evenodd");

  const landClip = createSvgNode("clipPath");
  landClip.setAttribute("id", landClipId);
  const landClipUse = createSvgNode("use");
  landClipUse.setAttribute("href", `#${landDefinitionId}`);
  landClip.appendChild(landClipUse);

  const seaClip = createSvgNode("clipPath");
  seaClip.setAttribute("id", seaClipId);
  const seaClipPath = createSvgNode("path");
  seaClipPath.setAttribute("fill-rule", "evenodd");
  seaClipPath.setAttribute("clip-rule", "evenodd");
  seaClip.appendChild(seaClipPath);

  defs.append(landDefinition, landClip, seaClip);

  const seaOverlay = createSvgNode("g");
  seaOverlay.classList.add("transport-workbench-carrier-overlay", "transport-workbench-carrier-overlay-sea");
  seaOverlay.setAttribute("clip-path", `url(#${seaClipId})`);

  const shoreGlow = createSvgNode("use");
  shoreGlow.setAttribute("href", `#${landDefinitionId}`);
  shoreGlow.setAttribute("fill", "none");
  shoreGlow.setAttribute("stroke", COLOR_TOKENS.shoreGlow);
  shoreGlow.setAttribute("stroke-linecap", "round");
  shoreGlow.setAttribute("stroke-linejoin", "round");
  shoreGlow.setAttribute("stroke-width", "8");
  shoreGlow.setAttribute("opacity", "0.34");
  shoreGlow.setAttribute("vector-effect", "non-scaling-stroke");

  const landBase = createSvgNode("use");
  landBase.setAttribute("href", `#${landDefinitionId}`);
  landBase.setAttribute("fill", COLOR_TOKENS.land);

  const prefectureLines = createSvgNode("path");
  prefectureLines.setAttribute("fill", "none");
  prefectureLines.setAttribute("stroke", COLOR_TOKENS.prefecture);
  prefectureLines.setAttribute("stroke-linecap", "round");
  prefectureLines.setAttribute("stroke-linejoin", "round");
  prefectureLines.setAttribute("stroke-width", "0.65");
  prefectureLines.setAttribute("vector-effect", "non-scaling-stroke");

  const coastline = createSvgNode("use");
  coastline.setAttribute("href", `#${landDefinitionId}`);
  coastline.setAttribute("fill", "none");
  coastline.setAttribute("stroke", COLOR_TOKENS.coastline);
  coastline.setAttribute("stroke-linecap", "round");
  coastline.setAttribute("stroke-linejoin", "round");
  coastline.setAttribute("stroke-width", "1.8");
  coastline.setAttribute("opacity", "0.9");
  coastline.setAttribute("vector-effect", "non-scaling-stroke");

  const landOverlay = createSvgNode("g");
  landOverlay.classList.add("transport-workbench-carrier-overlay", "transport-workbench-carrier-overlay-land");
  landOverlay.setAttribute("clip-path", `url(#${landClipId})`);

  frameLayer.append(seaOverlay, shoreGlow, landBase, prefectureLines, coastline, landOverlay);
  scene.appendChild(frameLayer);

  overlayRoots.land[frameId] = landOverlay;
  overlayRoots.sea[frameId] = seaOverlay;

  return {
    definition: frameDefinition,
    frameLayer,
    rectPath,
    projection,
    pathGenerator,
    routeMask: frameDefinition.routeMask,
    landDefinition,
    seaClipPath,
    prefectureLines,
  };
}

function buildCarrierSvg(carrierAsset) {
  const svg = createSvgNode("svg");
  svg.classList.add("transport-workbench-carrier-svg");
  svg.setAttribute("viewBox", `0 0 ${carrierAsset.viewBox.width} ${carrierAsset.viewBox.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("Japan transport workbench carrier", "ui"));

  const defs = createSvgNode("defs");
  const seaBackground = createSvgNode("rect");
  seaBackground.setAttribute("x", "0");
  seaBackground.setAttribute("y", "0");
  seaBackground.setAttribute("width", String(carrierAsset.viewBox.width));
  seaBackground.setAttribute("height", String(carrierAsset.viewBox.height));
  seaBackground.setAttribute("fill", COLOR_TOKENS.sea);

  const cameraLayer = createSvgNode("g");
  cameraLayer.classList.add("transport-workbench-carrier-camera");
  const orientationLayer = createSvgNode("g");
  orientationLayer.classList.add("transport-workbench-carrier-orientation");
  const scene = createSvgNode("g");
  scene.classList.add("transport-workbench-carrier-scene");

  frameContexts = {};
  sceneBaseBounds = null;
  Object.entries(carrierAsset.frames || {}).forEach(([frameId, frameDefinition]) => {
    frameContexts[frameId] = buildFrame(frameId, frameDefinition, defs, scene);
  });

  orientationLayer.appendChild(scene);
  cameraLayer.appendChild(orientationLayer);
  svg.append(defs, seaBackground, cameraLayer);
  return { svg, cameraLayer, scene, orientationLayer };
}

function ensureResizeObserver() {
  if (!mountNode || resizeObserver) return;
  resizeObserver = new ResizeObserver(() => {
    syncInteractiveState();
  });
  resizeObserver.observe(mountNode);
}

function resolveTransportWorkbenchCarrierFrame(lon, lat, preferredFrame) {
  if (!asset) return null;
  const d3 = getD3();
  if (preferredFrame && frameContexts[preferredFrame]) {
    return d3.geoContains(frameContexts[preferredFrame].routeMask, [lon, lat]) ? preferredFrame : null;
  }
  return frameContexts.main && d3.geoContains(frameContexts.main.routeMask, [lon, lat]) ? "main" : null;
}

export function projectTransportWorkbenchCarrierPoint(lon, lat, preferredFrame = null) {
  const frameId = resolveTransportWorkbenchCarrierFrame(lon, lat, preferredFrame);
  if (!frameId) return null;
  const projected = frameContexts[frameId]?.projection?.([lon, lat]);
  if (!projected || projected.length < 2) return null;
  return { frameId, x: projected[0], y: projected[1] };
}

function projectCoordinates(coordinates, projector) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (!Array.isArray(coordinates[0])) {
    const projected = projector(coordinates);
    return projected ? [projected[0], projected[1]] : [NaN, NaN];
  }
  return coordinates.map((part) => projectCoordinates(part, projector));
}

export function projectTransportWorkbenchCarrierGeometry(geometry, frameId) {
  if (!geometry || typeof geometry !== "object" || !frameContexts[frameId]) {
    return null;
  }
  const projector = frameContexts[frameId].projection;
  const type = String(geometry.type || "");
  if (!type || !Array.isArray(geometry.coordinates)) {
    return null;
  }
  return {
    frameId,
    geometry: {
      type,
      coordinates: projectCoordinates(geometry.coordinates, projector),
    },
  };
}

export async function ensureTransportWorkbenchCarrier(nextMountNode) {
  if (!nextMountNode) return null;
  mountNode = nextMountNode;
  mountNode.dataset.transportFamily = activeFamily;
  asset = await loadAsset();
  if (!svgNode) {
    const built = buildCarrierSvg(asset);
    svgNode = built.svg;
    cameraNode = built.cameraLayer;
    sceneNode = built.scene;
    orientationNode = built.orientationLayer;
    currentLodKey = "overview";
    camera = clampCamera(asset.defaultCamera || camera);
    renderLodIfNeeded(true);
    applyCamera();
    bindInteractions();
  }
  if (!mountNode.contains(svgNode)) {
    mountNode.replaceChildren(svgNode);
  }
  ensureResizeObserver();
  syncInteractiveState();
  return {
    land: overlayRoots.land,
    sea: overlayRoots.sea,
  };
}

export function setTransportWorkbenchCarrierFamily(familyId) {
  activeFamily = String(familyId || "road");
  if (mountNode) {
    mountNode.dataset.transportFamily = activeFamily;
  }
  if (svgNode) {
    svgNode.dataset.transportFamily = activeFamily;
  }
}

export function resetTransportWorkbenchCarrierView() {
  if (!asset) return;
  rotationQuarterTurns = 0;
  camera = clampCamera(asset.defaultCamera || camera);
  applyCamera();
}

export function stepTransportWorkbenchCarrierZoom(direction) {
  if (!asset || !svgNode) return;
  const { width, height } = getViewBoxSize();
  const factor = Number(direction) >= 0 ? 1.16 : 1 / 1.16;
  zoomAroundPoint(camera.scale * factor, { x: width / 2, y: height / 2 });
}

export function toggleTransportWorkbenchCarrierQuarterTurn() {
  if (!asset) return 0;
  rotationQuarterTurns = rotationQuarterTurns === 0 ? 1 : 0;
  camera = clampCamera({ ...camera });
  applyCamera();
  return rotationQuarterTurns;
}

export function getTransportWorkbenchCarrierViewState() {
  return {
    scale: camera.scale,
    translateX: camera.translateX,
    translateY: camera.translateY,
    quarterTurns: rotationQuarterTurns,
  };
}

export function resizeTransportWorkbenchCarrier() {
  syncInteractiveState();
}

export function setTransportWorkbenchCarrierViewChangeListener(listener) {
  viewChangeListener = typeof listener === "function" ? listener : null;
}

export function destroyTransportWorkbenchCarrier() {
  pointerDrag = null;
  rotationQuarterTurns = 0;
  viewChangeListener = null;
  if (asset?.defaultCamera) {
    camera = clampCamera(asset.defaultCamera);
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (mountNode && svgNode && mountNode.contains(svgNode)) {
    mountNode.replaceChildren();
  }
  mountNode = null;
  svgNode = null;
  cameraNode = null;
  sceneNode = null;
  orientationNode = null;
  frameContexts = {};
  sceneBaseBounds = null;
  overlayRoots.land.main = null;
  overlayRoots.sea.main = null;
}

export function getTransportWorkbenchCarrierOverlayRoots() {
  return {
    land: overlayRoots.land,
    sea: overlayRoots.sea,
  };
}

export { resolveTransportWorkbenchCarrierFrame };
