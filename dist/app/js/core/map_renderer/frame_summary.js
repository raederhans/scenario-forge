// Immutable JSON-safe frame reports, without rendering or state dependencies.
function cloneJsonSafeTimings(timings) {
  return Object.freeze(Object.fromEntries(
    Object.entries(timings || {}).map(([key, value]) => [
      key,
      typeof value === "number" ? value : String(value),
    ]),
  ));
}

export function createFrameSummary({ status, frameMode, totalMs = 0, timings = {}, branch = {} }) {
  return Object.freeze({
    status,
    frameMode,
    drewFrame: Boolean(branch.drewFrame),
    usedTransformedFrame: Boolean(branch.useTransformedFrame),
    usedLastGoodFallback: Boolean(branch.usedLastGoodFallback),
    usedBaseVisibleFallback: Boolean(branch.usedBaseVisibleFallback),
    keptPreviousPixels: Boolean(branch.keptPreviousPixels),
    drewExactFrame: Boolean(branch.drewExactFrame),
    skippedCapture: Boolean(branch.skippedCapture),
    totalMs: Math.max(0, Number(totalMs || 0)),
    timings: cloneJsonSafeTimings(timings),
  });
}
