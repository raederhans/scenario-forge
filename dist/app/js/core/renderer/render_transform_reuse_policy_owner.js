const CONTEXT_BASE_REUSE_MIN_DISTANCE_PX = 320;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_PX = 640;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO = 0.35;
const CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD = 2;
const CONTEXT_BASE_BUCKET_LOW_MAX = 1.4;
const CONTEXT_BASE_BUCKET_MID_MAX = 2.5;
const CONTEXT_SCENARIO_REUSE_MAX_DISTANCE_PX = 960;
const CONTEXT_SCENARIO_REUSE_FRAME_LIMIT = 24;
const EXACT_AFTER_SETTLE_FAST_PATH_REQUIRED_PASS_NAMES = Object.freeze([
  "background", "physicalBase", "political",
  "contextBase", "contextScenario", "effects", "lineEffects",
  "contextMarkers", "dayNight", "textureLabels",
]);

export function cloneRenderZoomTransform(transform = null) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

export function createRenderTransformReusePolicyOwner({
  state = {},
  constants = {},
  getters = {},
  helpers = {},
} = {}) {
  const {
    contextBaseReuseMinDistancePx = CONTEXT_BASE_REUSE_MIN_DISTANCE_PX,
    contextBaseReuseMaxDistancePx = CONTEXT_BASE_REUSE_MAX_DISTANCE_PX,
    contextBaseReuseMaxDistanceViewportRatio = CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO,
    contextBaseMinorContourThreshold = CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD,
    contextBaseBucketLowMax = CONTEXT_BASE_BUCKET_LOW_MAX,
    contextBaseBucketMidMax = CONTEXT_BASE_BUCKET_MID_MAX,
    contextScenarioReuseMaxDistancePx = CONTEXT_SCENARIO_REUSE_MAX_DISTANCE_PX,
    contextScenarioReuseFrameLimit = CONTEXT_SCENARIO_REUSE_FRAME_LIMIT,
    exactAfterSettleFastPathRequiredPassNames = EXACT_AFTER_SETTLE_FAST_PATH_REQUIRED_PASS_NAMES,
  } = constants;
  const {
    getRenderPassCacheState = () => state.renderPassCache || {},
    getPassReferenceTransform = () => null,
    getActiveRenderPassNames = () => null,
  } = getters;
  const {
    cloneZoomTransform = cloneRenderZoomTransform,
    isHeavyScenarioStagedApplyCandidate = () => false,
  } = helpers;

  function getDefaultTransform() {
    return state.zoomTransform || { k: 1, x: 0, y: 0 };
  }

  function getContextBaseZoomBucketId(k = state.zoomTransform?.k || 1) {
    const normalized = Math.max(0.0001, Number(k || 1));
    if (normalized < contextBaseBucketLowMax) return "low";
    if (normalized < contextBaseBucketMidMax) return "mid";
    return "high";
  }

  function getContextBaseReuseMaxDistancePx() {
    const viewportMin = Math.max(1, Math.min(Number(state.width || 0), Number(state.height || 0)));
    const scaled = viewportMin * contextBaseReuseMaxDistanceViewportRatio;
    return Math.max(
      contextBaseReuseMinDistancePx,
      Math.min(contextBaseReuseMaxDistancePx, scaled),
    );
  }

  function getTransformReuseDelta(currentTransform, referenceTransform) {
    const current = cloneZoomTransform(currentTransform || getDefaultTransform());
    const reference = cloneZoomTransform(referenceTransform);
    const scaleRatio = current.k / Math.max(reference.k, 0.0001);
    const dx = current.x - (reference.x * scaleRatio);
    const dy = current.y - (reference.y * scaleRatio);
    const distancePx = Math.hypot(dx, dy);
    return {
      current,
      reference,
      scaleRatio,
      dx,
      dy,
      distancePx,
    };
  }

  function shouldEnableContextBaseTransformReuse() {
    return (
      String(state.renderProfile || "auto") === "balanced"
      && isHeavyScenarioStagedApplyCandidate()
      && !!state.activeScenarioId
    );
  }

  function shouldEnableContextScenarioTransformReuse() {
    return String(state.renderProfile || "auto") === "balanced" && !!state.activeScenarioId;
  }

  function getContextBaseReuseDecision(transform = getDefaultTransform()) {
    const referenceTransform = getPassReferenceTransform("contextBase");
    const currentBucket = getContextBaseZoomBucketId(transform?.k || state.zoomTransform?.k || 1);
    if (!shouldEnableContextBaseTransformReuse()) {
      return {
        enabled: false,
        shouldExactRefresh: true,
        reason: "reuse-disabled",
        scaleRatio: 1,
        distancePx: 0,
        zoomBucket: currentBucket,
        referenceZoomBucket: currentBucket,
        crossesMinorContourThreshold: false,
        referenceTransform,
      };
    }
    if (!referenceTransform) {
      return {
        enabled: true,
        shouldExactRefresh: true,
        reason: "no-reference-transform",
        scaleRatio: 1,
        distancePx: 0,
        zoomBucket: currentBucket,
        referenceZoomBucket: "",
        crossesMinorContourThreshold: false,
        referenceTransform: null,
      };
    }
    const delta = getTransformReuseDelta(transform, referenceTransform);
    const referenceBucket = getContextBaseZoomBucketId(referenceTransform?.k || 1);
    const crossesMinorContourThreshold =
      (delta.reference.k < contextBaseMinorContourThreshold && delta.current.k >= contextBaseMinorContourThreshold)
      || (delta.reference.k >= contextBaseMinorContourThreshold && delta.current.k < contextBaseMinorContourThreshold);
    const crossesZoomBucket = currentBucket !== referenceBucket;
    const maxDistancePx = getContextBaseReuseMaxDistancePx();
    const shouldExactRefresh =
      crossesZoomBucket
      || delta.distancePx > maxDistancePx
      || crossesMinorContourThreshold;
    let reason = "transform-reuse";
    if (crossesZoomBucket) {
      reason = "zoom-bucket-change";
    } else if (delta.distancePx > maxDistancePx) {
      reason = "distance-threshold";
    } else if (crossesMinorContourThreshold) {
      reason = "minor-contour-threshold";
    }
    return {
      enabled: true,
      shouldExactRefresh,
      reason,
      scaleRatio: Number(delta.scaleRatio.toFixed(4)),
      distancePx: Number(delta.distancePx.toFixed(2)),
      maxDistancePx: Number(maxDistancePx.toFixed(2)),
      zoomBucket: currentBucket,
      referenceZoomBucket: referenceBucket,
      crossesZoomBucket,
      crossesMinorContourThreshold,
      referenceTransform,
      currentTransform: delta.current,
    };
  }

  function getContextScenarioReuseDecision(transform = getDefaultTransform()) {
    const cache = getRenderPassCacheState();
    const referenceTransform = getPassReferenceTransform("contextScenario");
    const currentBucket = getContextBaseZoomBucketId(transform?.k || state.zoomTransform?.k || 1);
    const reuseFrameCount = Math.max(0, Number(cache.counters?.contextScenarioReuseCount || 0));
    if (!shouldEnableContextScenarioTransformReuse()) {
      return {
        enabled: false,
        shouldExactRefresh: true,
        reason: "reuse-disabled",
        scaleRatio: 1,
        distancePx: 0,
        maxDistancePx: getContextBaseReuseMaxDistancePx(),
        zoomBucket: currentBucket,
        referenceZoomBucket: currentBucket,
        crossesZoomBucket: false,
        reuseFrameCount,
        reuseFrameLimit: contextScenarioReuseFrameLimit,
        referenceTransform,
      };
    }
    if (!referenceTransform) {
      return {
        enabled: true,
        shouldExactRefresh: true,
        reason: "no-reference-transform",
        scaleRatio: 1,
        distancePx: 0,
        maxDistancePx: getContextBaseReuseMaxDistancePx(),
        zoomBucket: currentBucket,
        referenceZoomBucket: "",
        crossesZoomBucket: false,
        reuseFrameCount,
        reuseFrameLimit: contextScenarioReuseFrameLimit,
        referenceTransform: null,
      };
    }
    const delta = getTransformReuseDelta(transform, referenceTransform);
    const referenceBucket = getContextBaseZoomBucketId(referenceTransform?.k || 1);
    const crossesZoomBucket = currentBucket !== referenceBucket;
    const maxDistancePx = Math.max(
      getContextBaseReuseMaxDistancePx(),
      contextScenarioReuseMaxDistancePx,
    );
    const reachesReuseFrameLimit = reuseFrameCount >= contextScenarioReuseFrameLimit;
    const shouldExactRefresh =
      delta.distancePx > maxDistancePx
      || reachesReuseFrameLimit;
    let reason = "transform-reuse";
    if (delta.distancePx > maxDistancePx) {
      reason = "distance-threshold";
    } else if (reachesReuseFrameLimit) {
      reason = "reuse-frame-limit";
    }
    return {
      enabled: true,
      shouldExactRefresh,
      reason,
      scaleRatio: Number(delta.scaleRatio.toFixed(4)),
      distancePx: Number(delta.distancePx.toFixed(2)),
      maxDistancePx: Number(maxDistancePx.toFixed(2)),
      zoomBucket: currentBucket,
      referenceZoomBucket: referenceBucket,
      crossesZoomBucket,
      reuseFrameCount,
      reuseFrameLimit: contextScenarioReuseFrameLimit,
      referenceTransform,
      currentTransform: delta.current,
    };
  }

  function shouldStartExactAfterSettleFastPath() {
    if (state.deferContextBasePass) return false;
    // Sliced recovery does not require long-lived contextBase transform reuse.
    // HGO owns a separate surface pipeline, even when old vector caches remain.
    const activePassNames = getActiveRenderPassNames();
    if (!Array.isArray(activePassNames) || !activePassNames.length || activePassNames.includes("hgoPreview")) return false;
    const cache = getRenderPassCacheState();
    return exactAfterSettleFastPathRequiredPassNames.every((passName) => (
      !!cache.canvases?.[passName] && !!getPassReferenceTransform(passName)
    ));
  }

  return {
    getContextBaseZoomBucketId,
    getContextBaseReuseMaxDistancePx,
    getTransformReuseDelta,
    shouldEnableContextBaseTransformReuse,
    shouldEnableContextScenarioTransformReuse,
    getContextBaseReuseDecision,
    getContextScenarioReuseDecision,
    shouldStartExactAfterSettleFastPath,
  };
}
