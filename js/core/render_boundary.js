let scheduleRenderImpl = null;
let flushRenderImpl = null;
let ensureDetailTopologyImpl = null;
let pendingReasons = [];
let lastScheduledReasons = [];
let lastScheduledReason = "";
let lastFlushReason = "";
let requestPending = false;

function normalizeReason(reason = "") {
  return String(reason || "").trim();
}

function clearPendingReasons() {
  pendingReasons = [];
  requestPending = false;
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
  lastScheduledReasons = [];
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
  lastScheduledReasons = [...pendingReasons];
  lastScheduledReason = normalizedReason;
  if (requestPending) {
    return true;
  }
  requestPending = true;
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
  try {
    flushRenderImpl({ reason: lastFlushReason });
  } finally {
    clearPendingReasons();
  }
  return true;
}

export function markRenderBoundaryFlushed() {
  clearPendingReasons();
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
    lastScheduledReasons: [...lastScheduledReasons],
    lastScheduledReason,
    lastFlushReason,
    requestPending,
  };
}
