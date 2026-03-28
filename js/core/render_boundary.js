let scheduleRenderImpl = null;
let flushRenderImpl = null;
let ensureDetailTopologyImpl = null;

export function bindRenderBoundary({
  scheduleRender = null,
  flushRender = null,
  ensureDetailTopology = null,
} = {}) {
  scheduleRenderImpl = typeof scheduleRender === "function" ? scheduleRender : null;
  flushRenderImpl = typeof flushRender === "function" ? flushRender : null;
  ensureDetailTopologyImpl = typeof ensureDetailTopology === "function" ? ensureDetailTopology : null;
}

export function requestRender(_reason = "") {
  if (typeof scheduleRenderImpl !== "function") {
    return false;
  }
  scheduleRenderImpl();
  return true;
}

export function flushRenderBoundary(_reason = "") {
  if (typeof flushRenderImpl !== "function") {
    return false;
  }
  flushRenderImpl();
  return true;
}

export async function ensureDetailTopologyBoundary(options = {}) {
  if (typeof ensureDetailTopologyImpl !== "function") {
    return false;
  }
  return !!(await ensureDetailTopologyImpl(options));
}
