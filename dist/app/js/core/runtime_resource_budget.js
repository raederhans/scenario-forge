// Shared accounting only. Owners retain/release their own data and decide what
// may be evicted. Numbers are retention estimates, never a browser heap limit.
export const RUNTIME_RESOURCE_SOFT_LIMIT_BYTES = 256 * 1024 * 1024;
export const RESOURCE_CATEGORIES = Object.freeze([
  "inFlight", "decodeTransient", "mainChunkPayload", "mainGeometry",
  "workerGeometry", "projectedPaths", "workerSurfaces", "bitmaps", "transport",
]);

export function createRuntimeResourceBudget({ softLimitBytes = RUNTIME_RESOURCE_SOFT_LIMIT_BYTES } = {}) {
  if (!Number.isSafeInteger(softLimitBytes) || softLimitBytes <= 0) {
    throw new TypeError("Resource soft limit must be a positive safe byte count.");
  }
  const reports = new Map();
  const listeners = new Set();
  let peakEstimatedBytes = 0;
  let revision = 0;
  const sum = () => [...reports.values()].reduce((total, report) =>
    total + Object.values(report).reduce((subtotal, bytes) => subtotal + (bytes ?? 0), 0), 0);
  const notify = () => {
    revision++;
    peakEstimatedBytes = Math.max(peakEstimatedBytes, sum());
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* Accounting cannot break owner lifecycles. */ }
    }
  };
  function update(owner, estimates = {}) {
    if (typeof owner !== "symbol") throw new TypeError("Resource owner must be a private Symbol.");
    const next = {};
    for (const [category, bytes] of Object.entries(estimates)) {
      if (!RESOURCE_CATEGORIES.includes(category)
        || (bytes !== null && (!Number.isSafeInteger(bytes) || bytes < 0))) {
        throw new TypeError(`Invalid resource estimate: ${category}`);
      }
      next[category] = bytes;
    }
    const previous = reports.get(owner);
    if (previous && Object.keys(previous).length === Object.keys(next).length
      && Object.keys(next).every((key) => previous[key] === next[key])) return;
    if (Object.keys(next).length) reports.set(owner, next);
    else reports.delete(owner);
    notify();
  }
  function release(owner) {
    if (reports.delete(owner)) notify();
  }
  function snapshot() {
    const categories = {};
    const reported = new Set();
    const unknown = new Set();
    for (const report of reports.values()) for (const [category, bytes] of Object.entries(report)) {
      reported.add(category);
      if (bytes === null) unknown.add(category);
      else categories[category] = (categories[category] || 0) + bytes;
    }
    const estimatedBytes = sum();
    return {
      accounting: "reported-retention-estimates-not-heap",
      estimatedBytes, peakEstimatedBytes, softLimitBytes,
      pressure: estimatedBytes >= softLimitBytes,
      overBudgetEstimatedBytes: Math.max(0, estimatedBytes - softLimitBytes),
      categories,
      unmeasuredCategories: RESOURCE_CATEGORIES.filter((key) => !reported.has(key) || unknown.has(key)),
      ownerCount: reports.size, revision,
    };
  }
  function admitSpeculative(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError("Invalid requested resource bytes.");
    const current = sum();
    return { admitted: current + bytes <= softLimitBytes,
      reason: current + bytes <= softLimitBytes ? "within-observed-budget" : "shared-resource-pressure",
      estimatedBytes: current, requestedBytes: bytes, softLimitBytes };
  }
  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Resource listener must be callable.");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  return Object.freeze({ update, release, snapshot, admitSpeculative, subscribe });
}

// Each browser page has one module graph. Worker cache estimates are reported
// back by its client rather than pretending separate Worker globals are shared.
export const pageResourceBudget = createRuntimeResourceBudget();
