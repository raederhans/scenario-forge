const DEFAULT_MIN_ZOOM_SCALE = 0.35;
const DEFAULT_MAX_ZOOM_SCALE = 50;
const CAMERA_TRANSITION_MS = 180;

export function createViewportCommandOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
  effects = {},
} = {}) {
  void helpers;

  const {
    minZoomScale = DEFAULT_MIN_ZOOM_SCALE,
    maxZoomScale = DEFAULT_MAX_ZOOM_SCALE,
  } = constants;
  let pendingScale = null;
  let pendingCommand = null;
  let observedZoomBehavior = null;

  function getViewportDimensions() {
    return {
      width: Number(state.width || 0),
      height: Number(state.height || 0),
    };
  }

  function getZoomBehavior() {
    return typeof getters.getZoomBehavior === "function" ? getters.getZoomBehavior() : null;
  }

  function getInteractionRectNode() {
    const rect = typeof getters.getInteractionRect === "function" ? getters.getInteractionRect() : null;
    return typeof rect?.node === "function" ? rect.node() : null;
  }

  function getD3() {
    return typeof getters.getD3 === "function" ? getters.getD3() : null;
  }

  function selectInteractionRect() {
    const d3 = getD3();
    const node = getInteractionRectNode();
    if (!d3 || typeof d3.select !== "function" || !node) return null;
    return d3.select(node);
  }

  function calculatePanExtent() {
    return typeof getters.calculatePanExtent === "function" ? getters.calculatePanExtent() : null;
  }

  function updateZoomTranslateExtent() {
    const zoomBehavior = getZoomBehavior();
    const { width, height } = getViewportDimensions();
    if (!zoomBehavior || width <= 0 || height <= 0) return;
    zoomBehavior.scaleExtent([minZoomScale, maxZoomScale]);
    zoomBehavior.extent([[0, 0], [width, height]]);
    zoomBehavior.translateExtent(calculatePanExtent());
  }

  function getCenteredFitZoomTransform(options) {
    return typeof getters.getCenteredFitZoomTransform === "function"
      ? getters.getCenteredFitZoomTransform(options)
      : null;
  }

  function canAnimateCamera(selection) {
    if (typeof selection?.transition !== "function" || getters.canAnimateCamera?.() !== true) return false;
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches !== true;
  }

  function observeNativeZoom(zoomBehavior) {
    if (observedZoomBehavior === zoomBehavior || typeof zoomBehavior?.on !== "function") return;
    observedZoomBehavior?.on?.("start.viewport-command", null);
    zoomBehavior.on("start.viewport-command", (event) => {
      if (event.sourceEvent) {
        pendingScale = null;
        pendingCommand = null;
      }
    });
    observedZoomBehavior = zoomBehavior;
  }

  function applyZoomCommand(selection, zoomBehavior, zoomMethod, args, nextScale = null) {
    const animate = canAnimateCamera(selection);
    selection.interrupt?.();
    pendingScale = null;
    pendingCommand = null;
    if (!animate) {
      selection.call(zoomMethod, ...args);
      return;
    }
    observeNativeZoom(zoomBehavior);
    const command = {};
    pendingCommand = command;
    pendingScale = nextScale;
    const transition = selection.transition().duration(CAMERA_TRANSITION_MS);
    transition.on?.("cancel.viewport-command interrupt.viewport-command end.viewport-command", () => {
      if (pendingCommand !== command) return;
      pendingScale = null;
      pendingCommand = null;
    });
    transition.call(zoomMethod, ...args);
  }

  function resetZoomToFit({ centerContent = false, centerX = true, centerY = false, animate = false } = {}) {
    const zoomBehavior = getZoomBehavior();
    const d3 = getD3();
    const selection = selectInteractionRect();
    if (!zoomBehavior || !d3 || !selection) return;
    updateZoomTranslateExtent();
    const transform = centerContent
      ? (getCenteredFitZoomTransform({ centerX, centerY }) || d3.zoomIdentity)
      : d3.zoomIdentity;
    if (animate && canAnimateCamera(selection)) {
      applyZoomCommand(selection, zoomBehavior, zoomBehavior.transform, [transform], transform.k);
    } else {
      selection.interrupt?.();
      pendingScale = null;
      pendingCommand = null;
      effects.setZoomTransform?.(transform);
      selection.call(zoomBehavior.transform, transform);
    }
  }

  function zoomByStep(direction = 1) {
    const zoomBehavior = getZoomBehavior();
    const selection = selectInteractionRect();
    if (!zoomBehavior || !selection) return;
    const factor = Number(direction) >= 0 ? 1.2 : 1 / 1.2;
    const d3 = getD3();
    const currentScale = d3?.zoomTransform?.(getInteractionRectNode())?.k;
    if (canAnimateCamera(selection) && Number.isFinite(currentScale)) {
      const baseScale = pendingScale ?? currentScale;
      const nextScale = Math.min(maxZoomScale, Math.max(minZoomScale, baseScale * factor));
      applyZoomCommand(selection, zoomBehavior, zoomBehavior.scaleTo, [nextScale], nextScale);
    } else {
      applyZoomCommand(selection, zoomBehavior, zoomBehavior.scaleBy, [factor]);
    }
  }

  function setZoomPercent(percent) {
    const zoomBehavior = getZoomBehavior();
    const selection = selectInteractionRect();
    if (!zoomBehavior || !selection) return;
    const rawPercent = typeof percent === "string"
      ? Number(String(percent).trim().replace(/%/g, ""))
      : Number(percent);
    if (!Number.isFinite(rawPercent)) return;
    const nextScale = Math.min(maxZoomScale, Math.max(minZoomScale, rawPercent / 100));
    applyZoomCommand(selection, zoomBehavior, zoomBehavior.scaleTo, [nextScale], nextScale);
  }

  function enforceZoomConstraints({ suppressRender = false } = {}) {
    const zoomBehavior = getZoomBehavior();
    const selection = selectInteractionRect();
    if (!zoomBehavior || !selection) return;
    selection.interrupt?.();
    pendingScale = null;
    pendingCommand = null;
    if (suppressRender) {
      const d3 = getD3();
      const node = getInteractionRectNode();
      const constrained = zoomBehavior.constrain()(
        d3.zoomTransform(node),
        zoomBehavior.extent().call(node, node.__data__, 0, [node]),
        zoomBehavior.translateExtent(),
      );
      // Keep D3 and renderer state aligned before D3 emits zoom events. The
      // lifecycle's same-transform guard then avoids an early map draw.
      effects.setZoomTransform?.(constrained);
      selection.call(zoomBehavior.transform, constrained);
      return;
    }
    selection.call(zoomBehavior.translateBy, 0, 0);
  }

  return Object.freeze({
    updateZoomTranslateExtent,
    resetZoomToFit,
    zoomByStep,
    setZoomPercent,
    enforceZoomConstraints,
  });
}
