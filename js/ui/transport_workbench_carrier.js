const DEFAULT_ASSET_URL = "data/transport_layers/japan_corridor/carrier.json";

const COLOR_TOKENS = {
  sea: "#d8e4ed",
  seaInset: "rgba(255, 255, 255, 0.5)",
  land: "#f8f5f0",
  coastline: "#6c7b8a",
  shoreGlow: "rgba(255, 255, 255, 0.28)",
};

let assetPromise = null;
let mountNode = null;
let svgNode = null;
let sceneNode = null;
let landOverlayRoot = null;
let seaOverlayRoot = null;
let resizeObserver = null;
let camera = { scale: 1, translateX: 0, translateY: 0, minScale: 1, maxScale: 3.4 };
let asset = null;
let activeFamily = "road";
let pointerDrag = null;

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

function applyCamera() {
  if (!sceneNode) return;
  sceneNode.setAttribute(
    "transform",
    `translate(${camera.translateX} ${camera.translateY}) scale(${camera.scale})`
  );
  syncInteractiveState();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampCamera(nextCamera) {
  if (!asset) return nextCamera;
  const width = Number(asset.viewBox?.width) || 1600;
  const height = Number(asset.viewBox?.height) || 900;
  const scale = clamp(
    Number(nextCamera.scale) || 1,
    Number(asset.defaultCamera?.minScale) || 1,
    Number(asset.defaultCamera?.maxScale) || 3.4
  );
  const minTranslateX = width * (1 - scale);
  const minTranslateY = height * (1 - scale);
  return {
    scale,
    minScale: Number(asset.defaultCamera?.minScale) || 1,
    maxScale: Number(asset.defaultCamera?.maxScale) || 3.4,
    translateX: clamp(Number(nextCamera.translateX) || 0, minTranslateX, 0),
    translateY: clamp(Number(nextCamera.translateY) || 0, minTranslateY, 0),
  };
}

function syncInteractiveState() {
  if (!mountNode || !svgNode) return;
  const draggable = camera.scale > ((asset?.defaultCamera?.minScale) || 1) + 0.001;
  mountNode.classList.toggle("is-draggable", draggable);
  svgNode.style.cursor = draggable ? (pointerDrag ? "grabbing" : "grab") : "default";
}

function getViewBoxPointerPosition(event) {
  if (!svgNode || !asset) return null;
  const bounds = svgNode.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const width = Number(asset.viewBox?.width) || 1600;
  const height = Number(asset.viewBox?.height) || 900;
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * width,
    y: ((event.clientY - bounds.top) / bounds.height) * height,
  };
}

