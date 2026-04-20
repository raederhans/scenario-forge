export function createInteractionBorderSnapshotOwner({
  state,
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    renderPassOverscanRatioPerSide = 0.2,
  } = constants;

  const {
    getContext = () => null,
    getRenderPassCacheState = () => ({ borderSnapshot: null }),
  } = getters;

  const {
    cloneZoomTransform = (transform) => transform,
    drawBordersPass = () => {},
    incrementPerfCounter = () => {},
    invalidateInteractionBorderSnapshotFacade = null,
    nowMs = () => 0,
    prepareTargetContext = (_targetContext, transform) => Number(transform?.k || 1),
    recordRenderPerfMetric = () => {},
    withRenderTarget = (_targetContext, callback) => callback?.(),
  } = helpers;

  function buildInteractionBorderSnapshotLayout() {
    const dpr = Math.max(state.dpr || 1, 1);
    const logicalWidth = Math.max(1, Number(state.width || 1));
    const logicalHeight = Math.max(1, Number(state.height || 1));
    const offsetX = Math.ceil(logicalWidth * renderPassOverscanRatioPerSide);
    const offsetY = Math.ceil(logicalHeight * renderPassOverscanRatioPerSide);
    const paddedWidth = logicalWidth + offsetX * 2;
    const paddedHeight = logicalHeight + offsetY * 2;
    return {
      offsetX,
      offsetY,
      logicalWidth,
      logicalHeight,
      paddedWidth,
      paddedHeight,
      pixelWidth: Math.max(1, Math.floor(paddedWidth * dpr)),
      pixelHeight: Math.max(1, Math.floor(paddedHeight * dpr)),
      dpr,
    };
  }

  function getInteractionBorderSnapshotState() {
    const cache = getRenderPassCacheState();
    return cache.borderSnapshot;
  }

  function ensureInteractionBorderSnapshotCanvas() {
    const snapshot = getInteractionBorderSnapshotState();
    if (!snapshot.canvas) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      snapshot.canvas = canvas;
    }
    snapshot.layout = buildInteractionBorderSnapshotLayout();
    if (snapshot.canvas.width !== snapshot.layout.pixelWidth) snapshot.canvas.width = snapshot.layout.pixelWidth;
    if (snapshot.canvas.height !== snapshot.layout.pixelHeight) snapshot.canvas.height = snapshot.layout.pixelHeight;
    return snapshot.canvas;
  }

  function invalidateInteractionBorderSnapshot(reason = "unspecified") {
    const snapshot = getInteractionBorderSnapshotState();
    snapshot.valid = false;
    snapshot.reason = String(reason || "unspecified");
    snapshot.referenceTransform = null;
  }

  function captureInteractionBorderSnapshot(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
    if (!state.landData?.features?.length) {
      invalidateInteractionBorderSnapshot("empty-land-data");
      return false;
    }
    const canvas = ensureInteractionBorderSnapshotCanvas();
    const snapshot = getInteractionBorderSnapshotState();
    const targetContext = canvas?.getContext?.("2d");
    if (!targetContext) {
      invalidateInteractionBorderSnapshot("missing-context");
      return false;
    }
    const referenceTransform = cloneZoomTransform(transform);
    const startedAt = nowMs();
    const k = prepareTargetContext(targetContext, referenceTransform, snapshot.layout);
    withRenderTarget(targetContext, () => {
      drawBordersPass(k, { interactive: true });
    });
    snapshot.referenceTransform = referenceTransform;
    snapshot.valid = true;
    snapshot.reason = "captured";
    incrementPerfCounter("borderSnapshotRenders");
    recordRenderPerfMetric("interactionBorderSnapshotBuild", nowMs() - startedAt, {
      activeScenarioId: String(state.activeScenarioId || ""),
      transformK: Number(referenceTransform.k || 1),
    });
    return true;
  }

  function drawInteractionBorderSnapshot(currentTransform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
    const snapshot = getInteractionBorderSnapshotState();
    const context = getContext();
    if (!context) return false;
    if (!snapshot.valid || !snapshot.canvas || !snapshot.referenceTransform || !snapshot.layout) {
      return false;
    }
    const expectedLayout = buildInteractionBorderSnapshotLayout();
    if (
      snapshot.canvas.width !== expectedLayout.pixelWidth
      || snapshot.canvas.height !== expectedLayout.pixelHeight
    ) {
      if (typeof invalidateInteractionBorderSnapshotFacade === "function") {
        invalidateInteractionBorderSnapshotFacade("layout-mismatch");
      } else {
        invalidateInteractionBorderSnapshot("layout-mismatch");
      }
      return false;
    }
    const current = cloneZoomTransform(currentTransform);
    const reference = cloneZoomTransform(snapshot.referenceTransform);
    const scaleRatio = current.k / Math.max(reference.k, 0.0001);
    const dx = current.x - (reference.x * scaleRatio);
    const dy = current.y - (reference.y * scaleRatio);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(
      (dx - Number(snapshot.layout.offsetX || 0) * scaleRatio) * state.dpr,
      (dy - Number(snapshot.layout.offsetY || 0) * scaleRatio) * state.dpr,
    );
    context.scale(scaleRatio, scaleRatio);
    context.drawImage(snapshot.canvas, 0, 0);
    context.restore();
    incrementPerfCounter("borderSnapshotReuses");
    return true;
  }

  return {
    buildInteractionBorderSnapshotLayout,
    getInteractionBorderSnapshotState,
    ensureInteractionBorderSnapshotCanvas,
    invalidateInteractionBorderSnapshot,
    captureInteractionBorderSnapshot,
    drawInteractionBorderSnapshot,
  };
}
