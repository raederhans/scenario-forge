export const CANVAS_LAYER_NAMES = Object.freeze({
  composite: "composite",
  politicalPatch: "politicalPatch",
  interactionOverlay: "interactionOverlay",
});

const CANVAS_LAYER_CONFIGS = Object.freeze({
  [CANVAS_LAYER_NAMES.composite]: Object.freeze({
    id: "map-canvas",
    className: "map-layer map-layer-composite",
    zIndex: "0",
  }),
  [CANVAS_LAYER_NAMES.politicalPatch]: Object.freeze({
    id: "map-political-patch-canvas",
    className: "map-layer map-layer-political-patch",
    zIndex: "1",
  }),
  [CANVAS_LAYER_NAMES.interactionOverlay]: Object.freeze({
    id: "map-interaction-overlay-canvas",
    className: "map-layer map-layer-interaction-overlay",
    zIndex: "2",
  }),
});

function applyCanvasLayerStyle(canvas, config) {
  canvas.id = config.id;
  canvas.className = config.className;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.zIndex = config.zIndex;
  canvas.style.pointerEvents = "none";
  canvas.style.touchAction = "none";
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

function createCanvasLayerElement(documentRef, config) {
  const canvas = documentRef.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return applyCanvasLayerStyle(canvas, config);
}

export function ensureCanvasLayers(container, { before = null } = {}) {
  if (!container?.ownerDocument) {
    return {};
  }
  const documentRef = container.ownerDocument;
  const layers = {};
  Object.values(CANVAS_LAYER_NAMES).forEach((name) => {
    const config = CANVAS_LAYER_CONFIGS[name];
    let canvas = container.querySelector(`#${config.id}`);
    if (!canvas) {
      canvas = createCanvasLayerElement(documentRef, config);
      if (before && container.contains(before)) {
        container.insertBefore(canvas, before);
      } else {
        container.appendChild(canvas);
      }
    } else {
      applyCanvasLayerStyle(canvas, config);
    }
    layers[name] = { name, canvas };
  });
  return layers;
}

export function getCanvasLayer(layers, name) {
  const layer = layers?.[name] || null;
  return layer?.canvas ? layer : null;
}

export function resizeCanvasLayers(layers, { width = 0, height = 0, dpr = 1, preserveComposite = false } = {}) {
  const logicalWidth = Math.max(1, Math.round(Number(width || 0)));
  const logicalHeight = Math.max(1, Math.round(Number(height || 0)));
  const pixelRatio = Math.max(0.1, Number(dpr || 1));
  const pixelWidth = Math.max(1, Math.floor(logicalWidth * pixelRatio));
  const pixelHeight = Math.max(1, Math.floor(logicalHeight * pixelRatio));
  const composite = getCanvasLayer(layers, CANVAS_LAYER_NAMES.composite)?.canvas;
  let retainedFrame = null;
  if (preserveComposite && composite?.width > 1 && composite?.height > 1
    && (composite.width !== pixelWidth || composite.height !== pixelHeight)) {
    // Changing a canvas backing size clears its pixels immediately. Keep the
    // current scene visible while its passes are rebuilt at the new DPR.
    retainedFrame = composite.ownerDocument.createElement("canvas");
    retainedFrame.width = composite.width;
    retainedFrame.height = composite.height;
    const retainedContext = retainedFrame.getContext("2d");
    retainedContext.drawImage(composite, 0, 0);
    const patch = getCanvasLayer(layers, CANVAS_LAYER_NAMES.politicalPatch)?.canvas;
    if (patch) retainedContext.drawImage(patch, 0, 0);
  }
  Object.values(CANVAS_LAYER_NAMES).forEach((name) => {
    const canvas = getCanvasLayer(layers, name)?.canvas;
    if (!canvas) return;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
  });
  if (retainedFrame) {
    composite.getContext("2d").drawImage(retainedFrame, 0, 0, pixelWidth, pixelHeight);
  }
  return { pixelWidth, pixelHeight, logicalWidth, logicalHeight };
}

export function clearCanvasLayer(layer) {
  const canvas = layer?.canvas || layer || null;
  const context = canvas?.getContext?.("2d");
  if (!canvas || !context) return false;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.filter = "none";
  return true;
}

export function shouldClearStaleCanvasOverlay({
  overlayTransformSignature = "",
  currentTransformSignature = "",
  renderPhase = "",
  idleRenderPhase = "idle",
  deferExactAfterSettle = false,
} = {}) {
  const overlaySignature = String(overlayTransformSignature || "");
  if (!overlaySignature) return false;
  if (deferExactAfterSettle) return true;
  if (String(renderPhase || "") !== String(idleRenderPhase || "")) return true;
  return overlaySignature !== String(currentTransformSignature || "");
}
