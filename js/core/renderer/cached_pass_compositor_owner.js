import { getSurfaceCoverage, intersectCoverage, transformCoverage } from "./cached_surface_coverage.js";

function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

function requirePassNames(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new TypeError("constants.renderPassNames must be a non-empty array.");
  }
  return Object.freeze(candidate.slice());
}

export function createCachedPassCompositorOwner({ constants = {}, getters = {}, helpers = {}, effects = {} } = {}) {
  const renderPassNames = requirePassNames(constants.renderPassNames);
  const getActiveTargetContext = requireFunction(
    getters.getActiveTargetContext,
    "getters.getActiveTargetContext",
  );
  const getRenderPassCacheSnapshot = requireFunction(
    getters.getRenderPassCacheSnapshot,
    "getters.getRenderPassCacheSnapshot",
  );
  const getPassReferenceTransform = requireFunction(
    getters.getPassReferenceTransform,
    "getters.getPassReferenceTransform",
  );
  const getRenderPassLayout = requireFunction(
    getters.getRenderPassLayout,
    "getters.getRenderPassLayout",
  );
  const getDpr = requireFunction(getters.getDpr, "getters.getDpr");
  const getRenderPhase = requireFunction(getters.getRenderPhase, "getters.getRenderPhase");
  const isRenderDiagnosticsEnabled = requireFunction(
    getters.isRenderDiagnosticsEnabled,
    "getters.isRenderDiagnosticsEnabled",
  );
  const cloneZoomTransform = requireFunction(
    helpers.cloneZoomTransform,
    "helpers.cloneZoomTransform",
  );
  const areZoomTransformsEquivalent = requireFunction(
    helpers.areZoomTransformsEquivalent,
    "helpers.areZoomTransformsEquivalent",
  );
  const recordTransformedPassDiagnostics = requireFunction(
    effects.recordTransformedPassDiagnostics,
    "effects.recordTransformedPassDiagnostics",
  );

  function recordTransformedPassIfEnabled(
    passName,
    cacheSnapshot,
    current,
    reference,
    scaleRatio,
    dx,
    dy,
    layout,
  ) {
    if (!isRenderDiagnosticsEnabled()) return;
    recordTransformedPassDiagnostics(passName, {
      current,
      reference,
      scaleRatio,
      dx,
      dy,
      layout,
      phase: String(getRenderPhase() || ""),
      dirty: !!cacheSnapshot.dirty?.[passName],
    });
  }

  function getPassCoverage(passName, currentTransform) {
    const cache = getRenderPassCacheSnapshot();
    const layout = getRenderPassLayout(passName);
    let coverage = getSurfaceCoverage(cache.canvases?.[passName], layout);
    // Viewport-culling can paint less than the allocated padding. Keep that
    // limit separate from the bitmap dimensions, including on composite rebuilds.
    const limit = Number(constants.paintedOverscanLimit ?? Infinity);
    if (coverage && Number.isFinite(limit)) {
      coverage = intersectCoverage(coverage, {
        minX: -limit, minY: -limit,
        maxX: layout.logicalWidth + limit, maxY: layout.logicalHeight + limit,
      });
    }
    return transformCoverage(
      coverage,
      getPassReferenceTransform(passName), currentTransform,
    );
  }

  function getCompositeCoverage(passNames, currentTransform) {
    let coverage = null;
    for (const [index, passName] of passNames.entries()) {
      const next = getPassCoverage(passName, currentTransform);
      coverage = index === 0 ? next : intersectCoverage(coverage, next);
      if (!coverage) break;
    }
    return coverage;
  }

  function drawTransformedPass(passName, currentTransform, referenceTransform = null) {
    const cacheSnapshot = getRenderPassCacheSnapshot();
    const passCanvas = cacheSnapshot.canvases?.[passName] || null;
    if (!passCanvas) return false;
    const resolvedReferenceTransform = referenceTransform || getPassReferenceTransform(passName);
    if (!resolvedReferenceTransform) return false;
    const current = cloneZoomTransform(currentTransform);
    const reference = cloneZoomTransform(resolvedReferenceTransform);
    const layout = getRenderPassLayout(passName);
    const scaleRatio = current.k / Math.max(reference.k, 0.0001);
    const dx = current.x - (reference.x * scaleRatio);
    const dy = current.y - (reference.y * scaleRatio);
    recordTransformedPassIfEnabled(
      passName,
      cacheSnapshot,
      current,
      reference,
      scaleRatio,
      dx,
      dy,
      layout,
    );
    const targetContext = getActiveTargetContext();
    targetContext.save();
    targetContext.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = getDpr();
    targetContext.translate(
      (dx - Number(layout?.offsetX || 0) * scaleRatio) * dpr,
      (dy - Number(layout?.offsetY || 0) * scaleRatio) * dpr,
    );
    targetContext.scale(scaleRatio, scaleRatio);
    targetContext.drawImage(passCanvas, 0, 0);
    targetContext.restore();
    return true;
  }

  function composeRenderPassesToTarget(
    targetContext,
    passNames,
    currentTransform,
    { requireAllPasses = false, targetOffsetX = 0, targetOffsetY = 0 } = {},
  ) {
    if (!targetContext) return { ok: false, reason: "missing-target-context" };
    const cacheSnapshot = getRenderPassCacheSnapshot();
    const names = Array.isArray(passNames) ? passNames : renderPassNames;
    const missingCanvasPassNames = [];
    const missingReferenceTransformPassNames = [];
    if (requireAllPasses) {
      for (const passName of names) {
        const passCanvas = cacheSnapshot.canvases?.[passName] || null;
        if (!passCanvas) {
          missingCanvasPassNames.push(passName);
          continue;
        }
        const referenceTransform = getPassReferenceTransform(passName);
        if (!referenceTransform) {
          missingReferenceTransformPassNames.push(passName);
        }
      }
      if (missingCanvasPassNames.length) {
        return {
          ok: false,
          reason: "missing-pass-canvas",
          passName: missingCanvasPassNames[0],
          missingPassNames: missingCanvasPassNames,
        };
      }
      if (missingReferenceTransformPassNames.length) {
        return {
          ok: false,
          reason: "missing-reference-transform",
          passName: missingReferenceTransformPassNames[0],
          missingPassNames: missingReferenceTransformPassNames,
        };
      }
    }
    for (const passName of names) {
      const passCanvas = cacheSnapshot.canvases?.[passName] || null;
      if (!passCanvas) {
        if (requireAllPasses) return { ok: false, reason: "missing-pass-canvas", passName };
        continue;
      }
      const referenceTransform = getPassReferenceTransform(passName);
      if (!referenceTransform && requireAllPasses) {
        return { ok: false, reason: "missing-reference-transform", passName };
      }
      if (referenceTransform && !areZoomTransformsEquivalent(referenceTransform, currentTransform)) {
        const layout = getRenderPassLayout(passName);
        const current = cloneZoomTransform(currentTransform);
        const reference = cloneZoomTransform(referenceTransform);
        const scaleRatio = current.k / Math.max(reference.k, 0.0001);
        const dx = current.x - (reference.x * scaleRatio);
        const dy = current.y - (reference.y * scaleRatio);
        recordTransformedPassIfEnabled(
          passName,
          cacheSnapshot,
          current,
          reference,
          scaleRatio,
          dx,
          dy,
          layout,
        );
        targetContext.save();
        targetContext.setTransform(1, 0, 0, 1, 0, 0);
        const dpr = getDpr();
        targetContext.translate(
          (targetOffsetX + dx - Number(layout?.offsetX || 0) * scaleRatio) * dpr,
          (targetOffsetY + dy - Number(layout?.offsetY || 0) * scaleRatio) * dpr,
        );
        targetContext.scale(scaleRatio, scaleRatio);
        targetContext.drawImage(passCanvas, 0, 0);
        targetContext.restore();
        continue;
      }
      const layout = getRenderPassLayout(passName);
      const dpr = getDpr();
      targetContext.drawImage(
        passCanvas,
        Math.round((targetOffsetX - Number(layout?.offsetX || 0)) * dpr),
        Math.round((targetOffsetY - Number(layout?.offsetY || 0)) * dpr),
      );
    }
    return { ok: true };
  }

  return Object.freeze({
    getPassCoverage,
    getCompositeCoverage,
    drawTransformedPass,
    composeRenderPassesToTarget,
  });
}
