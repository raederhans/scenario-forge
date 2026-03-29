let scheduleRenderImpl = null;
let flushRenderImpl = null;
let ensureDetailTopologyImpl = null;
let pendingReasons = [];
let lastScheduledReason = "";
let lastFlushReason = "";
let pendingResetHandle = null;
let requestPending = false;

function normalizeReason(reason = "") {
  return String(reason || "").trim();
}

function clearPendingReasons() {
  pendingReasons = [];
  requestPending = false;
  pendingResetHandle = null;
}

export function bindRenderBoundary({
  scheduleRender = null,
  flushRender = null,
  ensureDetailTopology = null,
} = {}) {
  scheduleRenderImpl = typeof scheduleRender === "function" ? scheduleRender : null;
  flushRenderImpl = typeof flushRender === "function" ? flushRender : null;
  ensureDetailTopologyImpl = typeof ensureDetailTopology === "function" ? ensureDetailTopology : null;
  clearPendingReasons();
  lastScheduledReason = "";
  lastFlushReason = "";
}

export function requestRender(reason = "") {
  if (typeof scheduleRenderImpl !== "function") {
    return false;
  }
  const normalizedReason = normalizeReason(reason);
  if (normalizedReason && !pendingReasons.includes(normalizedReason)) {
    pendingReasons.push(normalizedReason);
  }
  lastScheduledReason = normalizedReason;
  if (requestPending) {
    return true;
  }
  requestPending = true;
  if (pendingResetHandle === null && typeof globalThis.requestAnimationFrame === "function") {
    pendingResetHandle = globalThis.requestAnimationFrame(() => {
      clearPendingReasons();
    });
  }
  if (pendingResetHandle === null) {
    pendingResetHandle = globalThis.setTimeout(() => {
      clearPendingReasons();
    }, 0);
  }
  scheduleRenderImpl({
    reason: normalizedReason,
    reasons: [...pendingReasons],
  });
  return true;
}

export function flushRenderBoundary(reason = "") {
  if (typeof flushRenderImpl !== "function") {
    return false;
  }
  lastFlushReason = normalizeReason(reason);
  if (pendingResetHandle !== null) {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(pendingResetHandle);
    }
    if (typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(pendingResetHandle);
    }
  }
  clearPendingReasons();
  flushRenderImpl({ reason: lastFlushReason });
  return true;
}

export async function ensureDetailTopologyBoundary(options = {}) {
  if (typeof ensureDetailTopologyImpl !== "function") {
    return false;
  }
  return !!(await ensureDetailTopologyImpl(options));
}

export function getRenderBoundaryDebugState() {
  return {
    pendingReasons: [...pendingReasons],
    lastScheduledReason,
    lastFlushReason,
    requestPending,
  };
}