function zoomAroundPoint(targetScale, point) {
  if (!asset || !point) return;
  const nextScale = clamp(
    targetScale,
    Number(asset.defaultCamera?.minScale) || 1,
    Number(asset.defaultCamera?.maxScale) || 3.4
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

  svgNode.addEventListener("wheel", (event) => {
    if (!asset) return;
    event.preventDefault();
    const point = getViewBoxPointerPosition(event);
    if (!point) return;
    const deltaScale = event.deltaY < 0 ? 1.12 : 0.9;
    zoomAroundPoint(camera.scale * deltaScale, point);
  }, { passive: false });

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

function buildCarrierSvg(carrierAsset) {
  const svg = createSvgNode("svg");
  svg.classList.add("transport-workbench-carrier-svg");
  svg.setAttribute("viewBox", `0 0 ${carrierAsset.viewBox.width} ${carrierAsset.viewBox.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Japan corridor carrier");

  const defs = createSvgNode("defs");
  const landClip = createSvgNode("clipPath");
  landClip.setAttribute("id", "transportWorkbenchLandClip");
  const landClipPath = createSvgNode("path");
  landClipPath.setAttribute("d", carrierAsset.paths.landMask);
  landClipPath.setAttribute("fill-rule", "evenodd");
  landClip.appendChild(landClipPath);

  const seaClip = createSvgNode("clipPath");
  seaClip.setAttribute("id", "transportWorkbenchSeaClip");
  const seaClipPath = createSvgNode("path");
  seaClipPath.setAttribute("d", carrierAsset.paths.seaMask);
  seaClipPath.setAttribute("fill-rule", "evenodd");
  seaClip.appendChild(seaClipPath);
  defs.append(landClip, seaClip);
  svg.appendChild(defs);

  const seaBackground = createSvgNode("rect");
  seaBackground.setAttribute("x", "0");
  seaBackground.setAttribute("y", "0");
  seaBackground.setAttribute("width", String(carrierAsset.viewBox.width));
  seaBackground.setAttribute("height", String(carrierAsset.viewBox.height));
  seaBackground.setAttribute("fill", COLOR_TOKENS.sea);

  const seaInset = createSvgNode("path");
  seaInset.setAttribute("d", carrierAsset.paths.seaMask);
  seaInset.setAttribute("fill", COLOR_TOKENS.seaInset);
  seaInset.setAttribute("fill-rule", "evenodd");
  seaInset.setAttribute("opacity", "0.42");

  const scene = createSvgNode("g");
  scene.classList.add("transport-workbench-carrier-scene");

  const seaOverlay = createSvgNode("g");
  seaOverlay.classList.add("transport-workbench-carrier-overlay", "transport-workbench-carrier-overlay-sea");
  seaOverlay.setAttribute("clip-path", "url(#transportWorkbenchSeaClip)");

  const shoreGlow = createSvgNode("path");
  shoreGlow.setAttribute("d", carrierAsset.paths.coastline);
  shoreGlow.setAttribute("fill", "none");
  shoreGlow.setAttribute("stroke", COLOR_TOKENS.shoreGlow);
  shoreGlow.setAttribute("stroke-linecap", "round");
  shoreGlow.setAttribute("stroke-linejoin", "round");
  shoreGlow.setAttribute("stroke-width", "8");
  shoreGlow.setAttribute("opacity", "0.34");

  const landBase = createSvgNode("path");
  landBase.setAttribute("d", carrierAsset.paths.land);
  landBase.setAttribute("fill", COLOR_TOKENS.land);
  landBase.setAttribute("fill-rule", "evenodd");

  const coastline = createSvgNode("path");
  coastline.setAttribute("d", carrierAsset.paths.coastline);
  coastline.setAttribute("fill", "none");
  coastline.setAttribute("stroke", COLOR_TOKENS.coastline);
  coastline.setAttribute("stroke-linecap", "round");
  coastline.setAttribute("stroke-linejoin", "round");
  coastline.setAttribute("stroke-width", "2.2");
  coastline.setAttribute("opacity", "0.88");

  const landOverlay = createSvgNode("g");
  landOverlay.classList.add("transport-workbench-carrier-overlay", "transport-workbench-carrier-overlay-land");
  landOverlay.setAttribute("clip-path", "url(#transportWorkbenchLandClip)");

  scene.append(seaInset, seaOverlay, shoreGlow, landBase, coastline, landOverlay);
  svg.append(seaBackground, scene);

  return { svg, scene, landOverlay, seaOverlay };
}

function ensureResizeObserver() {
  if (!mountNode || resizeObserver) return;
  resizeObserver = new ResizeObserver(() => {
    syncInteractiveState();
  });
  resizeObserver.observe(mountNode);
}

export async function ensureTransportWorkbenchCarrier(nextMountNode) {
  if (!nextMountNode) return null;
  mountNode = nextMountNode;
  mountNode.dataset.transportFamily = activeFamily;
  asset = await loadAsset();
  if (!svgNode) {
    const built = buildCarrierSvg(asset);
    svgNode = built.svg;
    sceneNode = built.scene;
    landOverlayRoot = built.landOverlay;
    seaOverlayRoot = built.seaOverlay;
    camera = clampCamera(asset.defaultCamera || camera);
    applyCamera();
    bindInteractions();
  }
  if (!mountNode.contains(svgNode)) {
    mountNode.replaceChildren(svgNode);
  }
  ensureResizeObserver();
  syncInteractiveState();
  return { land: landOverlayRoot, sea: seaOverlayRoot };
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
  camera = clampCamera(asset.defaultCamera || camera);
  applyCamera();
}

export function resizeTransportWorkbenchCarrier() {
  syncInteractiveState();
}

export function destroyTransportWorkbenchCarrier() {
  pointerDrag = null;
  if (asset?.defaultCamera) {
    camera = clampCamera(asset.defaultCamera);
    applyCamera();
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (mountNode && svgNode && mountNode.contains(svgNode)) {
    mountNode.replaceChildren();
  }
  mountNode = null;
}

export function getTransportWorkbenchCarrierOverlayRoots() {
  return {
    land: landOverlayRoot,
    sea: seaOverlayRoot,
  };
}
