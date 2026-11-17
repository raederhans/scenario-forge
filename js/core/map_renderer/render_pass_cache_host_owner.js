import { requireFunction } from "../renderer/require_named_function.js";

function createSummary({
  passName,
  k = null,
  hasPassCanvas = false,
  hasPassContext = false,
  drawInvoked = false,
  drawResult,
  skipped = false,
  skipReason = "",
}) {
  return Object.freeze({
    passName,
    k,
    hasPassCanvas: Boolean(hasPassCanvas),
    hasPassContext: Boolean(hasPassContext),
    drawInvoked: Boolean(drawInvoked),
    drawResult,
    skipped: Boolean(skipped),
    skipReason: String(skipReason || ""),
  });
}

export function createRenderPassCacheHostOwner({ effects = {}, getters = {} } = {}) {
  const ensureRenderPassCanvas = requireFunction(effects, "ensureRenderPassCanvas", "effects");
  const prepareTargetContext = requireFunction(effects, "prepareTargetContext", "effects");
  const withRenderTarget = requireFunction(effects, "withRenderTarget", "effects");
  const getRenderPassLayout = requireFunction(getters, "getRenderPassLayout", "getters");

  function prepareRenderPassHost({
    passName,
    transform,
    drawFn,
    onHostReady = null,
    drawWithoutCanvas = null,
  } = {}) {
    if (typeof drawFn !== "function") {
      throw new TypeError("drawFn must be a function.");
    }

    // Direct producers can finish without a pixel target. Native fallback invokes
    // this continuation once, retaining the same target restoration semantics.
    if (typeof drawWithoutCanvas === "function") {
      let nativeSummary = null;
      const drawResult = drawWithoutCanvas((nativeDraw) => {
        nativeSummary = prepareRenderPassHost({ passName, transform, drawFn: nativeDraw, onHostReady });
        return nativeSummary.drawResult;
      });
      return nativeSummary || createSummary({ passName, k: Number(transform?.k || 1),
        drawInvoked: true, drawResult });
    }
    const normalizedPassName = String(passName || "");
    const passCanvas = ensureRenderPassCanvas(normalizedPassName);
    if (!passCanvas) {
      return createSummary({
        passName: normalizedPassName,
        skipped: true,
        skipReason: "missing-pass-canvas",
      });
    }

    const passContext = typeof passCanvas.getContext === "function"
      ? passCanvas.getContext("2d")
      : null;
    if (!passContext) {
      return createSummary({
        passName: normalizedPassName,
        hasPassCanvas: true,
        skipped: true,
        skipReason: "missing-pass-context",
      });
    }

    if (typeof onHostReady === "function") {
      onHostReady({
        passName: normalizedPassName,
        passCanvas,
        passContext,
      });
    }

    const layout = getRenderPassLayout(normalizedPassName);
    let k = null;
    let drawInvoked = false;
    let drawResult;

    // host owner 只准备 canvas/context/scale，并把真实绘制交回 drawFn；提交与缓存 accounting 留给后续 owner。
    withRenderTarget(passContext, () => {
      k = prepareTargetContext(passContext, transform, layout);
      drawInvoked = true;
      drawResult = drawFn(k);
      return drawResult;
    });

    return createSummary({
      passName: normalizedPassName,
      k,
      hasPassCanvas: true,
      hasPassContext: true,
      drawInvoked,
      drawResult,
    });
  }

  return Object.freeze({
    prepareRenderPassHost,
  });
}
